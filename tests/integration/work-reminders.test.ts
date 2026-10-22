import { beforeEach, describe, expect, it } from "vitest";

import { createProjectAction, createTaskAction, saveRuleAction, setProjectMemberAction, updateTaskAction } from "@/app/(app)/tasks/work-actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { acquireLease } from "@/lib/tasks/jobs";
import { REMINDER_JOB, runTaskReminders } from "@/lib/tasks/task-reminders";
import type { ActionResult } from "@/lib/tasks/types";

import { addUserToWorkspace, createWorkspaceWithUser, dropCookie, resetDatabase, signIn, type TestUser, shareDirectory } from "./fixtures";

/**
 * Rappels d'échéance planifiés : exécution sans session, fuseau horaire,
 * déduplication commune (rappel intégré + règles), exécutions simultanées,
 * reprise après interruption et politique des rappels anciens.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const today = () => dayKey(new Date(), APP_TIME_ZONE);
const dueSoon = (userId: string) => prisma.notification.count({ where: { userId, type: "DUE_SOON" } });

describe("rappels d'échéance planifiés", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("reminders-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    // Lot A (décision b) : les personnes du scénario partagent un projet « Équipe », donc l'annuaire.
    await shareDirectory(alice, bob);
    await signIn(alice);
  });

  it("s'exécute sans aucune session ni requête", async () => {
    ok(await createTaskAction({ title: "Demain", assigneeId: bob.userId, dueDate: addDaysToKey(today(), 1) }));
    dropCookie();
    const report = await runTaskReminders();
    expect(report).toMatchObject({ planned: 1, sent: 1, failed: 0 });
    const notification = await prisma.notification.findFirstOrThrow({ where: { userId: bob.userId, type: "DUE_SOON" } });
    expect(notification.title).toBe("Échéance demain : Demain");
    const lease = await prisma.jobLease.findUniqueOrThrow({ where: { job: REMINDER_JOB } });
    expect(lease).toMatchObject({ lockedUntil: null, lastStatus: "SUCCESS" });
  });

  it("calcule « aujourd'hui » dans le fuseau de l'application, pas celui du serveur", async () => {
    const due = addDaysToKey(today(), 3);
    ok(await createTaskAction({ title: "Fuseau", assigneeId: bob.userId, dueDate: due }));
    const dayBefore = addDaysToKey(due, -1);
    // Une minute avant minuit (heure de l'application) l'avant-veille : rien.
    await runTaskReminders({ now: new Date(startOfDay(dayBefore, APP_TIME_ZONE).getTime() - 60_000) });
    expect(await dueSoon(bob.userId)).toBe(0);
    // Une minute après minuit, la veille : le rappel part, quel que soit l'UTC.
    await runTaskReminders({ now: new Date(startOfDay(dayBefore, APP_TIME_ZONE).getTime() + 60_000) });
    expect(await dueSoon(bob.userId)).toBe(1);
  });

  it("une seule déduplication pour le rappel intégré et les règles", async () => {
    const project = ok(await createProjectAction({ name: "Règles" }));
    // Lot A : un responsable ne lit la tâche (et n'en reçoit les rappels) que s'il lit son projet.
    ok(await setProjectMemberAction(project, bob.userId, "EDITOR"));
    const rule = ok(await saveRuleAction(null, project, { name: "J-2", trigger: "DUE_DATE_APPROACHING", triggerConfig: { days: 2 }, conditions: [], actions: [{ kind: "create_reminder" }], isEnabled: true }));
    const task = ok(await createTaskAction({ title: "Doublon ?", projectId: project, assigneeId: bob.userId, dueDate: addDaysToKey(today(), 1) }));
    dropCookie();
    for (let i = 0; i < 3; i += 1) await runTaskReminders();

    const due = addDaysToKey(today(), 1);
    const reminders = await prisma.taskReminder.findMany({ orderBy: { reminderKey: "asc" } });
    expect(reminders.map((r) => [r.reminderKey, r.status])).toEqual([
      [`builtin:${task.id}:${due}`, "SENT"],
      [`rule:${rule}:${task.id}:${due}`, "SENT"],
    ]);
    // Même clé en aval : notification (dedupe_key) et exécution de règle (event_key).
    expect(await dueSoon(bob.userId)).toBe(2);
    expect(await prisma.automationRun.findMany({ select: { eventKey: true } })).toEqual([{ eventKey: `rule:${rule}:${task.id}:${due}` }]);
  });

  it("deux exécutions simultanées : une seule travaille", async () => {
    for (let i = 0; i < 5; i += 1) ok(await createTaskAction({ title: `T${i}`, assigneeId: bob.userId, dueDate: today() }));
    dropCookie();
    const reports = await Promise.all([runTaskReminders(), runTaskReminders(), runTaskReminders()]);
    expect(reports.filter((r) => r.skipped === "locked").length).toBeGreaterThanOrEqual(1);
    expect(await dueSoon(bob.userId)).toBe(5);
    // Un bail tenu par une autre instance bloque ; expiré, il est repris.
    await prisma.jobLease.update({ where: { job: REMINDER_JOB }, data: { lockedUntil: new Date(Date.now() + 60_000), lockedBy: "autre" } });
    expect((await runTaskReminders()).skipped).toBe("locked");
    expect(await acquireLease(REMINDER_JOB, "moi", 60_000)).toBe(false);
    await prisma.jobLease.update({ where: { job: REMINDER_JOB }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await runTaskReminders()).skipped).toBeUndefined();
  });

  it("reprend les rappels réservés mais non envoyés après une interruption", async () => {
    const task = ok(await createTaskAction({ title: "Interrompu", assigneeId: bob.userId, dueDate: today() }));
    // Processus tué après la réservation, bail resté pris (expiré depuis).
    await prisma.taskReminder.create({ data: { workspaceId: alice.workspaceId, taskId: task.id, kind: "builtin", dueKey: today(), reminderKey: `builtin:${task.id}:${today()}` } });
    await prisma.jobLease.create({ data: { job: REMINDER_JOB, lockedUntil: new Date(Date.now() - 1000), lockedBy: "processus-tué" } });
    dropCookie();
    const report = await runTaskReminders();
    expect(report).toMatchObject({ planned: 0, sent: 1 });
    expect(await dueSoon(bob.userId)).toBe(1);
    // Même si la notification était partie juste avant l'arrêt : jamais deux fois.
    await prisma.taskReminder.updateMany({ data: { status: "PENDING" } });
    await runTaskReminders();
    expect(await dueSoon(bob.userId)).toBe(1);
  });

  it("politique des rappels anciens : pas de rattrapage, revalidation avant envoi", async () => {
    const overdue = ok(await createTaskAction({ title: "En retard", assigneeId: bob.userId, dueDate: addDaysToKey(today(), -2) }));
    const moved = ok(await createTaskAction({ title: "Déplacée", assigneeId: bob.userId, dueDate: today() }));
    const done = ok(await createTaskAction({ title: "Faite", assigneeId: bob.userId, dueDate: today() }));
    const yesterday = addDaysToKey(today(), -1);
    // Une réservation restée en attente depuis hier (serveur arrêté) : périmée.
    await prisma.taskReminder.create({ data: { workspaceId: alice.workspaceId, taskId: overdue.id, kind: "builtin", dueKey: yesterday, reminderKey: `builtin:${overdue.id}:${yesterday}` } });
    // Réservées, puis l'échéance change / la tâche est terminée avant l'envoi.
    for (const t of [moved, done]) {
      await prisma.taskReminder.create({ data: { workspaceId: alice.workspaceId, taskId: t.id, kind: "builtin", dueKey: today(), reminderKey: `builtin:${t.id}:${today()}` } });
    }
    ok(await updateTaskAction(moved.id, { dueDate: addDaysToKey(today(), 10) }));
    ok(await updateTaskAction(done.id, { status: "DONE" }));
    dropCookie();

    const report = await runTaskReminders();
    expect(report).toMatchObject({ planned: 0, sent: 0, skippedStale: 3 });
    expect(await dueSoon(bob.userId)).toBe(0);
    const reasons = (await prisma.taskReminder.findMany({ select: { status: true, lastError: true } })).map((r) => `${r.status} ${r.lastError}`);
    expect(reasons.sort()).toEqual([
      "SKIPPED Tâche terminée.",
      "SKIPPED Échéance dépassée : rappel trop ancien.",
      "SKIPPED Échéance modifiée depuis la planification.",
    ]);
  });

  it("ignore la corbeille, les modèles et les tâches non affectées", async () => {
    const trashed = ok(await createTaskAction({ title: "Corbeille", assigneeId: bob.userId, dueDate: today() }));
    await prisma.task.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    ok(await createTaskAction({ title: "Personne", assigneeId: null, dueDate: today() }));
    dropCookie();
    expect(await runTaskReminders()).toMatchObject({ planned: 0, sent: 0 });
  });
});
