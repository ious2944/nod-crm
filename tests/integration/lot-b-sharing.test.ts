import { beforeAll, describe, expect, it } from "vitest";

import { updateTask } from "@/app/(app)/tasks/actions";
import * as work from "@/app/(app)/tasks/work-actions";
import { prisma } from "@/lib/prisma";
import { getActionableTasks, getTaskList, getTasksForKpi } from "@/lib/tasks/queries";
import { ASSIGNEE_NOT_MEMBER, LOCKED_CRM_LINK } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";
import { getProjectBundle, getProjectDetail, getTaskDetail } from "@/lib/tasks/work-queries";

import {
  addUserToWorkspace,
  createContactRecord,
  createFollowUpRecord,
  createOpportunityRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Lot B — partage de projet et masquages (docs/permissions-v1.md §10).
 *
 * Alice est la propriétaire ; son projet P est lié à ses fiches CRM et
 * partagé avec Bob (Édition), Gina (Gestion, rôle OWNER de membre) et Carol
 * (Lecture). Dan est dans l'annuaire d'Alice (projet R) sans être membre de P.
 * Paula est un compte « partenaire » tout juste créé, hors de tout annuaire.
 * Les tests de masquage en lecture sont dans `lot-a-attack.test.ts`.
 */

const C_NAME = "LOTBCONTACT";
const O_NAME = "LOTBORG";
const OPP_NAME = "LOTBOPP";
const FU_NAME = "LOTBFOLLOWUP";

function ok<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`refusé: ${r.error}`);
  return r.data;
}
function refused<T>(r: ActionResult<T>): { error: string; code?: string } {
  if (r.ok) throw new Error("accepté alors qu'un refus était attendu");
  return r;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });

let alice: TestUser;
let bob: TestUser; // Édition sur P
let gina: TestUser; // Gestion sur P (membre OWNER)
let carol: TestUser; // Lecture sur P
let dan: TestUser; // membre de R seulement
let paula: TestUser; // partenaire, aucun partage au départ
let other: TestUser; // autre espace

const id: Record<string, string> = {};

async function crmLinks() {
  const [task, project] = await Promise.all([
    prisma.task.findUniqueOrThrow({ where: { id: id.taskP }, select: { contactId: true, organizationId: true, opportunityId: true, followUpId: true } }),
    prisma.project.findUniqueOrThrow({ where: { id: id.P }, select: { contactId: true, organizationId: true, opportunityId: true } }),
  ]);
  return { task, project };
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createWorkspaceWithUser("lot-b-ws");
  bob = await addUserToWorkspace(alice.workspaceId, "Bob");
  gina = await addUserToWorkspace(alice.workspaceId, "Gina");
  carol = await addUserToWorkspace(alice.workspaceId, "Carol");
  dan = await addUserToWorkspace(alice.workspaceId, "Dan");
  paula = await addUserToWorkspace(alice.workspaceId, "Paula");
  other = await createWorkspaceWithUser("lot-b-other");

  await signIn(alice);
  id.org = await createOrganizationRecord(alice.workspaceId, { name: O_NAME });
  id.contact = await createContactRecord(alice.workspaceId, { firstName: "Camille", lastName: C_NAME, organizationId: id.org });
  id.opp = await createOpportunityRecord(alice.workspaceId, id.org, { name: OPP_NAME, contactId: id.contact });
  id.followUp = await createFollowUpRecord(alice.workspaceId, FU_NAME);

  id.P = ok(await work.createProjectAction({ name: "Projet P", contactId: id.contact, organizationId: id.org, opportunityId: id.opp }));
  ok(await work.setProjectMemberAction(id.P, bob.userId, "EDITOR"));
  ok(await work.setProjectMemberAction(id.P, gina.userId, "OWNER"));
  ok(await work.setProjectMemberAction(id.P, carol.userId, "COMMENTER"));
  id.taskP = ok(
    await work.createTaskAction({ title: "Tâche P", projectId: id.P, contactId: id.contact, opportunityId: id.opp, followUpId: id.followUp, dueDate: "2020-01-01" }),
  ).id;
  id.R = ok(await work.createProjectAction({ name: "Projet R" }));
  ok(await work.setProjectMemberAction(id.R, dan.userId, "EDITOR"));

  await signIn(bob);
  id.bobContact = await createContactRecord(bob.workspaceId, { firstName: "Bob", lastName: "BOBOWN", ownerId: bob.userId });
});

describe("la propriétaire voit tous ses liens (non-régression)", () => {
  it("détail de tâche, détail de projet, liste du projet, historique", async () => {
    await signIn(alice);
    const detail = await getTaskDetail(actorOf(alice), id.taskP);
    expect(detail.contact).toEqual({ id: id.contact, label: `Camille ${C_NAME}` });
    expect(detail.opportunity).toEqual({ id: id.opp, label: OPP_NAME });
    expect(detail.followUp).toEqual({ id: id.followUp, label: FU_NAME });
    expect(detail.task.contactId).toBe(id.contact);
    const project = await getProjectDetail(actorOf(alice), id.P);
    expect(project.contact).toEqual({ id: id.contact, label: `Camille ${C_NAME}` });
    expect(project.organization).toEqual({ id: id.org, label: O_NAME });
    const bundle = await getProjectBundle(actorOf(alice), id.P);
    const task = bundle.tasks.find((t) => t.id === id.taskP)!;
    expect([task.contactId, task.opportunityId, task.followUpId]).toEqual([id.contact, id.opp, id.followUp]);
  });

  it("listes historiques (/tasks, /today, indicateurs) : contact et suivi nommés", async () => {
    await signIn(alice);
    const list = await getTaskList("todo");
    const view = list.sections.flatMap((s) => s.items).find((t) => t.id === id.taskP)!;
    expect(view.contactName).toContain(C_NAME);
    expect(view.followUpLabel).toContain(FU_NAME);
    const actionable = (await getActionableTasks(new Date())).find((t) => t.id === id.taskP)!;
    expect(actionable.contactId).toBe(id.contact);
  });
});

describe("listes historiques : un co-membre ne lit pas les fiches liées", () => {
  it("getTaskList, getActionableTasks, getTasksForKpi : ni contact ni suivi d'Alice", async () => {
    await signIn(bob);
    const list = await getTaskList("todo");
    const lists = [
      list.sections.flatMap((s) => s.items),
      await getActionableTasks(new Date()),
      await getTasksForKpi(new Date()),
    ];
    for (const views of lists) {
      const view = views.find((t) => t.id === id.taskP);
      expect(view).toBeDefined();
      expect(view!.contactId).toBeNull();
      expect(view!.contactName).toBeNull();
      expect(view!.followUpId).toBeNull();
      expect(view!.followUpLabel).toBeNull();
      const text = JSON.stringify(view);
      for (const secret of [C_NAME, FU_NAME, id.contact, id.followUp]) expect(text).not.toContain(secret);
    }
  });
});

describe("un lien masqué ne peut être ni modifié ni retiré", () => {
  it("tâche : l'éditeur ne peut ni détacher ni remplacer le contact, l'organisation ou l'opportunité d'Alice", async () => {
    await signIn(bob);
    const before = await crmLinks();
    for (const patch of [{ contactId: null }, { contactId: id.bobContact }, { opportunityId: null }]) {
      const r = refused(await work.updateTaskAction(id.taskP, patch));
      expect(r.code).toBe("FORBIDDEN");
      expect(r.error).toBe(LOCKED_CRM_LINK);
    }
    expect(await crmLinks()).toEqual(before);
  });

  it("tâche : l'éditeur modifie les autres champs ; renvoyer le lien tel quel n'est pas le modifier", async () => {
    await signIn(bob);
    ok(await work.updateTaskAction(id.taskP, { title: "Tâche P (Bob)" }));
    ok(await work.updateTaskAction(id.taskP, { title: "Tâche P", contactId: id.contact }));
    expect((await crmLinks()).task.contactId).toBe(id.contact);
  });

  it("tâche : l'éditeur peut lier sa propre fiche là où il n'y a pas de lien, et Alice ne la lit pas", async () => {
    await signIn(bob);
    ok(await work.updateTaskAction(id.taskP, { organizationId: null })); // aucun lien : rien à protéger
    const bobOrg = await createOrganizationRecord(bob.workspaceId, { name: "BOBORG", ownerId: bob.userId });
    ok(await work.updateTaskAction(id.taskP, { organizationId: bobOrg }));
    await signIn(alice);
    const detail = await getTaskDetail(actorOf(alice), id.taskP);
    expect(detail.organization).toEqual({ hidden: true });
    expect(JSON.stringify(detail)).not.toContain("BOBORG");
    // Alice, à son tour, ne peut pas retirer le lien de Bob.
    expect(refused(await work.updateTaskAction(id.taskP, { organizationId: null })).code).toBe("FORBIDDEN");
    await signIn(bob);
    ok(await work.updateTaskAction(id.taskP, { organizationId: null }));
  });

  it("formulaire historique : renvoyer le contact vide garde le lien d'Alice", async () => {
    await signIn(bob);
    const form = new FormData();
    form.set("id", id.taskP);
    form.set("title", "Tâche P");
    form.set("dueDate", "2020-01-01");
    form.set("notes", "modifiée par Bob");
    form.set("contactId", "");
    const result = await updateTask({ status: "idle" } as never, form);
    expect(result.status).toBe("success");
    const task = await prisma.task.findUniqueOrThrow({ where: { id: id.taskP }, select: { contactId: true, notes: true } });
    expect(task.contactId).toBe(id.contact);
    expect(task.notes).toContain("modifiée par Bob");
  });

  it("formulaire historique : remplacer le contact d'Alice par le sien est refusé, avec la raison", async () => {
    await signIn(bob);
    const form = new FormData();
    form.set("id", id.taskP);
    form.set("title", "Tâche P");
    form.set("dueDate", "2020-01-01");
    form.set("notes", "");
    form.set("contactId", id.bobContact);
    const result = await updateTask({ status: "idle" } as never, form);
    expect(result).toMatchObject({ status: "error", message: LOCKED_CRM_LINK });
    expect((await crmLinks()).task.contactId).toBe(id.contact);
  });

  it("projet : un membre Gestion ne peut ni retirer ni remplacer les liens d'Alice, mais modifie le reste", async () => {
    await signIn(gina);
    const project = await getProjectDetail(actorOf(gina), id.P);
    expect(project.contact).toEqual({ hidden: true });
    for (const patch of [{ contactId: null }, { organizationId: null }, { opportunityId: null }]) {
      expect(refused(await work.updateProjectAction(id.P, patch)).error).toBe(LOCKED_CRM_LINK);
    }
    // Ce qu'envoie la boîte de réglages : les liens masqués sont omis.
    ok(await work.updateProjectAction(id.P, { name: "Projet P", description: "par Gina" }));
    expect((await crmLinks()).project).toEqual({ contactId: id.contact, organizationId: id.org, opportunityId: id.opp });
  });

  it("projet : la propriétaire garde la main sur ses liens", async () => {
    await signIn(alice);
    ok(await work.updateProjectAction(id.P, { opportunityId: null }));
    ok(await work.updateProjectAction(id.P, { opportunityId: id.opp }));
    expect((await crmLinks()).project.opportunityId).toBe(id.opp);
  });
});

describe("partage par adresse e-mail exacte", () => {
  it("la personne qui gère ajoute un compte hors de son annuaire, sans tenir compte de la casse", async () => {
    await signIn(alice);
    id.S = ok(await work.createProjectAction({ name: "Projet S", contactId: id.contact }));
    const added = ok(await work.addProjectMemberByEmailAction(id.S, `  ${paula.email.toUpperCase()} `, "COMMENTER"));
    expect(added.userId).toBe(paula.userId);
    const member = await prisma.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: id.S, userId: paula.userId } } });
    expect(member.role).toBe("COMMENTER");

    await signIn(paula);
    const project = await getProjectDetail(actorOf(paula), id.S);
    expect(project.contact).toEqual({ hidden: true });
    expect(JSON.stringify(project)).not.toContain(C_NAME);
  });

  it("refus : adresse inconnue, compte d'un autre espace, compte inactif, déjà membre", async () => {
    await signIn(alice);
    const inactive = await addUserToWorkspace(alice.workspaceId, "Inactif");
    await prisma.user.update({ where: { id: inactive.userId }, data: { isActive: false } });
    for (const email of ["inconnu@partenaire.test", other.email, inactive.email, paula.email]) {
      expect(refused(await work.addProjectMemberByEmailAction(id.S, email, "EDITOR")).code).toBe("VALIDATION");
    }
    expect(await prisma.projectMember.count({ where: { projectId: id.S, userId: { in: [other.userId, inactive.userId] } } })).toBe(0);
  });

  it("refus : niveau Gestion par e-mail, et personne qui ne gère pas le projet", async () => {
    await signIn(alice);
    expect(refused(await work.addProjectMemberByEmailAction(id.R, paula.email, "OWNER" as never)).code).toBe("VALIDATION");
    await signIn(bob); // Édition sur P, pas Gestion
    expect(refused(await work.addProjectMemberByEmailAction(id.P, paula.email, "COMMENTER")).code).toBe("FORBIDDEN");
    await signIn(dan); // ne lit pas P
    expect(refused(await work.addProjectMemberByEmailAction(id.P, paula.email, "COMMENTER")).code).toBe("NOT_FOUND");
    expect(await prisma.projectMember.count({ where: { projectId: { in: [id.P, id.R] }, userId: paula.userId } })).toBe(0);
  });
});

describe("le responsable d'une tâche de projet doit pouvoir lire le projet", () => {
  it("affecter à une personne de l'annuaire non membre du projet : refusé", async () => {
    await signIn(alice);
    const r = refused(await work.updateTaskAction(id.taskP, { assigneeId: dan.userId }));
    expect(r.error).toBe(ASSIGNEE_NOT_MEMBER);
    expect(refused(await work.createTaskAction({ title: "x", projectId: id.P, assigneeId: dan.userId })).error).toBe(ASSIGNEE_NOT_MEMBER);
    const subtask = await work.createTaskAction({ title: "sous-tâche", parentId: id.taskP, assigneeId: dan.userId });
    expect(refused(subtask).error).toBe(ASSIGNEE_NOT_MEMBER);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: id.taskP }, select: { assigneeId: true } })).assigneeId).toBeNull();
  });

  it("affecter à un membre, quel que soit son niveau, ou à une tâche libre : accepté", async () => {
    await signIn(alice);
    ok(await work.updateTaskAction(id.taskP, { assigneeId: carol.userId }));
    ok(await work.updateTaskAction(id.taskP, { assigneeId: bob.userId }));
    ok(await work.createTaskAction({ title: "sous-tâche de Bob", parentId: id.taskP, assigneeId: bob.userId }));
    ok(await work.createTaskAction({ title: "libre pour Dan", assigneeId: dan.userId }));
  });
});
