import { beforeEach, describe, expect, it } from "vitest";

import {
  addTaskToProjectAction,
  addTimeEntryAction,
  createProjectAction,
  createTaskAction,
  deleteSectionAction,
  deleteTaskAction,
  purgeTaskAction,
  restoreTaskAction,
  saveCustomFieldAction,
  setCustomFieldValueAction,
  setProjectFieldAction,
  setProjectMemberAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { applyTaskAction } from "@/app/(app)/tasks/actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { listTrash } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";
import {
  getMyTasks,
  getProjectBundle,
  getTaskDetail,
  getWorkload,
  listProjects,
  searchTaskIds,
  searchTasks,
} from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createWorkspaceWithUser, formData, resetDatabase, signIn, type TestUser, shareDirectory } from "./fixtures";

/**
 * Complétude fonctionnelle : sections, corbeille, champs partagés,
 * achèvement / réouverture, validation, récurrence, progression, charge et
 * recherche dans la description complète.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const today = () => dayKey(new Date(), APP_TIME_ZONE);

describe("cycle de vie des tâches", () => {
  let alice: TestUser;
  let bob: TestUser;
  let dan: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("lifecycle-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    dan = await addUserToWorkspace(alice.workspaceId, "Dan");
    // Lot A (décision b) : les personnes du scénario partagent un projet « Équipe », donc l'annuaire.
    await shareDirectory(alice, bob, dan);
    await signIn(alice);
  });

  const project = async (name = "Projet", extra: Record<string, unknown> = {}) => {
    const id = ok(await createProjectAction({ name, ...extra }));
    const sections = (await prisma.projectSection.findMany({ where: { projectId: id }, orderBy: { position: "asc" } })).map((s) => s.id);
    return { id, sections };
  };

  it("supprimer une section déplace ses tâches (section choisie ou « Sans section »), sans en supprimer", async () => {
    const { id, sections } = await project();
    const a = ok(await createTaskAction({ title: "A", projectId: id, sectionId: sections[0] }));
    const b = ok(await createTaskAction({ title: "B", projectId: id, sectionId: sections[0] }));
    const c = ok(await createTaskAction({ title: "C", projectId: id, sectionId: sections[1] }));
    const before = await prisma.task.count();

    ok(await deleteSectionAction(sections[0], sections[2]));
    let bundle = await getProjectBundle(actorOf(alice), id);
    const section = (taskId: string) => bundle.tasks.find((t) => t.id === taskId)!.memberships[0].sectionId;
    expect([section(a.id), section(b.id)]).toEqual([sections[2], sections[2]]);

    ok(await deleteSectionAction(sections[1], null));
    bundle = await getProjectBundle(actorOf(alice), id);
    expect(section(c.id)).toBeNull();
    expect(await prisma.task.count()).toBe(before);
    expect(bundle.sections.map((s) => s.id)).toEqual([sections[2]]);
  });

  it("corbeille : suppression douce, restauration, suppression définitive réservée", async () => {
    const { id } = await project();
    ok(await setProjectMemberAction(id, dan.userId, "EDITOR"));
    const parent = ok(await createTaskAction({ title: "Parente", projectId: id }));
    const early = ok(await createTaskAction({ title: "Supprimée avant", parentId: parent.id }));
    const child = ok(await createTaskAction({ title: "Enfant", parentId: parent.id }));
    ok(await deleteTaskAction(early.id));
    ok(await deleteTaskAction(parent.id));

    expect((await getProjectBundle(actorOf(alice), id)).tasks).toEqual([]);
    expect(await searchTasks(actorOf(alice), { search: "Enfant", completion: "all" })).toEqual([]);
    expect(await prisma.task.count({ where: { id: { in: [parent.id, child.id, early.id] } } })).toBe(3); // rien d'effacé

    await signIn(dan);
    const trash = await listTrash(actorOf(dan));
    expect(trash.map((t) => [t.title, t.canRestore, t.canPurge])).toEqual([["Parente", true, false]]);
    expect(await purgeTaskAction(parent.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    ok(await restoreTaskAction(parent.id));
    const subtasks = (await getTaskDetail(actorOf(dan), parent.id)).subtasks.map((s) => s.title);
    // L'enfant revient avec sa parente ; la sous-tâche supprimée avant reste dans la corbeille.
    expect(subtasks).toEqual(["Enfant"]);
    expect((await listTrash(actorOf(dan))).map((t) => t.title)).toEqual(["Supprimée avant"]);

    await signIn(alice);
    ok(await deleteTaskAction(parent.id));
    expect((await listTrash(actorOf(alice))).find((t) => t.id === parent.id)).toMatchObject({ canPurge: true });
    ok(await purgeTaskAction(parent.id));
    expect(await prisma.task.count({ where: { id: { in: [parent.id, child.id] } } })).toBe(0);
    // Une tâche active ne peut pas être purgée directement.
    const live = ok(await createTaskAction({ title: "Active", projectId: id }));
    expect(await purgeTaskAction(live.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("champ partagé : une seule valeur par tâche, quel que soit le projet ; champ propre au projet borné", async () => {
    const p1 = await project("P1");
    const p2 = await project("P2");
    const shared = ok(await saveCustomFieldAction(null, { name: "Client", type: "TEXT" }, null));
    ok(await setProjectFieldAction(p1.id, shared, true));
    ok(await setProjectFieldAction(p2.id, shared, true));
    const task = ok(await createTaskAction({ title: "Multi", projectId: p1.id }));
    ok(await addTaskToProjectAction(task.id, p2.id, null));
    ok(await setCustomFieldValueAction(task.id, shared, "ACME"));
    ok(await setCustomFieldValueAction(task.id, shared, "ACME SA"));
    expect(await prisma.taskCustomFieldValue.count({ where: { taskId: task.id, fieldId: shared } })).toBe(1);
    for (const p of [p1.id, p2.id]) {
      expect((await getProjectBundle(actorOf(alice), p)).tasks[0].custom[shared]).toBe("ACME SA");
    }

    const own = ok(await saveCustomFieldAction(null, { name: "Lot P1", type: "TEXT" }, p1.id));
    expect(await setProjectFieldAction(p2.id, own, true)).toMatchObject({ ok: false });
    const outside = ok(await createTaskAction({ title: "Hors P1", projectId: p2.id }));
    expect(await setCustomFieldValueAction(outside.id, own, "x")).toMatchObject({ ok: false });
    ok(await setCustomFieldValueAction(task.id, own, "Lot 3"));
  });

  it("achèvement cohérent ; la réouverture revient au dernier statut actif", async () => {
    const task = ok(await createTaskAction({ title: "Statut", assigneeId: alice.userId }));
    ok(await updateTaskAction(task.id, { status: "WAITING" }));
    const done = ok(await updateTaskAction(task.id, { status: "DONE" }));
    expect(done).toMatchObject({ status: "DONE", lastActiveStatus: "WAITING" });
    expect(done.completedAt).not.toBeNull();
    // Ancienne action rapide « Rouvrir » (cockpit).
    await applyTaskAction(formData({ id: task.id, intent: "reopen" }));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: "WAITING", completedAt: null });
  });

  it("validation : approbation exigée avant de terminer, nouvelle soumission après demande de modifications", async () => {
    const request = ok(await createTaskAction({ title: "Valider le devis", assigneeId: bob.userId, isApproval: true }));
    expect(await updateTaskAction(request.id, { status: "DONE" })).toMatchObject({ ok: false });
    expect(await updateTaskAction(request.id, { approvalStatus: "APPROVED" })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    await signIn(bob);
    const changes = ok(await updateTaskAction(request.id, { approvalStatus: "CHANGES_REQUESTED" }));
    expect(changes.status).not.toBe("DONE");

    await signIn(alice);
    ok(await updateTaskAction(request.id, { approvalStatus: "PENDING" }));
    expect(await prisma.notification.findFirst({ where: { userId: bob.userId, title: { startsWith: "Validation demandée à nouveau" } } })).not.toBeNull();

    await signIn(bob);
    const approved = ok(await updateTaskAction(request.id, { approvalStatus: "APPROVED" }));
    expect(approved).toMatchObject({ status: "DONE", approvalStatus: "APPROVED" });
    expect(approved.completedAt).not.toBeNull();
  });

  it("récurrence : occurrence suivante unique, statut et temps remis à zéro, historique conservé", async () => {
    const due = today();
    const task = ok(await createTaskAction({ title: "Rapport", dueDate: due, assigneeId: alice.userId }));
    ok(await updateTaskAction(task.id, { recurrence: { freq: "DAILY", interval: 1 }, status: "IN_PROGRESS" }));
    ok(await addTimeEntryAction(task.id, { minutes: 45, date: due }));
    ok(await updateTaskAction(task.id, { status: "DONE" }));
    ok(await updateTaskAction(task.id, { status: "IN_PROGRESS" }));
    ok(await updateTaskAction(task.id, { status: "DONE" }));

    const next = await prisma.task.findMany({ where: { recurrenceOriginId: task.id } });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ status: "TODO", completedAt: null });
    expect(dayKey(next[0].dueAt!, APP_TIME_ZONE)).toBe(addDaysToKey(due, 1));
    const nextItem = (await getTaskDetail(actorOf(alice), next[0].id)).task;
    expect(nextItem.spentMinutes).toBe(0);

    const old = await getTaskDetail(actorOf(alice), task.id);
    expect(old.task.spentMinutes).toBe(45);
    expect(old.activity.filter((a) => a.kind === "recurrence_spawned")).toHaveLength(1);
    expect(old.activity.some((a) => a.kind === "time_logged")).toBe(true);
    expect(await prisma.taskActivity.count({ where: { taskId: next[0].id, kind: "time_logged" } })).toBe(0);
  });

  it("progression : tâches principales non supprimées seulement", async () => {
    const { id } = await project();
    const a = ok(await createTaskAction({ title: "A", projectId: id }));
    const b = ok(await createTaskAction({ title: "B", projectId: id }));
    const c = ok(await createTaskAction({ title: "C", projectId: id }));
    for (let i = 0; i < 3; i += 1) ok(await createTaskAction({ title: `Sous ${i}`, parentId: a.id }));
    ok(await updateTaskAction(b.id, { status: "DONE" }));
    ok(await deleteTaskAction(c.id));
    const row = (await listProjects(actorOf(alice))).find((p) => p.id === id)!;
    expect(row).toMatchObject({ taskCount: 2, doneCount: 1 });
  });

  it("charge : période, tâches sans date à part, capacité individuelle", async () => {
    await prisma.user.update({ where: { id: bob.userId }, data: { weeklyCapacityMinutes: 20 * 60 } });
    ok(await createTaskAction({ title: "Estimée", assigneeId: bob.userId, dueDate: addDaysToKey(today(), 2), estimatedMinutes: 120 }));
    ok(await createTaskAction({ title: "Sans date", assigneeId: bob.userId }));
    ok(await createTaskAction({ title: "Lointaine", assigneeId: bob.userId, dueDate: addDaysToKey(today(), 200), estimatedMinutes: 60 }));
    const data = await getWorkload(actorOf(alice), today(), 4);
    expect(data.tasks.map((t) => t.title).sort()).toEqual(["Estimée", "Sans date"]);
    expect(data.capacities[bob.userId]).toBe(1200);
    expect(data.capacities[alice.userId]).toBeNull();
  });

  it("recherche projet et Mes tâches : un mot au-delà des 300 premiers caractères de la description", async () => {
    const { id } = await project();
    const description = `${"Contexte détaillé. ".repeat(40)}Mot-clé : zanzibar.`;
    const task = ok(await createTaskAction({ title: "Longue description", projectId: id, assigneeId: alice.userId, description }));
    const item = (await getMyTasks(actorOf(alice))).find((t) => t.id === task.id)!;
    expect(item.excerpt.includes("zanzibar")).toBe(false); // le client ne l'a pas
    expect(await searchTaskIds(actorOf(alice), { search: "zanzibar", projectIds: [id], completion: "all" })).toEqual([task.id]);
    expect(await searchTaskIds(actorOf(alice), { search: "zanzibar", assigneeIds: ["me"], completion: "all" })).toEqual([task.id]);
  });
});
