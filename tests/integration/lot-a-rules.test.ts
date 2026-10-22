import { beforeEach, describe, expect, it } from "vitest";

import { createOpportunity } from "@/app/(app)/commerce/actions";
import { createFollowUp } from "@/app/(app)/follow-ups/actions";
import { createPrivacyRequest } from "@/app/(app)/rgpd/actions";
import { createTask } from "@/app/(app)/tasks/actions";
import {
  createProjectAction,
  createTagAction,
  createTaskAction,
  deleteTagAction,
  duplicateProjectAction,
  saveFormAction,
  saveRuleAction,
  setFollowerAction,
  setProjectMemberAction,
  submitFormAction,
  updateProjectAction,
  updateTagAction,
} from "@/app/(app)/tasks/work-actions";
import { initialCreateOpportunityState } from "@/lib/commerce/create-state";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { prisma } from "@/lib/prisma";
import { initialCreateTaskState } from "@/lib/tasks/create-state";
import type { ActionResult } from "@/lib/tasks/types";
import { getProjectBundle, getTaskDetail, getWorkContext } from "@/lib/tasks/work-queries";

import {
  addUserToWorkspace,
  createContactRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  shareDirectory,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Lot A — règles unitaires des décisions figées (a, f, g), liaisons CRM,
 * formulaires, automatisations, et membres de projet existants.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const readable = (u: TestUser, id: string) => getTaskDetail(actorOf(u), id).then(() => true, () => false);

describe("lot A — règles", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("lot-a-rules");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    await shareDirectory(alice, bob, carol);
    await signIn(alice);
  });

  it("(a) une étiquette se lit par tout l'espace mais ne se modifie que par sa créatrice", async () => {
    const tag = ok(await createTagAction({ name: "client-clé" }));
    await signIn(bob);
    expect((await getWorkContext(actorOf(bob))).tags.map((t) => t.id)).toContain(tag.id);
    expect(await updateTagAction(tag.id, { name: "renommée" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteTagAction(tag.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await prisma.tag.findUniqueOrThrow({ where: { id: tag.id } })).toMatchObject({ name: "client-clé", createdById: alice.userId });
    // Le même nom renvoie l'étiquette existante (unicité par espace), sans la lui donner.
    expect(ok(await createTagAction({ name: "client-clé" })).id).toBe(tag.id);
    await signIn(alice);
    ok(await updateTagAction(tag.id, { name: "renommée" }));
    ok(await deleteTagAction(tag.id));
  });

  it("(f) positionner « tout l'espace » est refusé côté serveur, et la valeur par défaut est privée", async () => {
    expect(await createProjectAction({ name: "Ouvert", visibility: "WORKSPACE" })).toMatchObject({ ok: false, code: "VALIDATION" });
    const id = ok(await createProjectAction({ name: "Normal" }));
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).visibility).toBe("PRIVATE");
    expect(await updateProjectAction(id, { visibility: "WORKSPACE" })).toMatchObject({ ok: false, code: "VALIDATION" });
    // Une copie ne ressuscite pas la valeur héritée.
    await prisma.project.update({ where: { id }, data: { visibility: "WORKSPACE" } });
    const copy = ok(await duplicateProjectAction(id, { name: "Copie" }));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: copy } })).visibility).toBe("PRIVATE");
    // Défaut de la base (migration 2).
    const raw = await prisma.project.create({ data: { workspaceId: alice.workspaceId, name: "Brut", ownerId: alice.userId } });
    expect(raw.visibility).toBe("PRIVATE");
    // Une ligne héritée encore WORKSPACE n'ouvre rien à un non-membre.
    expect((await getWorkContext(actorOf(bob))).projects.map((p) => p.id)).not.toContain(id);
  });

  it("(g) un simple abonné ne lit plus la tâche ; collaborateur, responsable et créateur, oui", async () => {
    const task = ok(await createTaskAction({ title: "Libre d'Alice" }));
    ok(await setFollowerAction(task.id, bob.userId, "FOLLOWER"));
    expect(await readable(bob, task.id)).toBe(false);
    ok(await setFollowerAction(task.id, bob.userId, "COLLABORATOR"));
    expect(await readable(bob, task.id)).toBe(true);
    const assigned = ok(await createTaskAction({ title: "Pour Carol", assigneeId: carol.userId }));
    expect(await readable(carol, assigned.id)).toBe(true);
    expect(await readable(alice, assigned.id)).toBe(true);
    // Sous-tâche : seulement par sa racine, même pour sa propre responsable.
    const sub = ok(await createTaskAction({ title: "Sous-tâche", parentId: task.id, assigneeId: carol.userId }));
    expect(await readable(carol, sub.id)).toBe(false);
    expect(await readable(bob, sub.id)).toBe(true);
  });

  it("une liaison à la fiche CRM d'autrui est refusée, partout", async () => {
    const org = await createOrganizationRecord(alice.workspaceId, { name: "Org d'Alice" });
    const contact = await createContactRecord(alice.workspaceId, { organizationId: org });
    await signIn(bob);
    expect(await createTaskAction({ title: "x", contactId: contact })).toMatchObject({ ok: false, error: "Contact introuvable." });
    expect(await createTaskAction({ title: "x", organizationId: org })).toMatchObject({ ok: false, error: "Organisation introuvable." });
    expect(await createProjectAction({ name: "x", contactId: contact })).toMatchObject({ ok: false, error: "Contact introuvable." });
    expect(await createTask(initialCreateTaskState, formData({ title: "x", contactId: contact }))).toMatchObject({ status: "error" });
    expect(await createFollowUp(initialCreateState, formData({ title: "x", dueDate: "2026-12-01", ballOwner: "THEM", contactId: contact }))).toMatchObject({ status: "error" });
    expect(await createOpportunity(initialCreateOpportunityState, formData({ name: "x", organizationId: org, status: "A_QUALIFIER" }))).toMatchObject({ status: "error" });
    await expect(
      createPrivacyRequest(formData({ contactId: contact, requesterName: "x", requesterEmail: "", requestType: "ACCESS", status: "RECEIVED", receivedAt: "2026-10-01", dueAt: "2026-11-01", owner: "", notes: "" })),
    ).rejects.toThrow("Contact introuvable.");
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.project.count({ where: { name: "x" } })).toBe(0);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.opportunity.count()).toBe(0);
    expect(await prisma.privacyRequest.count()).toBe(0);
  });

  it("envoyer un formulaire exige l'Édition sur le projet", async () => {
    const project = ok(await createProjectAction({ name: "Demandes" }));
    const form = ok(await saveFormAction(null, project, { name: "Demande", fields: {} }));
    ok(await setProjectMemberAction(project, carol.userId, "COMMENTER"));
    ok(await setProjectMemberAction(project, bob.userId, "EDITOR"));

    await signIn(carol); // commentatrice : lit le projet, ne peut pas y créer
    expect(await submitFormAction(form, { title: "Par Carol" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await signIn(bob); // éditeur
    ok(await submitFormAction(form, { title: "Par Bob" }));
    const outsider = await addUserToWorkspace(alice.workspaceId, "Hors");
    await signIn(outsider); // non membre : le formulaire n'existe pas pour lui
    expect(await submitFormAction(form, { title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await prisma.task.findMany({ select: { title: true } })).map((t) => t.title)).toEqual(["Par Bob"]);
  });

  it("une automatisation ne touche jamais les données d'un tiers, ni un projet où son auteur n'a pas l'Édition", async () => {
    await signIn(bob);
    ok(await saveRuleAction(null, null, { name: "Tout en haut", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "URGENT" }], isEnabled: true }));
    const readOnly = await (async () => {
      await signIn(alice);
      const id = ok(await createProjectAction({ name: "Lecture" }));
      ok(await setProjectMemberAction(id, bob.userId, "COMMENTER"));
      return id;
    })();
    const editable = ok(await createProjectAction({ name: "Édition" }));
    ok(await setProjectMemberAction(editable, bob.userId, "EDITOR"));

    // Tâche libre d'Alice : la règle de Bob n'agit pas sur une tâche libre qui n'est pas la sienne…
    const free = ok(await createTaskAction({ title: "Libre d'Alice" }));
    // … ni dans un projet où il n'est que commentateur, même responsable.
    const inReadOnly = ok(await createTaskAction({ title: "Lecture", projectId: readOnly, assigneeId: bob.userId }));
    const inEditable = ok(await createTaskAction({ title: "Édition", projectId: editable }));

    const priority = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).priority;
    expect(await priority(free.id)).toBe("NORMAL");
    expect(await priority(inReadOnly.id)).toBe("NORMAL");
    expect(await priority(inEditable.id)).toBe("URGENT");

    // Ses propres données : la règle s'applique.
    await signIn(bob);
    expect(await priority(ok(await createTaskAction({ title: "Libre de Bob" })).id)).toBe("URGENT");
  });

  it("les membres d'un projet hérité « espace » gardent exactement leur accès quand il devient privé", async () => {
    const project = ok(await createProjectAction({ name: "Hérité" }));
    const task = ok(await createTaskAction({ title: "Dedans", projectId: project }));
    ok(await setProjectMemberAction(project, bob.userId, "EDITOR"));
    ok(await setProjectMemberAction(project, carol.userId, "COMMENTER"));
    await prisma.project.update({ where: { id: project }, data: { visibility: "WORKSPACE" } });

    const rights = async () => ({
      bob: (await getProjectBundle(actorOf(bob), project)).project,
      carol: (await getProjectBundle(actorOf(carol), project)).project,
      bobTask: (await getTaskDetail(actorOf(bob), task.id)).task,
      carolTask: (await getTaskDetail(actorOf(carol), task.id)).task,
    });
    const pick = (r: Awaited<ReturnType<typeof rights>>) => ({
      bob: { canEdit: r.bob.canEdit, canManage: r.bob.canManage },
      carol: { canEdit: r.carol.canEdit, canManage: r.carol.canManage },
      bobTask: { canEdit: r.bobTask.canEdit, canManage: r.bobTask.canManage },
      carolTask: { canEdit: r.carolTask.canEdit, canManage: r.carolTask.canManage },
    });
    const before = pick(await rights());
    // Ce que fait le backfill (étape 2).
    await prisma.project.update({ where: { id: project }, data: { visibility: "PRIVATE" } });
    expect(pick(await rights())).toEqual(before);
    expect(before).toEqual({
      bob: { canEdit: true, canManage: false },
      carol: { canEdit: false, canManage: false },
      bobTask: { canEdit: true, canManage: true },
      carolTask: { canEdit: false, canManage: false },
    });
  });
});
