import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createProjectAction,
  createTaskAction,
  deleteProjectAction,
  duplicateProjectAction,
  previewProjectPurgeAction,
  purgeProjectAction,
  restoreProjectAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { prisma } from "@/lib/prisma";
import { setTestHook } from "@/lib/tasks/test-hooks";
import type { ActionResult } from "@/lib/tasks/types";

import { createWorkspaceWithUser, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Hypothèses de la revue c580137, vérifiées par l'exécution :
 *   - arrêt entre l'achèvement d'une tâche récurrente et la création de
 *     l'occurrence suivante ;
 *   - interblocages entre purges simultanées de projets partageant des tâches ;
 *   - durée des transactions sur un projet volumineux (1 000 tâches).
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}

describe("hypothèses : récurrence, purges simultanées, projet volumineux", () => {
  let alice: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("hypotheses");
    await signIn(alice);
  });
  afterEach(() => setTestHook(null));

  it("un arrêt avant la création de l'occurrence ne laisse pas une tâche terminée sans occurrence suivante", async () => {
    const P = ok(await createProjectAction({ name: "Récurrent" }));
    const task = ok(await createTaskAction({ title: "Hebdo", projectId: P, dueDate: "2026-10-15" }));
    ok(await updateTaskAction(task.id, { recurrence: { freq: "WEEKLY", interval: 1 } }));

    // Panne simulée au moment de créer l'occurrence (arrêt du processus, erreur base…).
    setTestHook((point) => {
      if (point === "spawnNextOccurrence:start") throw new Error("arrêt simulé");
    });
    const first = await updateTaskAction(task.id, { status: "DONE" });
    setTestHook(null);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const occurrences = await prisma.task.count({ where: { recurrenceOriginId: task.id } });
    console.log("[hypothèse récurrence]", JSON.stringify({ actionOk: first.ok, status: row.status, occurrences }));
    // Invariant : terminée ⇒ occurrence suivante créée.
    expect(row.status === "DONE" ? occurrences : 1).toBe(1);

    // Nouvelle tentative : l'achèvement et l'occurrence passent ensemble.
    if (row.status !== "DONE") {
      ok(await updateTaskAction(task.id, { status: "DONE" }));
      expect(await prisma.task.count({ where: { recurrenceOriginId: task.id } })).toBe(1);
    }
  });

  it("purges simultanées de projets partageant des tâches : aucun interblocage, résultat cohérent", async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 8; round += 1) {
      const P = ok(await createProjectAction({ name: `P${round}` }));
      const Q = ok(await createProjectAction({ name: `Q${round}` }));
      const ws = alice.workspaceId;
      // 40 tâches partagées, mises à la corbeille avec chacun des deux projets.
      const ids = Array.from({ length: 40 }, () => crypto.randomUUID());
      await prisma.task.createMany({ data: ids.map((id, i) => ({ id, workspaceId: ws, title: `Partagée ${i}` })) });
      await prisma.taskProject.createMany({
        data: ids.flatMap((taskId, i) => [
          { taskId, projectId: P, workspaceId: ws, position: i },
          { taskId, projectId: Q, workspaceId: ws, position: 40 - i },
        ]),
      });
      ok(await deleteProjectAction(P));
      ok(await deleteProjectAction(Q));
      const [pp, pq] = [ok(await previewProjectPurgeAction(P)), ok(await previewProjectPurgeAction(Q))];
      const results = await Promise.all([purgeProjectAction(P, pp.token), purgeProjectAction(Q, pq.token)]);
      for (const r of results) outcomes.push(r.ok ? r.data.status : `erreur:${r.error}`);
      // Cohérence : plus aucune des tâches ne reste liée à un projet effacé, aucune n'est libre.
      const remaining = await prisma.task.findMany({ where: { id: { in: ids } }, include: { projects: true } });
      for (const t of remaining) expect(t.deletedAt === null && t.projects.length === 0).toBe(false);
    }
    console.log("[hypothèse purges]", JSON.stringify(outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o]: (acc[o] ?? 0) + 1 }), {})));
    expect(outcomes.filter((o) => o.startsWith("erreur"))).toEqual([]);
  });

  it("projet de 1 000 tâches : duplication, suppression, restauration et purge dans les délais", { timeout: 300_000 }, async () => {
    // `HYP_TASKS` permet de mesurer d'autres volumes (1 000 par défaut).
    const size = Number(process.env.HYP_TASKS ?? 1000);
    const P = ok(await createProjectAction({ name: "Volumineux" }));
    const ws = alice.workspaceId;
    const ids = Array.from({ length: size }, () => crypto.randomUUID());
    await prisma.task.createMany({ data: ids.map((id, i) => ({ id, workspaceId: ws, title: `Tâche ${i}`, createdById: alice.userId })) });
    await prisma.taskProject.createMany({ data: ids.map((taskId, i) => ({ taskId, projectId: P, workspaceId: ws, position: i })) });
    await prisma.task.createMany({
      data: ids.slice(0, Math.round(size * 0.3)).map((parentId, i) => ({ workspaceId: ws, title: `Sous-tâche ${i}`, parentId, createdById: alice.userId })),
    });

    const timed = async <T>(label: string, fn: () => Promise<ActionResult<T>>) => {
      const start = Date.now();
      const result = await fn();
      const ms = Date.now() - start;
      console.log(`[hypothèse volume] ${label} : ${ms} ms, ${result.ok ? "ok" : `échec — ${result.error}`}`);
      return { result, ms };
    };
    const dup = await timed("duplication", () => duplicateProjectAction(P, { name: "Copie", includeTasks: true }));
    const del = await timed("suppression", () => deleteProjectAction(P));
    const res = await timed("restauration", () => restoreProjectAction(P));
    ok(await deleteProjectAction(P));
    const preview = ok(await previewProjectPurgeAction(P));
    const pur = await timed("purge", () => purgeProjectAction(P, preview.token));
    for (const step of [dup, del, res, pur]) expect(step.result.ok).toBe(true);
    if (dup.result.ok) expect(await prisma.taskProject.count({ where: { projectId: dup.result.data as string } })).toBe(size);
  });
});
