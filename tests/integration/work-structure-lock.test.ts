import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addTaskToProjectAction, createProjectAction, createTaskAction, deleteProjectAction } from "@/app/(app)/tasks/work-actions";
import { prisma } from "@/lib/prisma";
import { STRUCTURE_BUSY_MESSAGE, STRUCTURE_LOCK_CLASS } from "@/lib/tasks/structure";
import type { ActionResult } from "@/lib/tasks/types";

import { createWorkspaceWithUser, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Verrou de structure (contre-revue de c9cefbf, N2) : acquisition non
 * bloquante. Un verrou tenu par une autre session ne fait attendre personne,
 * ne garde aucune connexion du pool et ne bloque pas les autres espaces.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const url = process.env.TEST_DATABASE_URL!.replace(/\?.*$/, "");

describe("verrou de structure : refus rapide quand il est occupé", () => {
  let alice: TestUser;
  let holder: Client | null = null;

  /** Une autre session (autre instance, opération longue) détient le verrou de l'espace. */
  const holdLock = async (workspaceId: string) => {
    holder = new Client({ connectionString: url });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [STRUCTURE_LOCK_CLASS, workspaceId]);
  };
  const release = async () => {
    if (!holder) return;
    await holder.query("COMMIT").catch(() => {});
    await holder.end().catch(() => {});
    holder = null;
  };

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("structure-lock");
    await signIn(alice);
  });
  afterEach(release);

  it("une opération de structure est refusée en moins d'une seconde, sans rien écrire, puis passe après libération", async () => {
    const P = ok(await createProjectAction({ name: "P" }));
    const t = ok(await createTaskAction({ title: "T", projectId: P }));
    await holdLock(alice.workspaceId);

    const start = Date.now();
    const refused = await deleteProjectAction(P);
    const elapsed = Date.now() - start;
    expect(refused).toMatchObject({ ok: false, error: STRUCTURE_BUSY_MESSAGE });
    expect(elapsed).toBeLessThan(1000);
    // Aucune écriture partielle.
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).deletedAt).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).toBeNull();
    // Création dans un projet : même refus, aucune tâche créée.
    expect(await createTaskAction({ title: "Refusée", projectId: P })).toMatchObject({ ok: false, error: STRUCTURE_BUSY_MESSAGE });
    expect(await prisma.task.count({ where: { title: "Refusée" } })).toBe(0);

    await release();
    ok(await deleteProjectAction(P));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).deletedAt).not.toBeNull();
  });

  it("une rafale d'opérations pendant que le verrou est tenu : refus rapides, connexions libérées, autre espace disponible", async () => {
    const P = ok(await createProjectAction({ name: "P" }));
    const tasks = [];
    for (let i = 0; i < 25; i += 1) tasks.push(ok(await createTaskAction({ title: `t${i}` })));
    const other = await createWorkspaceWithUser("structure-lock-other");
    await holdLock(alice.workspaceId);

    const start = Date.now();
    const burst = Promise.all(tasks.map((t) => addTaskToProjectAction(t.id, P, null)));
    // Pendant la rafale, une lecture dans un autre espace reste immédiate.
    await new Promise((r) => setTimeout(r, 60));
    const readStart = Date.now();
    await prisma.user.findFirst({ where: { workspaceId: other.workspaceId } });
    const readMs = Date.now() - readStart;
    const results = await burst;
    const burstMs = Date.now() - start;

    expect(results.every((r) => !r.ok && r.error === STRUCTURE_BUSY_MESSAGE)).toBe(true);
    expect(burstMs).toBeLessThan(3000);
    expect(readMs).toBeLessThan(500);
    // Aucune transaction de l'application ne reste ouverte en attente du verrou.
    const waiting = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND (wait_event_type = 'Lock' OR state = 'idle in transaction') AND query ILIKE '%advisory%' AND application_name <> 'holder'`,
    );
    expect(waiting[0].n).toBeLessThanOrEqual(1); // seule la session qui détient le verrou
    expect(await prisma.taskProject.count({ where: { projectId: P } })).toBe(0); // rien écrit

    await release();
    ok(await addTaskToProjectAction(tasks[0].id, P, null));
    expect(await prisma.taskProject.count({ where: { projectId: P } })).toBe(1);
  });
});
