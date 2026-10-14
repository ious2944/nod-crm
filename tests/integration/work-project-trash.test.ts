import { beforeEach, describe, expect, it } from "vitest";

import {
  addCommentAction,
  addTaskToProjectAction,
  createProjectAction,
  createTaskAction,
  deleteProjectAction,
  deleteTaskAction,
  purgeProjectAction,
  restoreProjectAction,
  restoreTaskAction,
  saveCustomFieldAction,
  saveRuleAction,
  setCustomFieldValueAction,
  setProjectMemberAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { listProjectTrash } from "@/lib/tasks/project-service";
import { listTrash } from "@/lib/tasks/service";
import { runTaskReminders } from "@/lib/tasks/task-reminders";
import type { ActionResult } from "@/lib/tasks/types";
import {
  getLinkedWork,
  getProjectBundle,
  getTaskDetail,
  getWorkContext,
  listNotifications,
  listProjects,
  searchTasks,
} from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createContactRecord, createWorkspaceWithUser, dropCookie, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Corbeille des projets : suppression logique, permissions conservées,
 * restauration, suppression définitive distincte.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const today = () => dayKey(new Date(), APP_TIME_ZONE);

describe("suppression et restauration des projets", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser, eve: TestUser;
  let P: string, W: string, sectionId: string, contactId: string, field: string;
  let exclusive: string, sub: string, earlierSub: string, earlier: string, shared: string;

  const upload = async (taskId: string) => {
    const body = new FormData();
    body.append("file", new File([new TextEncoder().encode("brief")], "brief.txt"));
    const response = await attachmentPost(
      new Request(`http://localhost/api/tasks/items/${taskId}/attachments`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(201);
  };
  const counts = async (taskId: string) => ({
    comments: await prisma.comment.count({ where: { taskId } }),
    attachments: await prisma.taskAttachment.count({ where: { taskId } }),
    values: await prisma.taskCustomFieldValue.count({ where: { taskId } }),
    activities: await prisma.taskActivity.count({ where: { taskId, kind: { notIn: ["project_trashed", "project_restored"] } } }),
    memberships: await prisma.taskProject.count({ where: { taskId } }),
    subtasks: await prisma.task.count({ where: { parentId: taskId } }),
    contact: (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).contactId,
  });

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("ptrash-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    eve = await addUserToWorkspace(alice.workspaceId, "Eve");
    await signIn(alice);
    P = ok(await createProjectAction({ name: "Projet privé", visibility: "PRIVATE" }));
    W = ok(await createProjectAction({ name: "Projet ouvert" }));
    ok(await setProjectMemberAction(P, carol.userId, "EDITOR"));
    sectionId = (await prisma.projectSection.findFirstOrThrow({ where: { projectId: P, name: "En cours" } })).id;
    contactId = await createContactRecord(alice.workspaceId, { firstName: "Camille", lastName: "Client" });
    field = ok(await saveCustomFieldAction(null, { name: "Lot", type: "TEXT" }, P));

    exclusive = ok(await createTaskAction({ title: "Exclusive privée", projectId: P, sectionId, assigneeId: bob.userId, contactId, dueDate: addDaysToKey(today(), 1) })).id;
    sub = ok(await createTaskAction({ title: "Sous-tâche", parentId: exclusive })).id;
    earlierSub = ok(await createTaskAction({ title: "Sous-tâche supprimée avant", parentId: exclusive })).id;
    ok(await addCommentAction(exclusive, "Commentaire"));
    ok(await setCustomFieldValueAction(exclusive, field, "Lot 7"));
    await upload(exclusive);
    earlier = ok(await createTaskAction({ title: "Supprimée avant", projectId: P })).id;
    shared = ok(await createTaskAction({ title: "Partagée", projectId: P })).id;
    ok(await addTaskToProjectAction(shared, W, null));
    ok(await deleteTaskAction(earlierSub));
    ok(await deleteTaskAction(earlier));
  });

  it("supprimer un projet privé : il disparaît, ses tâches ne deviennent jamais visibles de l'espace", async () => {
    const before = await counts(exclusive);
    const result = ok(await deleteProjectAction(P));
    expect(result).toEqual({ deletedTasks: 1, keptTasks: 1 });

    expect((await listProjects(actorOf(alice))).map((p) => p.id)).toEqual([W]);
    expect((await getWorkContext(actorOf(alice))).projects.map((p) => p.id)).toEqual([W]);
    expect((await getWorkContext(actorOf(alice))).fields.map((f) => f.id)).not.toContain(field);
    await expect(getProjectBundle(actorOf(alice), P)).rejects.toThrow();

    for (const user of [alice, bob, carol, eve]) {
      await signIn(user);
      await expect(getTaskDetail(actorOf(user), exclusive), user.email).rejects.toThrow();
      await expect(getTaskDetail(actorOf(user), sub)).rejects.toThrow();
      expect((await searchTasks(actorOf(user), { search: "privée", completion: "all" })).map((t) => t.id)).toEqual([]);
      expect((await getLinkedWork(actorOf(user), "contact", contactId)).tasks).toEqual([]);
      // Corbeille des tâches : ni la tâche du projet, ni celle supprimée avant
      // (son seul projet est dans la corbeille : elle n'est pas « libre »).
      expect((await listTrash(actorOf(user))).map((t) => t.id)).toEqual([]);
      expect(await updateTaskAction(exclusive, { title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await restoreTaskAction(exclusive)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    await signIn(bob);
    expect((await listNotifications(actorOf(bob))).some((n) => n.taskId === exclusive)).toBe(false);

    // Rien n'est perdu.
    expect(await counts(exclusive)).toEqual(before);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: exclusive } });
    expect(row).toMatchObject({ deletedWithProjectId: P, assigneeId: bob.userId });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: sub } })).deletedWithProjectId).toBe(P);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: earlier } })).deletedWithProjectId).toBeNull();
  });

  it("la tâche partagée reste disponible dans l'autre projet, sans trace du projet supprimé", async () => {
    ok(await deleteProjectAction(P));
    const bundle = await getProjectBundle(actorOf(alice), W);
    const item = bundle.tasks.find((t) => t.id === shared)!;
    expect(item.memberships.map((m) => m.projectId)).toEqual([W]);
    const detail = await getTaskDetail(actorOf(alice), shared);
    expect(detail.projects.map((p) => p.id)).toEqual([W]);
    expect(JSON.stringify(detail)).not.toContain("Projet privé");
    expect(await prisma.taskProject.count({ where: { taskId: shared, projectId: P } })).toBe(1); // rattachement conservé
    ok(await updateTaskAction(shared, { title: "Partagée modifiée" }));
  });

  it("corbeille des projets : réservée au propriétaire", async () => {
    ok(await deleteProjectAction(P));
    expect((await listProjectTrash(actorOf(alice))).map((p) => [p.name, p.taskCount, p.canRestore, p.canPurge])).toEqual([["Projet privé", 2, true, true]]);
    for (const user of [carol, bob, eve]) {
      await signIn(user);
      expect(await listProjectTrash(actorOf(user))).toEqual([]);
      expect(await restoreProjectAction(P)).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await purgeProjectAction(P)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    await signIn(alice);
    // Une suppression définitive exige que le projet soit d'abord à la corbeille.
    expect(await purgeProjectAction(W)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("rappels et automatisations ignorent les tâches inactives", async () => {
    ok(await saveRuleAction(null, P, { name: "Rappel P", trigger: "DUE_DATE_APPROACHING", triggerConfig: { days: 3 }, conditions: [], actions: [{ kind: "create_reminder" }], isEnabled: true }));
    ok(await saveRuleAction(null, P, { name: "Statut P", trigger: "STATUS_CHANGED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "URGENT" }], isEnabled: true }));
    ok(await updateTaskAction(shared, { assigneeId: bob.userId, dueDate: addDaysToKey(today(), 1) }));
    await prisma.automationRun.deleteMany();
    ok(await deleteProjectAction(P));

    ok(await updateTaskAction(shared, { status: "IN_PROGRESS" })); // règle de P : ne s'exécute plus
    expect(await prisma.automationRun.count()).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: shared } })).priority).toBe("NORMAL");

    dropCookie();
    await runTaskReminders();
    const reminders = await prisma.taskReminder.findMany({ select: { taskId: true, kind: true } });
    // Seul le rappel intégré de la tâche partagée (active dans W) ; rien pour l'exclusive ni pour la règle de P.
    expect(reminders).toEqual([{ taskId: shared, kind: "builtin" }]);
  });

  it("restaurer rétablit sections et rattachements, sans les tâches supprimées avant lui", async () => {
    ok(await deleteProjectAction(P));
    ok(await restoreProjectAction(P));

    const bundle = await getProjectBundle(actorOf(alice), P);
    const ids = bundle.tasks.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([exclusive, sub, shared]));
    expect(ids).not.toContain(earlier);
    expect(ids).not.toContain(earlierSub);
    expect(bundle.tasks.find((t) => t.id === exclusive)!.memberships[0].sectionId).toBe(sectionId);
    expect(bundle.sections.map((s) => s.name)).toEqual(["À faire", "En cours", "Terminé"]);
    expect(bundle.tasks.find((t) => t.id === exclusive)!.custom[field]).toBe("Lot 7");
    // Les suppressions individuelles restent dans la corbeille des tâches, restaurables.
    expect((await listTrash(actorOf(alice))).map((t) => t.title).sort()).toEqual(["Sous-tâche supprimée avant", "Supprimée avant"]);
    await signIn(bob);
    expect((await getTaskDetail(actorOf(bob), exclusive)).subtasks.map((s) => s.id)).toEqual([sub]);
  });

  it("suppression définitive : action distincte, n'efface pas une tâche liée à un autre projet conservé", async () => {
    ok(await deleteProjectAction(P));
    const result = ok(await purgeProjectAction(P));
    expect(result).toMatchObject({ purgedTasks: 2 }); // l'exclusive et celle supprimée avant
    expect(await prisma.project.count({ where: { id: P } })).toBe(0);
    expect(await prisma.task.count({ where: { id: { in: [exclusive, sub, earlier, earlierSub] } } })).toBe(0);
    expect(await prisma.taskAttachment.count()).toBe(0);
    expect((await getProjectBundle(actorOf(alice), W)).tasks.map((t) => t.id)).toEqual([shared]);
  });

  it("une tâche de deux projets supprimés suit celui qui est conservé", async () => {
    const Q = ok(await createProjectAction({ name: "Q", visibility: "PRIVATE" }));
    const both = ok(await createTaskAction({ title: "P et Q", projectId: P })).id;
    ok(await addTaskToProjectAction(both, Q, null));
    ok(await deleteProjectAction(Q)); // encore active dans P
    expect((await prisma.task.findUniqueOrThrow({ where: { id: both } })).deletedAt).toBeNull();
    ok(await deleteProjectAction(P)); // plus aucun projet actif : à la corbeille avec P
    expect((await prisma.task.findUniqueOrThrow({ where: { id: both } })).deletedWithProjectId).toBe(P);

    ok(await purgeProjectAction(P)); // Q est conservé (corbeille) : la tâche n'est pas effacée
    expect((await prisma.task.findUniqueOrThrow({ where: { id: both } })).deletedWithProjectId).toBe(Q);
    ok(await restoreProjectAction(Q));
    expect((await getProjectBundle(actorOf(alice), Q)).tasks.map((t) => t.id)).toEqual([both]);
  });

  it("restaurer un projet réactive aussi une tâche rendue inactive par un autre projet supprimé", async () => {
    const Q = ok(await createProjectAction({ name: "Q2" }));
    const both = ok(await createTaskAction({ title: "P et Q2", projectId: P })).id;
    ok(await addTaskToProjectAction(both, Q, null));
    ok(await deleteProjectAction(Q));
    ok(await deleteProjectAction(P));
    ok(await restoreProjectAction(Q));
    const bundle = await getProjectBundle(actorOf(alice), Q);
    expect(bundle.tasks.map((t) => t.id)).toEqual([both]);
    expect(bundle.tasks[0].memberships.map((m) => m.projectId)).toEqual([Q]); // P toujours dans la corbeille
  });
});
