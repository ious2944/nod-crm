import { beforeAll, describe, expect, it } from "vitest";

import * as commerceActions from "@/app/(app)/commerce/actions";
import * as contactActions from "@/app/(app)/contacts/actions";
import * as importActions from "@/app/(app)/contacts/import-actions";
import * as work from "@/app/(app)/tasks/work-actions";
import { GET as photoGet } from "@/app/api/contacts/[id]/photo/route";
import { prisma } from "@/lib/prisma";
import { changeFor } from "@/lib/tasks/realtime-filter";
import { listTrash } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";
import {
  getCrmRef,
  getLinkedWork,
  getMyTasks,
  getProjectBundle,
  getProjectDetail,
  getTaskDetail,
  getWorkContext,
  listNotifications,
  searchCrm,
  searchTasks,
} from "@/lib/tasks/work-queries";

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
 * Lot A — attaque adverse.
 *
 * Scénario : Alice est la propriétaire. Bob est **co-membre éditeur** d'un seul
 * de ses projets (P), Carol en est **commentatrice**, Dan membre d'un autre
 * projet (R) qu'Alice ne partage PAS avec Bob. Mallory est un simple
 * utilisateur de l'espace sans aucun partage. L'attaquant cherche, par chaque
 * voie, à lire ou modifier une donnée d'Alice au-delà de ce que le partage de
 * projet accorde.
 *
 * Chaque test encode le comportement **sûr attendu**. Un test qui échoue
 * dénonce une fuite. Les descriptions préfixées « FUITE » sont les fuites
 * trouvées (elles échouent aujourd'hui) ; les autres prouvent qu'une piste est
 * sans fuite.
 *
 * Marque `SECRET…` portée par les données d'Alice jamais destinées à l'attaquant.
 */

const C_NAME = "SECRETCONTACT";
const O_NAME = "SECRETORG";
const OPP_NAME = "SECRETOPP";
const FU_NAME = "SECRETFOLLOWUP";

function ok<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`refusé: ${r.error}`);
  return r.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const req = (path: string) => new Request(`http://localhost${path}`);

let alice: TestUser;
let bob: TestUser; // éditeur de P
let carol: TestUser; // commentatrice de P
let dan: TestUser; // membre de R (projet d'Alice NON partagé avec Bob)
let mallory: TestUser; // aucun partage

const id: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  alice = await createWorkspaceWithUser("attack-ws");
  bob = await addUserToWorkspace(alice.workspaceId, "Bob");
  carol = await addUserToWorkspace(alice.workspaceId, "Carol");
  dan = await addUserToWorkspace(alice.workspaceId, "Dan");
  mallory = await addUserToWorkspace(alice.workspaceId, "Mallory");

  await signIn(alice);
  // CRM d'Alice (jamais partagé en V1).
  id.org = await createOrganizationRecord(alice.workspaceId, { name: O_NAME });
  id.contact = await createContactRecord(alice.workspaceId, { firstName: "Camille", lastName: C_NAME, email: "secret@client.test", organizationId: id.org });
  await prisma.contact.update({ where: { id: id.contact }, data: { photoKey: "k", photoMimeType: "image/png" } });
  id.opp = await createOpportunityRecord(alice.workspaceId, id.org, { name: OPP_NAME, contactId: id.contact });
  id.followUp = await createFollowUpRecord(alice.workspaceId, FU_NAME);

  // Projet partagé P (Bob éditeur, Carol commentatrice), lié au CRM d'Alice.
  id.P = ok(await work.createProjectAction({ name: "Projet partagé P", contactId: id.contact, organizationId: id.org, opportunityId: id.opp }));
  ok(await work.setProjectMemberAction(id.P, bob.userId, "EDITOR"));
  ok(await work.setProjectMemberAction(id.P, carol.userId, "COMMENTER"));
  // Tâche de P liée aux 4 types de fiches CRM d'Alice.
  id.taskP = ok(await work.createTaskAction({ title: "Tâche P", projectId: id.P, contactId: id.contact, opportunityId: id.opp, followUpId: id.followUp })).id;

  // Projet privé Q d'Alice (non partagé) + tâche libre privée.
  id.Q = ok(await work.createProjectAction({ name: "Projet privé Q" }));
  id.taskQ = ok(await work.createTaskAction({ title: "SECRETTASKQ", projectId: id.Q })).id;
  id.freeTask = ok(await work.createTaskAction({ title: "SECRETFREE" })).id;

  // Projet R partagé avec Dan seulement (pour l'isolement de l'annuaire).
  id.R = ok(await work.createProjectAction({ name: "Projet R" }));
  ok(await work.setProjectMemberAction(id.R, dan.userId, "EDITOR"));

  // Réglages d'espace d'Alice.
  id.tag = ok(await work.createTagAction({ name: "etiquette-alice" })).id;
  id.field = ok(await work.saveCustomFieldAction(null, { name: "Champ Alice", type: "TEXT" }));
  id.rule = ok(await work.saveRuleAction(null, null, { name: "SECRETRULE", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "HIGH" }], isEnabled: true }));
  id.template = ok(await work.saveTaskTemplateAction(null, { name: "SECRETTEMPLATE", title: "SECRETTEMPLATE" }));

  // CRM propre à Bob (pour vérifier qu'il peut lier ses fiches, pas celles d'Alice).
  await signIn(bob);
  id.bobContact = await createContactRecord(bob.workspaceId, { firstName: "BobContact", lastName: "BOBOWN", ownerId: bob.userId });
});

// ───────────────────────────────────────────────────────────────────────────
// FUITE CONNUE, RÉSERVÉE AU LOT B — le masquage des liens CRM dans un projet
// partagé (règle 4, docs/permissions-v1.md §9.6) est hors du périmètre du lot A :
// un co-membre lit encore, par les liens d'une tâche ou d'un projet, le nom et
// l'identifiant des fiches CRM de la propriétaire. Aucun accès direct (voir
// plus bas). Tant que le lot B n'est pas livré, aucun projet n'est partagé
// avec un partenaire (avertissement du cadrage).
//
// Tests de CARACTÉRISATION : ils affirment la fuite telle qu'elle est, champ
// par champ. Le jour où le lot B corrige un champ, l'assertion correspondante
// échoue — il faut alors la remplacer par l'assertion inverse (masqué), pas
// supprimer le test. Une erreur sans rapport (amorçage cassé) fait aussi échouer.
// ───────────────────────────────────────────────────────────────────────────

describe("fuite connue (lot B) : liens CRM visibles d'un co-membre", () => {
  it("getTaskDetail expose contact, opportunité et suivi d'Alice au co-membre éditeur", async () => {
    await signIn(bob);
    const detail = await getTaskDetail(actorOf(bob), id.taskP);
    expect(detail.contact?.id).toBe(id.contact);
    expect(JSON.stringify(detail.contact)).toContain(C_NAME);
    expect(detail.opportunity?.id).toBe(id.opp);
    expect(JSON.stringify(detail.opportunity)).toContain(OPP_NAME);
    expect(detail.followUp?.id).toBe(id.followUp);
    expect(JSON.stringify(detail.followUp)).toContain(FU_NAME);
    expect(detail.task.contactId).toBe(id.contact);
    expect(detail.task.opportunityId).toBe(id.opp);
  });

  it("getTaskDetail expose le même contact à la commentatrice", async () => {
    await signIn(carol);
    const detail = await getTaskDetail(actorOf(carol), id.taskP);
    expect(detail.contact?.id).toBe(id.contact);
    expect(JSON.stringify(detail.contact)).toContain(C_NAME);
  });

  it("getProjectDetail expose contact, organisation et opportunité d'Alice au co-membre", async () => {
    await signIn(bob);
    const d = await getProjectDetail(actorOf(bob), id.P);
    expect(d.contact?.id).toBe(id.contact);
    expect(JSON.stringify(d.contact)).toContain(C_NAME);
    expect(d.organization?.id).toBe(id.org);
    expect(JSON.stringify(d.organization)).toContain(O_NAME);
    expect(d.opportunity?.id).toBe(id.opp);
    expect(JSON.stringify(d.opportunity)).toContain(OPP_NAME);
  });

  it("getProjectBundle (TaskItem) expose les identifiants des fiches liées", async () => {
    await signIn(bob);
    const bundle = await getProjectBundle(actorOf(bob), id.P);
    const taskP = bundle.tasks.find((t) => t.id === id.taskP)!;
    expect(taskP.contactId).toBe(id.contact);
    expect(taskP.opportunityId).toBe(id.opp);
    expect(taskP.followUpId).toBe(id.followUp);
  });

  it("l'historique d'une tâche partagée nomme les contacts d'Alice", async () => {
    // Alice change le contact lié : la ligne « Contact » garde les deux noms en clair.
    await signIn(alice);
    const other = await createContactRecord(alice.workspaceId, { firstName: "Autre", lastName: "SECRETCONTACT2" });
    ok(await work.updateTaskAction(id.taskP, { contactId: other }));
    await signIn(bob);
    const history = JSON.stringify((await getTaskDetail(actorOf(bob), id.taskP)).activity);
    expect(history).toContain(C_NAME);
    expect(history).toContain("SECRETCONTACT2");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PISTES SANS FUITE — contrôles lot A effectivement en place.
// ───────────────────────────────────────────────────────────────────────────

describe("le co-membre n'atteint rien hors du projet partagé", () => {
  it("projet privé Q, tâche privée, tâche libre : introuvables", async () => {
    await signIn(bob);
    await expect(getProjectDetail(actorOf(bob), id.Q)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProjectBundle(actorOf(bob), id.Q)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTaskDetail(actorOf(bob), id.taskQ)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTaskDetail(actorOf(bob), id.freeTask)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await searchTasks(actorOf(bob), { search: "SECRET", completion: "all" })).toEqual([]);
    expect((await getMyTasks(actorOf(bob), true)).map((t) => t.id)).not.toContain(id.taskQ);
  });

  it("le CRM d'Alice n'est jamais atteignable en direct (le CRM n'est pas partagé)", async () => {
    await signIn(bob);
    await expect(getLinkedWork(actorOf(bob), "contact", id.contact)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLinkedWork(actorOf(bob), "organization", id.org)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLinkedWork(actorOf(bob), "opportunity", id.opp)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getCrmRef(actorOf(bob), "contact", id.contact)).toBeNull();
    expect(await getCrmRef(actorOf(bob), "organization", id.org)).toBeNull();
    expect(await getCrmRef(actorOf(bob), "opportunity", id.opp)).toBeNull();
    for (const kind of ["contact", "organization", "opportunity"] as const) {
      expect(await searchCrm(actorOf(bob), kind, "SECRET")).toEqual([]);
    }
    // Les actions CRM (lecture déguisée) : rien non plus.
    await signIn(bob);
    expect(await contactActions.findContacts("SECRET")).toEqual([]);
    expect(await commerceActions.findOpportunities("SECRET")).toEqual([]);
  });

  it("photo de contact d'Alice : 404 comme une fiche inexistante", async () => {
    await signIn(bob);
    expect((await photoGet(req(`/api/contacts/${id.contact}/photo`), ctx({ id: id.contact }))).status).toBe(404);
  });
});

describe("le co-membre ne peut pas écrire une donnée d'Alice", () => {
  it("ne peut lier une tâche de P à une fiche CRM d'Alice (seulement aux siennes)", async () => {
    await signIn(bob);
    // Fiche d'Alice : refusée, à la création comme à la mise à jour.
    expect(await work.createTaskAction({ title: "x", projectId: id.P, contactId: id.contact })).toMatchObject({ ok: false });
    expect(await work.createTaskAction({ title: "x2", projectId: id.P, opportunityId: id.opp })).toMatchObject({ ok: false });
    expect(await work.updateTaskAction(id.taskP, { contactId: id.contact })).toMatchObject({ ok: false });
    // Fiche de Bob : acceptée (preuve que ce n'est pas un refus général).
    expect(await work.createTaskAction({ title: "lie-bob", projectId: id.P, contactId: id.bobContact })).toMatchObject({ ok: true });
  });

  it("ne peut ni modifier le projet d'Alice ni le reconfigurer (gestion = propriétaire)", async () => {
    await signIn(bob);
    expect(await work.updateProjectAction(id.P, { name: "détourné" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.setProjectMemberAction(id.P, mallory.userId, "EDITOR")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.archiveProjectAction(id.P, true)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.deleteProjectAction(id.P)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const row = await prisma.project.findUniqueOrThrow({ where: { id: id.P } });
    expect(row.name).toBe("Projet partagé P");
  });

  it("étiquette et champ d'espace d'Alice : lisibles mais non modifiables (décision a)", async () => {
    await signIn(bob);
    expect(await work.updateTagAction(id.tag, { name: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.deleteTagAction(id.tag)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.saveCustomFieldAction(id.field, { name: "x", type: "TEXT" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await work.deleteCustomFieldAction(id.field)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("règle et modèle d'espace d'Alice : personnels, donc introuvables", async () => {
    await signIn(bob);
    expect(await work.saveRuleAction(id.rule, null, { name: "x", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "LOW" }], isEnabled: true })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.deleteRuleAction(id.rule)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.saveTaskTemplateAction(id.template, { name: "x", title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.deleteTaskTemplateAction(id.template)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // Utiliser le modèle d'Alice pour créer une tâche : refusé.
    expect(await work.createTaskAction({ title: "x", templateId: id.template })).toMatchObject({ ok: false });
  });
});

describe("sous-tâches, parent, déplacement, dépendances d'une tâche privée d'Alice", () => {
  it("créer une sous-tâche sous une tâche privée d'Alice : introuvable", async () => {
    await signIn(bob);
    expect(await work.createTaskAction({ title: "sous", parentId: id.taskQ })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.createTaskAction({ title: "sous", parentId: id.freeTask })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("rattacher sa propre tâche sous une tâche d'Alice : introuvable", async () => {
    await signIn(bob);
    const mine = ok(await work.createTaskAction({ title: "à moi" })).id;
    expect(await work.setTaskParentAction(mine, id.taskQ)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.setTaskParentAction(mine, id.freeTask)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("ajouter la tâche privée d'Alice à son propre projet : introuvable", async () => {
    await signIn(bob);
    const mineProject = ok(await work.createProjectAction({ name: "projet de Bob" }));
    expect(await work.addTaskToProjectAction(id.taskQ, mineProject)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.moveTaskAction({ taskId: id.taskQ, projectId: mineProject, sectionId: null })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("créer une dépendance vers une tâche privée d'Alice : introuvable", async () => {
    await signIn(bob);
    expect(await work.addDependencyAction(id.taskP, id.taskQ)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.addDependencyAction(id.taskP, id.freeTask)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("abonnement et commentaires ne donnent aucun accès", () => {
  it("un commentateur ne peut pas se promouvoir collaborateur", async () => {
    await signIn(carol);
    expect(await work.setFollowerAction(id.taskP, carol.userId, "COLLABORATOR")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Se mettre simple abonné reste possible (lecture), mais n'ouvre rien de plus.
    expect(await work.setFollowerAction(id.taskP, carol.userId, "FOLLOWER")).toMatchObject({ ok: true });
  });

  it("un abonné (FOLLOWER) sans autre lien ne voit pas une tâche privée d'Alice", async () => {
    await signIn(alice);
    // Alice abonne Mallory à sa tâche libre privée : l'abonnement ne donne aucun accès.
    await prisma.taskFollower.create({ data: { taskId: id.freeTask, userId: mallory.userId, kind: "FOLLOWER" } });
    await signIn(mallory);
    await expect(getTaskDetail(actorOf(mallory), id.freeTask)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getMyTasks(actorOf(mallory), true)).map((t) => t.id)).not.toContain(id.freeTask);
  });
});

describe("annuaire, notifications, temps réel, formulaires", () => {
  it("l'annuaire du co-membre se limite à lui et aux membres du projet partagé", async () => {
    await signIn(bob);
    const context = await getWorkContext(actorOf(bob));
    const ids = context.users.map((u) => u.id).sort();
    // Bob partage P avec Alice et Carol ; il ne doit PAS voir Dan (membre de R) ni Mallory.
    expect(ids).toEqual([alice.userId, bob.userId, carol.userId].sort());
    const blob = JSON.stringify(context.users);
    expect(blob).not.toContain(dan.email);
    expect(blob).not.toContain(mallory.email);
    // Projets lisibles : P oui ; Q (privé d'Alice) et R (partagé avec Dan) non.
    const projectIds = context.projects.map((p) => p.id);
    expect(projectIds).toContain(id.P);
    expect(projectIds).not.toContain(id.Q);
    expect(projectIds).not.toContain(id.R);
  });

  it("notifications : liste et compteur ne contiennent rien des tâches non lisibles", async () => {
    // Alice fabrique une notification destinée à Mallory sur une tâche privée.
    await prisma.notification.create({ data: { workspaceId: alice.workspaceId, userId: mallory.userId, type: "ASSIGNED", title: "SECRETNOTIF", taskId: id.taskQ } });
    await signIn(mallory);
    expect(await listNotifications(actorOf(mallory))).toEqual([]);
    expect((await getWorkContext(actorOf(mallory))).unreadCount).toBe(0);
  });

  it("temps réel : un changement sur une donnée privée d'Alice n'est pas transmis", async () => {
    // Message portant une tâche/un projet privés d'Alice vers un co-membre d'un autre projet.
    expect(await changeFor(actorOf(bob), { w: alice.workspaceId, a: alice.userId, t: [id.taskQ, id.freeTask], p: [id.Q], k: "task_updated" })).toBeNull();
    // En revanche un changement sur le projet partagé P est bien transmis.
    const forP = await changeFor(actorOf(bob), { w: alice.workspaceId, a: alice.userId, t: [id.taskP], p: [id.P], k: "task_updated" });
    expect(forP?.projectIds).toContain(id.P);
  });

  it("submitForm exige l'Édition : un commentateur est refusé comme sur une ressource inexistante", async () => {
    await signIn(alice);
    const form = ok(await work.saveFormAction(null, id.P, { name: "Form P", fields: {} }));
    await signIn(carol);
    // Commentatrice : elle lit le projet, donc refus explicite (pas « introuvable »).
    expect(await work.submitFormAction(form, { title: "injecté par Carol" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Mallory (hors projet, aucune lecture) : introuvable.
    await signIn(mallory);
    expect(await work.submitFormAction(form, { title: "injecté par Mallory" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // Aucune tâche n'a été créée dans le projet par ces envois.
    expect(await prisma.task.count({ where: { title: { in: ["injecté par Carol", "injecté par Mallory"] } } })).toBe(0);
  });
});

describe("corbeille, duplication, vues, import", () => {
  it("corbeille : un co-membre ne voit ni ne restaure une tâche privée d'Alice", async () => {
    await signIn(alice);
    const victim = ok(await work.createTaskAction({ title: "SECRETTRASH" })).id;
    ok(await work.deleteTaskAction(victim));
    await signIn(bob);
    expect(await listTrash(actorOf(bob))).toEqual([]);
    expect(await work.restoreTaskAction(victim)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await work.purgeTaskAction(victim)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("dupliquer le projet privé d'Alice : introuvable", async () => {
    await signIn(bob);
    expect(await work.duplicateProjectAction(id.Q, {})).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("import de contacts : l'aperçu ne compare qu'aux contacts de l'acteur (pas d'oracle sur Alice)", async () => {
    await signIn(bob);
    const csv = new File([`Prénom,Nom,Adresse de messagerie\r\nCamille,Client,secret@client.test\r\n`], "c.csv", { type: "text/csv" });
    const data = new FormData();
    data.set("file", csv);
    const preview = (await importActions.previewContactImport(data)) as { ok: boolean; preview?: { existingDuplicates: unknown[]; toCreate: number } };
    expect(preview.ok).toBe(true);
    // Le contact d'Alice a cette adresse, mais pour Bob ce n'est pas un doublon.
    expect(preview.preview?.existingDuplicates).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain(C_NAME);
  });
});

describe("oracle : ressource d'autrui indiscernable d'une ressource inexistante", () => {
  it("getTaskDetail et actions répondent pareil pour un id inexistant et pour un id privé d'Alice", async () => {
    await signIn(bob);
    const missing = "00000000-0000-4000-8000-000000000000";
    const a = await getTaskDetail(actorOf(bob), id.taskQ).catch((e) => e.code);
    const b = await getTaskDetail(actorOf(bob), missing).catch((e) => e.code);
    expect(a).toBe(b);
    expect(a).toBe("NOT_FOUND");
    expect(await work.updateTaskAction(id.taskQ, { title: "x" })).toEqual(await work.updateTaskAction(missing, { title: "x" }));
  });
});
