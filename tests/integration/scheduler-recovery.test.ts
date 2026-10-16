import { spawn, type ChildProcess } from "node:child_process";

import { Client } from "pg";

import { beforeEach, describe, expect, it } from "vitest";

import { createTaskAction } from "@/app/(app)/tasks/work-actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { REMINDER_JOB } from "@/lib/tasks/task-reminders";
import type { ActionResult } from "@/lib/tasks/types";

import { addUserToWorkspace, createWorkspaceWithUser, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Reprise du planificateur avec de **vrais processus** distincts
 * (`tests/scheduler/reminder-worker.mts` exécute `runTaskReminders` contre la
 * base de test) : arrêt brutal du détenteur du bail, ancien détenteur
 * suspendu puis réveillé, arrêt entre la notification et sa validation.
 */

const TTL = 3000;
// Les processus de test démarrent `tsx` (quelques secondes chacun).
const TIMEOUT = 90_000;
const TASKS = 6;

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Worker {
  child: ChildProcess;
  lines: string[];
  exit: Promise<number | null>;
  waitFor: (line: string, timeoutMs?: number) => Promise<void>;
  report: () => Record<string, unknown> | null;
}

function startWorker(args: string[] = []): Worker {
  const child = spawn("node", ["--conditions=react-server", "--import", "tsx", "tests/scheduler/reminder-worker.mts", "--ttl", String(TTL), ...args], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let buffer = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    lines.push(...parts);
  });
  child.stderr!.on("data", (chunk: Buffer) => lines.push(`stderr ${chunk.toString().trim()}`));
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    lines,
    exit,
    waitFor: async (line, timeoutMs = 30_000) => {
      const start = Date.now();
      while (!lines.includes(line)) {
        if (Date.now() - start > timeoutMs) throw new Error(`« ${line} » non reçu ; journal : ${lines.join(" | ")}`);
        await sleep(20);
      }
    },
    report: () => {
      const line = lines.find((l) => l.startsWith("report "));
      return line ? JSON.parse(line.slice(7)) : null;
    },
  };
}

const notificationsPerKey = () =>
  prisma.notification.groupBy({ by: ["dedupeKey"], where: { type: "DUE_SOON" }, _count: { _all: true } });
const lease = () => prisma.jobLease.findUniqueOrThrow({ where: { job: REMINDER_JOB } });

async function waitLeaseExpiry() {
  const { lockedUntil } = await lease();
  if (lockedUntil) await sleep(Math.max(0, lockedUntil.getTime() - Date.now()) + 50);
}

describe("reprise du planificateur après arrêt brutal (processus réels)", { timeout: TIMEOUT }, () => {
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    const alice = await createWorkspaceWithUser("scheduler-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    await signIn(alice);
    const today = dayKey(new Date(), APP_TIME_ZONE);
    for (let i = 0; i < TASKS; i += 1) ok(await createTaskAction({ title: `Échéance ${i}`, assigneeId: bob.userId, dueDate: today }));
  });

  it("le détenteur tué (SIGKILL) : l'autre processus attend l'expiration du bail puis reprend, sans doublon", async () => {
    const a = startWorker(["--delay", "250"]);
    await a.waitFor("delivered 1");
    const killedAt = Date.now();
    a.child.kill("SIGKILL");
    await a.exit;
    const sentByA = await prisma.notification.count({ where: { type: "DUE_SOON" } });
    expect(sentByA).toBeGreaterThanOrEqual(2);
    expect(sentByA).toBeLessThan(TASKS);
    expect((await lease()).lockedBy).toBe(`worker:${a.child.pid}`); // bail abandonné, pas libéré

    // Bail encore valide : la seconde instance n'entre pas.
    const early = startWorker();
    await early.exit;
    expect(early.report()).toMatchObject({ skipped: "locked" });

    await waitLeaseExpiry();
    // B reprend toutes les lignes non validées, y compris une éventuelle
    // ligne déjà notifiée par A (déduplication : pas de seconde notification).
    const pendingBeforeB = await prisma.taskReminder.count({ where: { status: "PENDING" } });
    expect(pendingBeforeB).toBeGreaterThanOrEqual(TASKS - sentByA);
    const b = startWorker();
    await b.exit;
    expect(b.report()).toMatchObject({ sent: pendingBeforeB, failed: 0, pendingLeft: 0 });
    expect(Date.now() - killedAt).toBeGreaterThanOrEqual(TTL - 500); // délai de reprise ≈ durée du bail

    const perKey = await notificationsPerKey();
    expect(perKey).toHaveLength(TASKS);
    expect(perKey.every((k) => k._count._all === 1)).toBe(true);
    expect(await prisma.taskReminder.count({ where: { status: "SENT" } })).toBe(TASKS);
    expect(await lease()).toMatchObject({ lockedUntil: null, lockedBy: `worker:${b.child.pid}`, lastStatus: "SUCCESS" });
  });

  it("un ancien détenteur suspendu ne peut plus traiter après avoir perdu son bail", async () => {
    const a = startWorker(["--delay", "250", "--pause-after-deliver", "1"]);
    await a.waitFor("paused 1");
    a.child.kill("SIGSTOP");
    await sleep(TTL + 300); // le bail de A expire pendant sa suspension

    const b = startWorker();
    await b.exit;
    expect(b.report()).toMatchObject({ failed: 0, pendingLeft: 0 });
    const afterB = await prisma.notification.count({ where: { type: "DUE_SOON" } });
    expect(afterB).toBe(TASKS);

    a.child.kill("SIGCONT");
    await a.exit;
    const reportA = a.report()!;
    expect(reportA.lostLease).toBe(true);
    // A n'a rien envoyé après son réveil : aucune ligne « deliver » ne suit
    // celle où il a été suspendu, sinon pour constater la perte du bail.
    const resumed = a.lines.filter((l) => l.startsWith("delivered ")).map((l) => Number(l.split(" ")[1]));
    expect(Math.max(...resumed)).toBeLessThanOrEqual(1);
    expect(await prisma.notification.count({ where: { type: "DUE_SOON" } })).toBe(TASKS);
    expect((await notificationsPerKey()).every((k) => k._count._all === 1)).toBe(true);
    // A ne libère pas un bail qui n'est plus le sien.
    expect((await lease()).lockedBy).toBe(`worker:${b.child.pid}`);
  });

  it("arrêt entre la création d'une notification et sa validation : la reprise n'en crée pas de seconde", async () => {
    const a = startWorker(["--crash-after-notify", "0"]);
    await a.exit;
    expect(a.lines).toContain("delivered 0");
    expect(a.report()).toBeNull(); // tué avant la fin
    expect(await prisma.notification.count({ where: { type: "DUE_SOON" } })).toBe(1);
    expect(await prisma.taskReminder.count({ where: { status: "PENDING" } })).toBe(TASKS); // rien de validé

    await waitLeaseExpiry();
    const b = startWorker();
    await b.exit;
    expect(b.report()).toMatchObject({ failed: 0, pendingLeft: 0 });
    const perKey = await notificationsPerKey();
    expect(perKey).toHaveLength(TASKS);
    expect(perKey.every((k) => k._count._all === 1)).toBe(true);
    expect(await prisma.taskReminder.count({ where: { status: "SENT" } })).toBe(TASKS);
  });

  it("un processus figé au milieu d'une transaction est évincé par PostgreSQL ; l'autre poursuit sans doublon", async () => {
    // Simule l'écriture d'une notification par un processus suspendu avant son
    // COMMIT : la ligne verrouille la clé de déduplication. Délai court ici
    // (l'application utilise IDLE_IN_TRANSACTION_TIMEOUT_MS = 30 s).
    const reminder = await prisma.task.findFirstOrThrow({ where: { title: "Échéance 0" } });
    const today = dayKey(new Date(), APP_TIME_ZONE);
    const key = `builtin:${reminder.id}:${today}`;
    const frozen = new Client({ connectionString: process.env.TEST_DATABASE_URL!.replace(/\?.*$/, ""), options: "-c idle_in_transaction_session_timeout=2000" });
    frozen.on("error", () => {});
    await frozen.connect();
    await frozen.query("BEGIN");
    await frozen.query(
      `INSERT INTO notifications (id, workspace_id, user_id, type, title, task_id, dedupe_key) VALUES (gen_random_uuid(), $1, $2, 'DUE_SOON', 'figée', $3, $4)`,
      [reminder.workspaceId, bob.userId, reminder.id, key],
    );
    const started = Date.now();
    const b = startWorker();
    await b.exit;
    expect(b.report()).toMatchObject({ failed: 0, pendingLeft: 0 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500); // B a attendu l'éviction
    await frozen.end().catch(() => {});
    const perKey = await notificationsPerKey();
    expect(perKey).toHaveLength(TASKS);
    expect(perKey.every((k) => k._count._all === 1)).toBe(true);
    expect(await prisma.notification.count({ where: { title: "figée" } })).toBe(0); // annulée par l'éviction
  });

  it("l'application applique le délai d'éviction à ses connexions", async () => {
    const { IDLE_IN_TRANSACTION_TIMEOUT_MS } = await import("@/lib/prisma");
    const rows = await prisma.$queryRawUnsafe<{ idle_in_transaction_session_timeout: string }[]>("SHOW idle_in_transaction_session_timeout");
    expect(rows[0].idle_in_transaction_session_timeout).toBe(`${IDLE_IN_TRANSACTION_TIMEOUT_MS / 1000}s`);
  });
});
