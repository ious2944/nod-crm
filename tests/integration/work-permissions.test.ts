import { beforeEach, describe, expect, it } from "vitest";

import {
  addCommentAction,
  addTaskToProjectAction,
  createProjectAction,
  createTaskAction,
  deleteTaskAction,
  duplicateTaskAction,
  moveTaskAction,
  saveCustomFieldAction,
  setCustomFieldValueAction,
  setFollowerAction,
  setProjectMemberAction,
  setTaskParentAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { GET as attachmentGet } from "@/app/api/tasks/attachments/[id]/route";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { GET as exportGet } from "@/app/api/tasks/export/route";
import { GET as searchGet } from "@/app/api/tasks/search/route";
import { prisma } from "@/lib/prisma";
import { listTrash } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";
import {
  getLinkedWork,
  getProjectBundle,
  getTaskDetail,
  getWorkContext,
  listNotifications,
  searchTasks,
} from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createContactRecord, createWorkspaceWithUser, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Politique d'accès appliquée, rôle par rôle (voir `docs/tasks.md`) :
 *
 * - Alice : propriétaire des projets privés P et Q ;
 * - Bob : responsable d'une tâche de P, **non membre** ;
 * - Carol : **commentatrice** de P ;
 * - Dan : **éditeur** de P seulement — une tâche est dans P et Q ;
 * - Eve : membre de l'espace **sans aucun accès** aux projets.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });

describe("permissions par rôle et tâches privées", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser, dan: TestUser, eve: TestUser;
  let P: string, Q: string, pSections: string[];
  let assigned: string, other: string, sub: string, shared: string, contactId: string;
  let pField: string, qField: string, attachmentOnAssigned: string, attachmentOnOther: string;

  const upload = async (taskId: string, name: string) => {
    const body = new FormData();
    body.append("file", new File([new TextEncoder().encode("contenu")], name));
    const response = await attachmentPost(
      new Request(`http://localhost/api/tasks/items/${taskId}/attachments`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const readFile = (id: string) => attachmentGet(new Request(`http://localhost/api/tasks/attachments/${id}`), { params: Promise.resolve({ id }) });
  const exportCsv = async (query: string) => {
    const response = await exportGet(new Request(`http://localhost/api/tasks/export?${query}`));
    return { status: response.status, text: await response.text() };
  };

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("perm-ws");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    dan = await addUserToWorkspace(alice.workspaceId, "Dan");
    eve = await addUserToWorkspace(alice.workspaceId, "Eve");
    await signIn(alice);

    P = ok(await createProjectAction({ name: "Projet Privé P", visibility: "PRIVATE" }));
    Q = ok(await createProjectAction({ name: "Projet Secret Q", visibility: "PRIVATE" }));
    pSections = (await prisma.projectSection.findMany({ where: { projectId: P }, orderBy: { position: "asc" } })).map((s) => s.id);
    ok(await setProjectMemberAction(P, carol.userId, "COMMENTER"));
    ok(await setProjectMemberAction(P, dan.userId, "EDITOR"));
    contactId = await createContactRecord(alice.workspaceId, { firstName: "Camille", lastName: "Client" });

    assigned = ok(await createTaskAction({ title: "Tâche de Bob", projectId: P, sectionId: pSections[0], assigneeId: bob.userId, contactId, description: "Détails confidentiels du lancement" })).id;
    other = ok(await createTaskAction({ title: "Autre tâche de P", projectId: P, contactId, description: "Budget interne" })).id;
    sub = ok(await createTaskAction({ title: "Sous-tâche", parentId: assigned })).id;
    shared = ok(await createTaskAction({ title: "Tâche partagée P+Q", projectId: P })).id;
    ok(await addTaskToProjectAction(shared, Q, null));

    pField = ok(await saveCustomFieldAction(null, { name: "Budget P", type: "TEXT" }, P));
    qField = ok(await saveCustomFieldAction(null, { name: "Code Q", type: "TEXT" }, Q));
    ok(await setCustomFieldValueAction(assigned, pField, "12 k€"));
    ok(await setCustomFieldValueAction(shared, pField, "P-val"));
    ok(await setCustomFieldValueAction(shared, qField, "Q-secret"));
    // Changement de section : ligne d'historique liée à P.
    ok(await moveTaskAction({ taskId: assigned, projectId: P, sectionId: pSections[1] }));
    attachmentOnAssigned = await upload(assigned, "brief.txt");
    attachmentOnOther = await upload(other, "budget.txt");
  });

  describe("responsable non membre (Bob)", () => {
    beforeEach(async () => signIn(bob));

    it("voit sa tâche et ses éléments propres, sans rien du projet", async () => {
      const detail = await getTaskDetail(actorOf(bob), assigned);
      expect(detail.task.title).toBe("Tâche de Bob");
      expect(detail.description).toContain("confidentiels");
      expect(detail.task.memberships).toEqual([]); // le projet n'est pas divulgué
      expect(detail.projects).toEqual([]);
      expect(detail.subtasks.map((s) => s.id)).toEqual([sub]); // sous-tâche : élément propre
      expect(detail.attachments.map((a) => a.fileName)).toEqual(["brief.txt"]);
      expect((await readFile(attachmentOnAssigned)).status).toBe(200);
      // Champ propre à P : valeur masquée, définition absente du contexte.
      expect(detail.task.custom[pField]).toBeUndefined();
      expect((await getWorkContext(actorOf(bob))).fields.map((f) => f.id)).not.toContain(pField);
      // Historique : la ligne « Section » de P (nom de section) est masquée.
      expect(detail.activity.some((a) => a.kind === "moved")).toBe(false);
      expect(detail.activity.some((a) => a.kind === "created")).toBe(true);
      ok(await addCommentAction(assigned, "Bien reçu."));
    });

    it("ne voit ni les autres tâches du projet, ni le projet, ni ses fichiers", async () => {
      await expect(getProjectBundle(actorOf(bob), P)).rejects.toThrow();
      await expect(getTaskDetail(actorOf(bob), other)).rejects.toThrow();
      expect((await readFile(attachmentOnOther)).status).toBe(404);
      const found = await searchTasks(actorOf(bob), { search: "tâche", completion: "all" });
      expect(found.map((t) => t.id).sort()).toEqual([assigned, sub].sort());
      // Description complète, mais seulement des tâches visibles.
      expect((await searchTasks(actorOf(bob), { search: "Budget interne", completion: "all" }))).toEqual([]);
      // Filtrer par un projet illisible ne révèle rien, même la tâche visible.
      expect(await searchTasks(actorOf(bob), { projectIds: [P], completion: "all" })).toEqual([]);
      const ids = await searchGet(new Request(`http://localhost/api/tasks/search?idsOnly=1&filters=${encodeURIComponent(JSON.stringify({ projectIds: [P], completion: "all" }))}`));
      expect(await ids.json()).toEqual({ ids: [] });
    });

    it("la fiche CRM liée ne montre que la tâche autorisée", async () => {
      const linked = await getLinkedWork(actorOf(bob), "contact", contactId);
      expect(linked.tasks.map((t) => t.id)).toEqual([assigned]);
      expect(linked.projects).toEqual([]);
    });

    it("peut modifier sa tâche, mais ni la réaffecter, ni la partager, ni la sortir du projet", async () => {
      ok(await updateTaskAction(assigned, { status: "IN_PROGRESS" }));
      const detail = await getTaskDetail(actorOf(bob), assigned);
      expect(detail.task).toMatchObject({ canEdit: true, canManage: false });
      expect(await updateTaskAction(assigned, { assigneeId: eve.userId })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await setFollowerAction(assigned, eve.userId, "FOLLOWER")).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await setFollowerAction(assigned, bob.userId, "COLLABORATOR")).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await deleteTaskAction(assigned)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await duplicateTaskAction(assigned)).toMatchObject({ ok: false });
      const free = ok(await createTaskAction({ title: "Libre de Bob" }));
      expect(await setTaskParentAction(free.id, assigned)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await setCustomFieldValueAction(assigned, pField, "piraté")).toMatchObject({ ok: false });
      expect((await prisma.taskCustomFieldValue.findUniqueOrThrow({ where: { taskId_fieldId: { taskId: assigned, fieldId: pField } } })).textValue).toBe("12 k€");
      // Ajouter la tâche à un projet ouvert l'exposerait à tout l'espace.
      await signIn(alice);
      const open = ok(await createProjectAction({ name: "Ouvert" }));
      await signIn(bob);
      expect(await addTaskToProjectAction(assigned, open, null)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    });

    it("une mention ne donne aucun accès à la personne mentionnée", async () => {
      ok(await addCommentAction(assigned, `Voir avec @[Eve](${eve.userId})`));
      expect(await prisma.taskFollower.findFirst({ where: { taskId: assigned, userId: eve.userId } })).toBeNull();
      expect(await prisma.notification.count({ where: { userId: eve.userId } })).toBe(0);
      await expect(getTaskDetail(actorOf(eve), assigned)).rejects.toThrow();
    });

    it("notifications et export suivent l'accès", async () => {
      expect((await listNotifications(actorOf(bob))).some((n) => n.taskId === assigned)).toBe(true);
      const csv = await exportCsv(`filters=${encodeURIComponent(JSON.stringify({ completion: "all" }))}`);
      expect(csv.text).toContain("Tâche de Bob");
      expect(csv.text).not.toContain("Autre tâche de P");
      expect(csv.text).not.toContain("Projet Privé P");
      expect((await exportCsv(`projectId=${P}`)).status).toBe(404);

      // La tâche part à la corbeille : la notification disparaît de sa boîte.
      await signIn(alice);
      ok(await deleteTaskAction(assigned));
      await signIn(bob);
      expect((await listNotifications(actorOf(bob))).some((n) => n.taskId === assigned)).toBe(false);
      await expect(getTaskDetail(actorOf(bob), assigned)).rejects.toThrow();
      expect(await listTrash(actorOf(bob))).toEqual([]);
    });
  });

  describe("commentatrice (Carol)", () => {
    beforeEach(async () => signIn(carol));

    it("lit tout le projet et commente, sans rien modifier ni supprimer", async () => {
      const bundle = await getProjectBundle(actorOf(carol), P);
      expect(bundle.tasks.map((t) => t.id)).toEqual(expect.arrayContaining([assigned, other, sub, shared]));
      const detail = await getTaskDetail(actorOf(carol), other);
      expect(detail.task).toMatchObject({ canEdit: false, canManage: false });
      ok(await addCommentAction(other, "Une remarque."));
      expect(await updateTaskAction(other, { title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await deleteTaskAction(other)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await setCustomFieldValueAction(other, pField, "x")).toMatchObject({ ok: false });
      expect((await readFile(attachmentOnOther)).status).toBe(200);
      // L'historique de P lui est visible.
      expect((await getTaskDetail(actorOf(carol), assigned)).activity.some((a) => a.kind === "moved")).toBe(true);
    });
  });

  describe("membre d'un seul des projets d'une tâche (Dan)", () => {
    beforeEach(async () => signIn(dan));

    it("ne voit rien du projet inaccessible", async () => {
      const detail = await getTaskDetail(actorOf(dan), shared);
      expect(detail.task.memberships.map((m) => m.projectId)).toEqual([P]);
      expect(detail.projects.map((p) => p.id)).toEqual([P]);
      expect(detail.task.custom[pField]).toBe("P-val");
      expect(detail.task.custom[qField]).toBeUndefined();
      expect(detail.activity.some((a) => a.kind === "project_added")).toBe(false); // « ajoutée à Q »
      expect(JSON.stringify(detail)).not.toContain("Projet Secret Q");
      expect(JSON.stringify(detail)).not.toContain("Q-secret");
      expect(await searchTasks(actorOf(dan), { projectIds: [Q], completion: "all" })).toEqual([]);
      expect(await setCustomFieldValueAction(shared, qField, "x")).toMatchObject({ ok: false });
      const csv = await exportCsv(`filters=${encodeURIComponent(JSON.stringify({ completion: "all" }))}`);
      expect(csv.text).not.toContain("Q-secret");
      // Éditeur de P : il gère la tâche (y compris la corbeille).
      expect(detail.task.canManage).toBe(true);
    });
  });

  describe("membre sans accès (Eve)", () => {
    beforeEach(async () => signIn(eve));

    it("n'obtient rien, par aucune voie", async () => {
      for (const id of [assigned, other, sub, shared]) await expect(getTaskDetail(actorOf(eve), id)).rejects.toThrow();
      expect(await searchTasks(actorOf(eve), { completion: "all" })).toEqual([]);
      expect((await getLinkedWork(actorOf(eve), "contact", contactId)).tasks).toEqual([]);
      expect((await readFile(attachmentOnAssigned)).status).toBe(404);
      expect(await listNotifications(actorOf(eve))).toEqual([]);
      expect(await addCommentAction(other, "?")).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await updateTaskAction(sub, { title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      const csv = await exportCsv(`filters=${encodeURIComponent(JSON.stringify({ completion: "all" }))}`);
      expect(csv.text.trim().split("\n")).toHaveLength(1); // en-tête seul
      expect((await getWorkContext(actorOf(eve))).fields).toEqual([]);
    });
  });
});
