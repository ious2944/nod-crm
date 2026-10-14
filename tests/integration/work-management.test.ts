import { beforeEach, describe, expect, it } from "vitest";

import {
  addCommentAction,
  addDependencyAction,
  addTaskToProjectAction,
  archiveProjectAction,
  createProjectAction,
  createSectionAction,
  createTaskAction,
  deleteProjectAction,
  duplicateProjectAction,
  importCsvAction,
  moveTaskAction,
  saveRuleAction,
  setProjectMemberAction,
  setTaskTagsAction,
  createTagAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { createTask as legacyCreateTask } from "@/app/(app)/tasks/actions";
import { GET as attachmentGet } from "@/app/api/tasks/attachments/[id]/route";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { GET as exportGet } from "@/app/api/tasks/export/route";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { initialCreateTaskState } from "@/lib/tasks/create-state";
import type { ActionResult, TaskItem } from "@/lib/tasks/types";
import { runTaskReminders } from "@/lib/tasks/task-reminders";
import {
  getLinkedWork,
  getMyTasks,
  getProjectBundle,
  getTaskDetail,
  searchTasks,
} from "@/lib/tasks/work-queries";

import {
  addUserToWorkspace,
  createContactRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Module de gestion de travail (V1.0), de bout en bout contre PostgreSQL.
 * Reprend les vérifications demandées : synchronisation des vues (une seule
 * donnée), persistance des déplacements, multi-appartenance sans doublon,
 * sous-tâches, dépendances, CRM, permissions, conflits, récurrence, règles.
 */

const today = () => dayKey(new Date(), APP_TIME_ZONE);

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}

const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });

async function newProject(name = "Lancement", extra: Record<string, unknown> = {}) {
  const id = ok(await createProjectAction({ name, ...extra }));
  const sections = await prisma.projectSection.findMany({ where: { projectId: id }, orderBy: { position: "asc" } });
  return { id, sections };
}

describe("gestion de travail", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("work-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    await signIn(alice);
  });

  describe("projets, sections et vues synchronisées", () => {
    it("crée un projet avec trois sections par défaut et son propriétaire comme membre", async () => {
      const { id, sections } = await newProject();
      expect(sections.map((s) => s.name)).toEqual(["À faire", "En cours", "Terminé"]);
      const members = await prisma.projectMember.findMany({ where: { projectId: id } });
      expect(members).toEqual([expect.objectContaining({ userId: alice.userId, role: "OWNER" })]);
    });

    it("une tâche créée en Liste est la même dans le Tableau (même lot de données)", async () => {
      const { id, sections } = await newProject();
      const task = ok(await createTaskAction({ title: "Rédiger le brief", projectId: id, sectionId: sections[0].id }));
      const bundle = await getProjectBundle(actorOf(alice), id);
      const inBundle = bundle.tasks.find((t) => t.id === task.id)!;
      expect(inBundle.memberships).toEqual([expect.objectContaining({ projectId: id, sectionId: sections[0].id })]);
      // Le Kanban groupe les mêmes `TaskItem` par section : aucune autre source.
      expect(bundle.tasks.filter((t) => t.title === "Rédiger le brief")).toHaveLength(1);
    });

    it("un déplacement (section + ordre) est conservé après rechargement", async () => {
      const { id, sections } = await newProject();
      const a = ok(await createTaskAction({ title: "A", projectId: id, sectionId: sections[1].id }));
      const b = ok(await createTaskAction({ title: "B", projectId: id, sectionId: sections[1].id }));
      const c = ok(await createTaskAction({ title: "C", projectId: id, sectionId: sections[0].id }));
      // C va entre A et B dans « En cours ».
      ok(await moveTaskAction({ taskId: c.id, projectId: id, sectionId: sections[1].id, beforeId: a.id, afterId: b.id }));

      const bundle = await getProjectBundle(actorOf(alice), id);
      const order = bundle.tasks
        .filter((t) => t.memberships[0].sectionId === sections[1].id)
        .sort((x, y) => x.memberships[0].position - y.memberships[0].position)
        .map((t) => t.title);
      expect(order).toEqual(["A", "C", "B"]);
    });

    it("une modification du panneau est visible partout (projet, Mes tâches, recherche)", async () => {
      const { id } = await newProject();
      const task = ok(await createTaskAction({ title: "Préparer la démo", projectId: id }));
      ok(await updateTaskAction(task.id, { priority: "URGENT", assigneeId: alice.userId, dueDate: today() }, { priority: "NORMAL" }));

      const [bundle, mine, found] = await Promise.all([
        getProjectBundle(actorOf(alice), id),
        getMyTasks(actorOf(alice)),
        searchTasks(actorOf(alice), { search: "démo" }),
      ]);
      for (const list of [bundle.tasks, mine, found]) {
        expect(list.find((t) => t.id === task.id)).toMatchObject({ priority: "URGENT", assigneeId: alice.userId, dueDate: today() });
      }
    });

    it("trace l'historique des changements (auteur, champ, ancienne et nouvelle valeur)", async () => {
      const task = ok(await createTaskAction({ title: "Historique" }));
      ok(await updateTaskAction(task.id, { status: "IN_PROGRESS" }));
      const detail = await getTaskDetail(actorOf(alice), task.id);
      expect(detail.activity).toContainEqual(expect.objectContaining({ actorId: alice.userId, field: "Statut", oldValue: "À faire", newValue: "En cours" }));
    });

    it("duplique, archive (lecture seule) puis met un projet à la corbeille en gardant les tâches multi-projets", async () => {
      const p1 = await newProject("P1");
      const p2 = await newProject("P2");
      const shared = ok(await createTaskAction({ title: "Partagée", projectId: p1.id }));
      ok(await addTaskToProjectAction(shared.id, p2.id, null));
      const own = ok(await createTaskAction({ title: "Seulement P1", projectId: p1.id }));

      const copyId = ok(await duplicateProjectAction(p1.id, { includeTasks: true }));
      expect((await getProjectBundle(actorOf(alice), copyId)).tasks.map((t) => t.title).sort()).toEqual(["Partagée", "Seulement P1"]);

      ok(await archiveProjectAction(p1.id, true));
      const refused = await createTaskAction({ title: "Interdit", projectId: p1.id });
      expect(refused.ok).toBe(false);
      ok(await archiveProjectAction(p1.id, false));

      const report = ok(await deleteProjectAction(p1.id));
      expect(report).toEqual({ deletedTasks: 1, keptTasks: 1 });
      // Suppression logique : la tâche exclusive est conservée, à la corbeille avec son projet.
      expect(await prisma.task.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ deletedWithProjectId: p1.id });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: shared.id } })).deletedAt).toBeNull();
    });
  });

  describe("tâches", () => {
    it("une tâche dans plusieurs projets reste unique, avec une section par projet", async () => {
      const p1 = await newProject("P1");
      const p2 = await newProject("P2");
      const task = ok(await createTaskAction({ title: "Multi", projectId: p1.id, sectionId: p1.sections[0].id }));
      ok(await addTaskToProjectAction(task.id, p2.id, p2.sections[2].id));
      ok(await updateTaskAction(task.id, { title: "Multi (renommée)" }));

      expect(await prisma.task.count({ where: { title: { startsWith: "Multi" } } })).toBe(1);
      const [b1, b2] = await Promise.all([getProjectBundle(actorOf(alice), p1.id), getProjectBundle(actorOf(alice), p2.id)]);
      const in1 = b1.tasks.find((t) => t.id === task.id)!;
      const in2 = b2.tasks.find((t) => t.id === task.id)!;
      expect(in1.title).toBe("Multi (renommée)");
      expect(in2.title).toBe("Multi (renommée)");
      expect(in1.memberships.find((m) => m.projectId === p2.id)?.sectionId).toBe(p2.sections[2].id);
      expect(in1.memberships.find((m) => m.projectId === p1.id)?.sectionId).toBe(p1.sections[0].id);
    });

    it("gère les sous-tâches (un seul niveau) avec responsable, statut et échéance propres", async () => {
      const parent = ok(await createTaskAction({ title: "Parent" }));
      const sub = ok(await createTaskAction({ title: "Sous", parentId: parent.id, assigneeId: bob.userId, dueDate: today() }));
      expect(sub).toMatchObject({ parentId: parent.id, assigneeId: bob.userId, dueDate: today() });
      const nested = await createTaskAction({ title: "Trop profond", parentId: sub.id });
      expect(nested).toMatchObject({ ok: false, code: "VALIDATION" });

      ok(await updateTaskAction(sub.id, { status: "DONE" }));
      const detail = await getTaskDetail(actorOf(alice), parent.id);
      expect(detail.task).toMatchObject({ subtaskCount: 1, subtaskDoneCount: 1 });
      expect(detail.subtasks[0].status).toBe("DONE");
    });

    it("dépendances : bloquée par / bloque, cycles refusés", async () => {
      const a = ok(await createTaskAction({ title: "A" }));
      const b = ok(await createTaskAction({ title: "B" }));
      const c = ok(await createTaskAction({ title: "C" }));
      ok(await addDependencyAction(b.id, a.id)); // A bloque B
      ok(await addDependencyAction(c.id, b.id)); // B bloque C

      const blocked = await getTaskDetail(actorOf(alice), b.id);
      expect(blocked.blockedBy.map((t) => t.id)).toEqual([a.id]);
      expect(blocked.blocking.map((t) => t.id)).toEqual([c.id]);
      expect(blocked.task.openBlockerCount).toBe(1);

      expect(await addDependencyAction(a.id, c.id)).toMatchObject({ ok: false, code: "VALIDATION", error: expect.stringMatching(/boucle/) });
      expect(await addDependencyAction(a.id, a.id)).toMatchObject({ ok: false });

      ok(await updateTaskAction(a.id, { status: "DONE" }));
      expect((await getTaskDetail(actorOf(alice), b.id)).task.openBlockerCount).toBe(0);
    });

    it("refuse une date de début postérieure à l'échéance", async () => {
      const result = await createTaskAction({ title: "Dates", startDate: addDaysToKey(today(), 3), dueDate: today() });
      expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    });

    it("signale un conflit au lieu d'écraser silencieusement une modification concurrente", async () => {
      const task = ok(await createTaskAction({ title: "Original" }));
      ok(await updateTaskAction(task.id, { title: "Version de Bob" }));
      // Alice avait encore « Original » sous les yeux.
      const result = await updateTaskAction(task.id, { title: "Version d'Alice" }, { title: "Original" });
      expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
      if (!result.ok) expect(result.current?.title).toBe("Version de Bob");
      // Un autre champ, inchangé entre-temps, passe sans conflit.
      ok(await updateTaskAction(task.id, { priority: "HIGH" }, { priority: "NORMAL" }));
    });

    it("garde statut et date d'achèvement cohérents", async () => {
      const task = ok(await createTaskAction({ title: "Statut" }));
      const done = ok(await updateTaskAction(task.id, { status: "DONE" }));
      expect(done.completedAt).not.toBeNull();
      const reopened = ok(await updateTaskAction(task.id, { status: "WAITING" }));
      expect(reopened.completedAt).toBeNull();
    });

    it("récurrence : une seule occurrence suivante, à la bonne date, même après réouverture", async () => {
      const due = today();
      const task = ok(await createTaskAction({ title: "Hebdo", dueDate: due }));
      ok(await updateTaskAction(task.id, { recurrence: { freq: "WEEKLY", interval: 1 } }));
      ok(await updateTaskAction(task.id, { status: "DONE" }));
      ok(await updateTaskAction(task.id, { status: "TODO" }));
      ok(await updateTaskAction(task.id, { status: "DONE" }));

      const next = await prisma.task.findMany({ where: { recurrenceOriginId: task.id } });
      expect(next).toHaveLength(1);
      expect(dayKey(next[0].dueAt!, APP_TIME_ZONE)).toBe(addDaysToKey(due, 7));
      expect(next[0].status).toBe("TODO");
    });

    it("commentaires : la mention notifie la personne mentionnée", async () => {
      const task = ok(await createTaskAction({ title: "À discuter" }));
      ok(await addCommentAction(task.id, `Peux-tu regarder @[Bob](${bob.userId}) ?`));
      const notifications = await prisma.notification.findMany({ where: { userId: bob.userId } });
      expect(notifications).toContainEqual(expect.objectContaining({ type: "MENTIONED", taskId: task.id }));
    });

    it("l'ancienne action de création alimente le même système (responsable = créateur)", async () => {
      await legacyCreateTask(initialCreateTaskState, formData({ title: "Depuis le cockpit", dueDate: today() }));
      const mine = await getMyTasks(actorOf(alice));
      expect(mine.map((t) => t.title)).toContain("Depuis le cockpit");
    });
  });

  describe("intégration CRM", () => {
    it("une tâche liée à un contact apparaît dans sa fiche et dans celle de son organisation, sans copie", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, { name: "ACME" });
      const contactId = await createContactRecord(alice.workspaceId, { organizationId: orgId });
      const { id } = await newProject();
      const task = ok(await createTaskAction({ title: "Relancer ACME", projectId: id, contactId }));

      const contactWork = await getLinkedWork(actorOf(alice), "contact", contactId);
      const orgWork = await getLinkedWork(actorOf(alice), "organization", orgId);
      expect(contactWork.tasks.map((t) => t.id)).toEqual([task.id]);
      expect(orgWork.tasks.map((t) => t.id)).toEqual([task.id]);
      expect(await prisma.task.count()).toBe(1);
    });

    it("refuse de rattacher une fiche d'un autre espace", async () => {
      const other = await createWorkspaceWithUser("crm-other");
      const foreign = await createContactRecord(other.workspaceId);
      expect(await createTaskAction({ title: "Fuite", contactId: foreign })).toMatchObject({ ok: false });
    });
  });

  describe("permissions et isolation", () => {
    it("un autre espace ne peut ni lire ni modifier", async () => {
      const task = ok(await createTaskAction({ title: "Secret" }));
      const eve = await createWorkspaceWithUser("eve-ws");
      await signIn(eve);
      await expect(getTaskDetail(actorOf(eve), task.id)).rejects.toThrow();
      expect(await updateTaskAction(task.id, { title: "Piraté" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await searchTasks(actorOf(eve), { search: "Secret" })).toEqual([]);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe("Secret");
    });

    it("un projet privé est invisible pour un non-membre du même espace", async () => {
      const { id } = await newProject("Privé", { visibility: "PRIVATE" });
      const task = ok(await createTaskAction({ title: "Confidentiel", projectId: id }));
      await signIn(bob);
      await expect(getProjectBundle(actorOf(bob), id)).rejects.toThrow();
      await expect(getTaskDetail(actorOf(bob), task.id)).rejects.toThrow();
      expect(await searchTasks(actorOf(bob), { search: "Confidentiel" })).toEqual([]);
      expect(await updateTaskAction(task.id, { title: "x" })).toMatchObject({ ok: false });
      expect(await addCommentAction(task.id, "coucou")).toMatchObject({ ok: false });
    });

    it("un commentateur lit et commente mais ne modifie pas", async () => {
      const { id } = await newProject("Revue", { visibility: "PRIVATE" });
      const task = ok(await createTaskAction({ title: "À relire", projectId: id }));
      ok(await setProjectMemberAction(id, bob.userId, "COMMENTER"));
      await signIn(bob);
      expect((await getTaskDetail(actorOf(bob), task.id)).task.canEdit).toBe(false);
      ok(await addCommentAction(task.id, "Vu."));
      expect(await updateTaskAction(task.id, { title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await createSectionAction(id, "Nouvelle")).toMatchObject({ ok: false });
    });

    it("pièces jointes : type vérifié, accès réservé aux lecteurs de la tâche", async () => {
      const task = ok(await createTaskAction({ title: "Avec fichier" }));
      const upload = (bytes: Uint8Array, name: string, origin = "http://localhost") => {
        const body = new FormData();
        body.append("file", new File([bytes as BlobPart], name));
        return attachmentPost(new Request(`http://localhost/api/tasks/items/${task.id}/attachments`, { method: "POST", body, headers: { origin, host: "localhost" } }), { params: Promise.resolve({ id: task.id }) });
      };
      expect((await upload(new TextEncoder().encode("bonjour"), "note.txt", "http://evil.example")).status).toBe(403);
      expect((await upload(new TextEncoder().encode("MZ binaire"), "faux.pdf")).status).toBe(400);
      const created = await upload(new TextEncoder().encode("bonjour"), "note.txt");
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      const read = await attachmentGet(new Request(`http://localhost/api/tasks/attachments/${id}`), { params: Promise.resolve({ id }) });
      expect(read.status).toBe(200);
      expect(read.headers.get("x-content-type-options")).toBe("nosniff");

      const eve = await createWorkspaceWithUser("eve-files");
      await signIn(eve);
      const denied = await attachmentGet(new Request(`http://localhost/api/tasks/attachments/${id}`), { params: Promise.resolve({ id }) });
      expect(denied.status).toBe(404);
    });
  });

  describe("automatisations", () => {
    it("tâche passée en urgente → le responsable est notifié, exécution tracée", async () => {
      const { id } = await newProject();
      const ruleId = ok(await saveRuleAction(null, id, { name: "Urgent", trigger: "PRIORITY_CHANGED", triggerConfig: { priority: "URGENT" }, conditions: [], actions: [{ kind: "notify", target: "assignee" }], isEnabled: true }));
      const task = ok(await createTaskAction({ title: "Incident", projectId: id, assigneeId: bob.userId }));
      ok(await updateTaskAction(task.id, { priority: "URGENT" }));

      expect(await prisma.notification.count({ where: { userId: bob.userId, type: "AUTOMATION", taskId: task.id } })).toBe(1);
      expect(await prisma.automationRun.findMany({ where: { ruleId } })).toEqual([expect.objectContaining({ status: "SUCCESS", taskId: task.id })]);
    });

    it("tâche terminée → déplacée dans une section ; historique attribué à la règle", async () => {
      const { id, sections } = await newProject();
      const ruleId = ok(await saveRuleAction(null, id, { name: "Ranger", trigger: "TASK_COMPLETED", triggerConfig: {}, conditions: [], actions: [{ kind: "move_to_section", sectionId: sections[2].id }], isEnabled: true }));
      const task = ok(await createTaskAction({ title: "Finie", projectId: id, sectionId: sections[0].id }));
      ok(await updateTaskAction(task.id, { status: "DONE" }));
      const membership = await prisma.taskProject.findFirstOrThrow({ where: { taskId: task.id } });
      expect(membership.sectionId).toBe(sections[2].id);
      expect(await prisma.taskActivity.count({ where: { taskId: task.id, automationRuleId: ruleId } })).toBeGreaterThan(0);
    });

    it("toutes les sous-tâches terminées → suggestion de terminer la parente", async () => {
      const { id } = await newProject();
      ok(await saveRuleAction(null, id, { name: "Suggestion", trigger: "SUBTASKS_COMPLETED", triggerConfig: {}, conditions: [], actions: [{ kind: "suggest_complete_parent" }], isEnabled: true }));
      const parent = ok(await createTaskAction({ title: "Parente", projectId: id, assigneeId: bob.userId }));
      const s1 = ok(await createTaskAction({ title: "s1", parentId: parent.id }));
      const s2 = ok(await createTaskAction({ title: "s2", parentId: parent.id }));
      ok(await updateTaskAction(s1.id, { status: "DONE" }));
      expect(await prisma.notification.count({ where: { userId: bob.userId, actionKind: "COMPLETE_TASK" } })).toBe(0);
      ok(await updateTaskAction(s2.id, { status: "DONE" }));
      expect(await prisma.notification.count({ where: { userId: bob.userId, actionKind: "COMPLETE_TASK", taskId: parent.id } })).toBe(1);
    });

    it("deux règles qui se renvoient la balle ne bouclent pas", async () => {
      const { id } = await newProject();
      ok(await saveRuleAction(null, id, { name: "Ping", trigger: "STATUS_CHANGED", triggerConfig: { status: "IN_PROGRESS" }, conditions: [], actions: [{ kind: "set_status", status: "WAITING" }], isEnabled: true }));
      ok(await saveRuleAction(null, id, { name: "Pong", trigger: "STATUS_CHANGED", triggerConfig: { status: "WAITING" }, conditions: [], actions: [{ kind: "set_status", status: "IN_PROGRESS" }], isEnabled: true }));
      const task = ok(await createTaskAction({ title: "Balle", projectId: id }));
      ok(await updateTaskAction(task.id, { status: "IN_PROGRESS" }));
      const runs = await prisma.automationRun.count();
      expect(runs).toBeLessThanOrEqual(6);
      expect(await prisma.automationRun.count({ where: { status: "SKIPPED" } })).toBeGreaterThan(0);
    });

    it("rappel d'échéance : jamais envoyé deux fois", async () => {
      const { id } = await newProject();
      ok(await saveRuleAction(null, id, { name: "Rappel", trigger: "DUE_DATE_APPROACHING", triggerConfig: { days: 2 }, conditions: [], actions: [{ kind: "create_reminder" }], isEnabled: true }));
      ok(await createTaskAction({ title: "Bientôt", projectId: id, assigneeId: bob.userId, dueDate: addDaysToKey(today(), 1) }));
      await runTaskReminders();
      await runTaskReminders();
      // Un rappel intégré (veille) + un rappel de la règle, chacun une seule fois.
      expect(await prisma.notification.count({ where: { userId: bob.userId, type: "DUE_SOON" } })).toBe(2);
    });
  });

  describe("import / export CSV", () => {
    it("importe des lignes (sections, tags, responsables) et les réexporte", async () => {
      const { id } = await newProject();
      const csv = `Nom;Responsable;Échéance;Priorité;Section;Tags\nTâche importée;${bob.email};31/12/2026;Haute;Nouvelle colonne;client, urgent\n;;;;;\n`;
      const report = ok(await importCsvAction(id, csv));
      expect(report.created).toBe(1);
      const task = await prisma.task.findFirstOrThrow({ where: { title: "Tâche importée" }, include: { tags: true, projects: { include: { section: true } } } });
      expect(task).toMatchObject({ assigneeId: bob.userId, priority: "HIGH" });
      expect(task.tags).toHaveLength(2);
      expect(task.projects[0].section?.name).toBe("Nouvelle colonne");

      const response = await exportGet(new Request(`http://localhost/api/tasks/export?projectId=${id}`));
      const text = await response.text();
      expect(text).toContain("Tâche importée");
      expect(text).toContain("31/12/2026");
    });

    it("neutralise les formules à l'export", async () => {
      const { id } = await newProject();
      ok(await createTaskAction({ title: "=HYPERLINK(\"x\")", projectId: id }));
      const text = await (await exportGet(new Request(`http://localhost/api/tasks/export?projectId=${id}`))).text();
      expect(text).toContain("'=HYPERLINK");
    });
  });

  it("tags : un tag d'un autre espace est refusé", async () => {
    const task = ok(await createTaskAction({ title: "Tags" }));
    const tag = ok(await createTagAction({ name: "client" }));
    ok(await setTaskTagsAction(task.id, [tag.id]));
    const other = await createWorkspaceWithUser("tags-other");
    await signIn(other);
    const foreign = ok(await createTagAction({ name: "étranger" }));
    await signIn(alice);
    expect(await setTaskTagsAction(task.id, [foreign.id])).toMatchObject({ ok: false });
  });
});

export type { TaskItem };

describe("cockpit et visibilité", () => {
  it("le cockpit exclut côté serveur les tâches non autorisées ; « Mes tâches » restreint au responsable", async () => {
    await resetDatabase();
    const alice = await createWorkspaceWithUser("cockpit-ws");
    const bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    await signIn(alice);
    const privateId = ok(await createProjectAction({ name: "Privé", visibility: "PRIVATE" }));
    ok(await createTaskAction({ title: "Privée d'Alice", projectId: privateId, assigneeId: null, dueDate: today() }));
    ok(await createTaskAction({ title: "Pour Bob", assigneeId: bob.userId, dueDate: today() }));
    ok(await createTaskAction({ title: "Pour moi", dueDate: today() }));
    const { getActionableTasks } = await import("@/lib/tasks/queries");
    const { endOfDay } = await import("@/lib/date");

    const end = endOfDay(today(), APP_TIME_ZONE);

    await signIn(bob);
    // Défaut historique : toutes les tâches accessibles, collègues compris —
    // jamais celle du projet privé dont Bob n'est pas membre.
    const bobAll = await getActionableTasks(end);
    expect(bobAll.map((t) => t.title).sort()).toEqual(["Pour Bob", "Pour moi"]);
    expect(bobAll.find((t) => t.title === "Pour moi")).toMatchObject({ assigneeName: expect.any(String), assignedToMe: false });
    expect((await getActionableTasks(end, "mine")).map((t) => t.title)).toEqual(["Pour Bob"]);

    await signIn(alice);
    // Membre du projet privé : sa tâche y figure ; celle de Bob aussi (tâche libre).
    expect((await getActionableTasks(end)).map((t) => t.title).sort()).toEqual(["Pour Bob", "Pour moi", "Privée d'Alice"]);
    expect((await getActionableTasks(end, "mine")).map((t) => t.title)).toEqual(["Pour moi"]);
  });
});
