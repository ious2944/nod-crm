import { beforeEach, describe, expect, it } from "vitest";

import {
  addTaskToProjectAction,
  createProjectAction,
  createTaskAction,
  deleteProjectAction,
  deleteTaskAction,
  duplicateProjectAction,
  duplicateTaskAction,
  saveCustomFieldAction,
  saveTaskTemplateAction,
  setCustomFieldValueAction,
  setProjectMemberAction,
  taskToTemplateAction,
} from "@/app/(app)/tasks/work-actions";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/tasks/types";

import { addUserToWorkspace, createWorkspaceWithUser, resetDatabase, signIn, type TestUser, shareDirectory } from "./fixtures";

/**
 * Duplications et modèles (revue c580137 : I1, I3, I5, m8).
 *
 * - une copie ne réactive jamais une tâche ou sous-tâche supprimée ;
 * - un modèle n'est utilisable et modifiable qu'avec les droits sur son projet ;
 * - la copie d'une tâche partagée ignore les projets supprimés ou non
 *   modifiables, et n'emporte pas les valeurs des champs de ces projets.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}

describe("duplications et modèles", () => {
  let alice: TestUser, bob: TestUser, dan: TestUser;
  let P: string, W: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("copies");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    dan = await addUserToWorkspace(alice.workspaceId, "Dan");
    // Lot A (décision b) : les personnes du scénario partagent un projet « Équipe », donc l'annuaire.
    await shareDirectory(alice, bob, dan);
    await signIn(alice);
    P = ok(await createProjectAction({ name: "Privé", visibility: "PRIVATE" }));
    // Lot A (décision f) : plus de projet ouvert à l'espace ; W est partagé
    // avec Bob et Dan en éditeurs (ce qu'ils avaient sur un projet « espace »).
    W = ok(await createProjectAction({ name: "Partagé" }));
    ok(await setProjectMemberAction(W, bob.userId, "EDITOR"));
    ok(await setProjectMemberAction(W, dan.userId, "EDITOR"));
  });

  const tasksOf = (projectId: string) =>
    prisma.task.findMany({ where: { projects: { some: { projectId } } }, select: { title: true, deletedAt: true, subtasks: { select: { title: true, deletedAt: true } } }, orderBy: { title: "asc" } });

  it("I1 : dupliquer un projet ne ramène ni tâche ni sous-tâche supprimée (commentateur compris)", async () => {
    const gone = ok(await createTaskAction({ title: "Supprimée", projectId: W }));
    const alive = ok(await createTaskAction({ title: "Vivante", projectId: W }));
    const subGone = ok(await createTaskAction({ title: "Sous-tâche supprimée", parentId: alive.id }));
    ok(await createTaskAction({ title: "Sous-tâche vivante", parentId: alive.id }));
    ok(await deleteTaskAction(gone.id));
    ok(await deleteTaskAction(subGone.id));
    ok(await setProjectMemberAction(W, bob.userId, "COMMENTER"));

    // Politique : dupliquer ne modifie pas la source ; lire suffit, la copie
    // ne contient que ce que la personne peut lire.
    await signIn(bob);
    const copy = ok(await duplicateProjectAction(W, { name: "Copie", includeTasks: true }));
    expect(await tasksOf(copy)).toEqual([
      { title: "Vivante", deletedAt: null, subtasks: [{ title: "Sous-tâche vivante", deletedAt: null }] },
    ]);
  });

  it("I1 : un projet créé depuis un modèle ne reprend pas les tâches supprimées du modèle", async () => {
    const template = ok(await duplicateProjectAction(W, { name: "Modèle", asTemplate: true, includeTasks: false }));
    const kept = ok(await createTaskAction({ title: "Étape", projectId: template }));
    const removed = ok(await createTaskAction({ title: "Étape retirée", projectId: template }));
    const subRemoved = ok(await createTaskAction({ title: "Sous-étape retirée", parentId: kept.id }));
    ok(await deleteTaskAction(subRemoved.id));
    ok(await deleteTaskAction(removed.id));
    const fromTemplate = ok(await createProjectAction({ name: "Nouveau", templateId: template }));
    expect(await tasksOf(fromTemplate)).toEqual([{ title: "Étape", deletedAt: null, subtasks: [] }]);
  });

  it("m8 : enregistrer une tâche comme modèle exclut ses sous-tâches supprimées", async () => {
    const task = ok(await createTaskAction({ title: "Source", projectId: W }));
    ok(await createTaskAction({ title: "Gardée", parentId: task.id }));
    const sub = ok(await createTaskAction({ title: "Supprimée", parentId: task.id }));
    ok(await deleteTaskAction(sub.id));
    const templateId = ok(await taskToTemplateAction(task.id, W));
    const template = await prisma.taskTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.subtasks).toEqual(["Gardée"]);
  });

  it("I3 : un modèle d'un projet privé n'est ni utilisable ni modifiable sans accès, même avec son identifiant", async () => {
    ok(await setProjectMemberAction(P, dan.userId, "EDITOR"));
    const templateId = ok(
      await saveTaskTemplateAction(null, { name: "Modèle", title: "MODELE-SECRET", description: "description secrète", projectId: P, subtasks: ["étape secrète"] }),
    );

    // Bob n'a jamais eu accès.
    await signIn(bob);
    expect(await createTaskAction({ title: "x", templateId })).toMatchObject({ ok: false, code: "VALIDATION", error: "Modèle introuvable." });
    expect(await saveTaskTemplateAction(templateId, { name: "Écrasé", title: "par Bob" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await saveTaskTemplateAction(templateId, { name: "Écrasé", title: "par Bob", projectId: W })).toMatchObject({ ok: false, code: "NOT_FOUND" });

    // Dan utilise le modèle tant qu'il est éditeur…
    await signIn(dan);
    const made = ok(await createTaskAction({ title: "Depuis le modèle", templateId, projectId: P }));
    const madeRow = await prisma.task.findUniqueOrThrow({ where: { id: made.id }, include: { subtasks: true } });
    expect(madeRow.notes).toBe("description secrète");
    expect(madeRow.subtasks.map((t) => t.title)).toEqual(["étape secrète"]);
    // … puis perd l'accès.
    await signIn(alice);
    ok(await setProjectMemberAction(P, dan.userId, null));
    await signIn(dan);
    expect(await createTaskAction({ title: "x", templateId })).toMatchObject({ ok: false, error: "Modèle introuvable." });
    expect(await saveTaskTemplateAction(templateId, { name: "Écrasé", title: "par Dan" })).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const stored = await prisma.taskTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(stored).toMatchObject({ name: "Modèle", title: "MODELE-SECRET", projectId: P });
    expect(await prisma.task.count({ where: { notes: "description secrète", createdById: { in: [bob.userId] } } })).toBe(0);
  });

  it("I3 : déplacer un modèle vers un autre projet exige les droits sur l'ancien et le nouveau", async () => {
    const templateId = ok(await saveTaskTemplateAction(null, { name: "Modèle", title: "T", projectId: P }));
    ok(await setProjectMemberAction(W, bob.userId, "EDITOR"));
    await signIn(bob);
    expect(await saveTaskTemplateAction(templateId, { name: "Modèle", title: "T", projectId: W })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await prisma.taskTemplate.findUniqueOrThrow({ where: { id: templateId } })).projectId).toBe(P);
  });

  it("I5 : dupliquer une tâche partagée ignore le projet supprimé et les champs des projets ignorés", async () => {
    const pField = ok(await saveCustomFieldAction(null, { name: "Budget privé", type: "TEXT" }, P));
    const wField = ok(await saveCustomFieldAction(null, { name: "Note publique", type: "TEXT" }, W));
    const task = ok(await createTaskAction({ title: "Partagée", projectId: W }));
    ok(await addTaskToProjectAction(task.id, P, null));
    ok(await setCustomFieldValueAction(task.id, pField, "100 k€"));
    ok(await setCustomFieldValueAction(task.id, wField, "visible"));
    ok(await deleteProjectAction(P));

    const copy = ok(await duplicateTaskAction(task.id, true));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: copy.id }, include: { projects: true, customValues: true } });
    expect(row.projects.map((m) => m.projectId)).toEqual([W]);
    expect(row.customValues.map((v) => v.fieldId)).toEqual([wField]);
  });

  it("I5 : la copie n'entre que dans les projets modifiables par la personne qui duplique", async () => {
    const task = ok(await createTaskAction({ title: "Partagée", projectId: W }));
    ok(await addTaskToProjectAction(task.id, P, null));
    ok(await setProjectMemberAction(P, dan.userId, "COMMENTER"));
    await signIn(dan);
    const copy = ok(await duplicateTaskAction(task.id, true));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: copy.id }, include: { projects: true } });
    expect(row.projects.map((m) => m.projectId)).toEqual([W]);
  });

  it("N3 : dupliquer une sous-tâche garde les champs des projets de sa parente lisibles, jamais ceux d'un projet privé inaccessible", async () => {
    // La parente est dans W (ouvert) et dans P (privé, Bob n'en est pas membre).
    const wField = ok(await saveCustomFieldAction(null, { name: "Note W", type: "TEXT" }, W));
    const pField = ok(await saveCustomFieldAction(null, { name: "Budget privé", type: "TEXT" }, P));
    const parent = ok(await createTaskAction({ title: "Parente", projectId: W }));
    ok(await addTaskToProjectAction(parent.id, P, null));
    const sub = ok(await createTaskAction({ title: "Sous-tâche", parentId: parent.id }));
    ok(await setCustomFieldValueAction(sub.id, wField, "visible"));
    ok(await setCustomFieldValueAction(sub.id, pField, "100 k€"));

    // Alice (membre de P) : les deux valeurs sont copiées.
    const copyAlice = ok(await duplicateTaskAction(sub.id, true));
    const aliceValues = await prisma.taskCustomFieldValue.findMany({ where: { taskId: copyAlice.id }, select: { fieldId: true, textValue: true } });
    expect(aliceValues.map((v) => v.fieldId).sort()).toEqual([wField, pField].sort());

    // Bob (éditeur de W par l'espace, sans accès à P) : seulement le champ de W.
    await signIn(bob);
    const copyBob = ok(await duplicateTaskAction(sub.id, true));
    const bobValues = await prisma.taskCustomFieldValue.findMany({ where: { taskId: copyBob.id }, select: { fieldId: true, textValue: true } });
    expect(bobValues).toEqual([{ fieldId: wField, textValue: "visible" }]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: copyBob.id } })).parentId).toBe(parent.id);
  });
});
