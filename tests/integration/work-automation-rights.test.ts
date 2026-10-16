import { beforeEach, describe, expect, it } from "vitest";

import {
  createProjectAction,
  createTaskAction,
  deleteRuleAction,
  saveRuleAction,
  setProjectMemberAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/tasks/types";
import { getProjectSettings, getTaskDetail } from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createWorkspaceWithUser, resetDatabase, signIn, type TestUser } from "./fixtures";

/**
 * Règles d'automatisation et droits (revue c580137, constat B1).
 *
 * Politique : une règle s'exécute avec les droits **actuels** de la personne
 * qui l'a enregistrée en dernier (création ou modification) ; elle ne touche
 * que les tâches que cette personne peut modifier, et s'arrête si cette
 * personne perd l'accès ou est désactivée. Une règle d'espace n'est
 * modifiable que par cette personne.
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const rule = (actions: unknown[], trigger = "TASK_CREATED") => ({ name: "Règle", trigger, triggerConfig: {}, conditions: [], actions, isEnabled: true });

describe("règles d'automatisation : droits de la personne qui les enregistre", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser, dan: TestUser;
  let P: string, W: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("auto-rights");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    dan = await addUserToWorkspace(alice.workspaceId, "Dan");
    await signIn(alice);
    P = ok(await createProjectAction({ name: "Privé", visibility: "PRIVATE" }));
    W = ok(await createProjectAction({ name: "Public" }));
    ok(await setProjectMemberAction(P, dan.userId, "EDITOR"));
  });

  it("une règle d'espace d'un non-membre ne touche pas les tâches du projet privé", async () => {
    await signIn(bob);
    const ruleId = ok(
      await saveRuleAction(null, null, rule([{ kind: "set_assignee", userId: bob.userId }, { kind: "add_comment", body: "bob était là" }])),
    );
    await signIn(alice);
    const secret = ok(await createTaskAction({ title: "Secret", projectId: P }));

    const row = await prisma.task.findUniqueOrThrow({ where: { id: secret.id } });
    expect(row.assigneeId).toBeNull();
    expect(await prisma.comment.count({ where: { taskId: secret.id } })).toBe(0);
    await expect(getTaskDetail(actorOf(bob), secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Aucune trace d'exécution sur une tâche que Bob ne peut pas lire.
    expect(await prisma.automationRun.count({ where: { ruleId, taskId: secret.id } })).toBe(0);

    // Sur une tâche que Bob peut modifier, la règle agit normalement.
    const open = ok(await createTaskAction({ title: "Ouverte", projectId: W }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBe(bob.userId);
    expect(await prisma.comment.count({ where: { taskId: open.id } })).toBe(1);
  });

  it("une règle de projet s'arrête quand son auteur perd l'accès au projet", async () => {
    await signIn(dan);
    ok(await saveRuleAction(null, P, rule([{ kind: "add_comment", body: "auto" }])));
    await signIn(alice);
    const before = ok(await createTaskAction({ title: "Avant", projectId: P }));
    expect(await prisma.comment.count({ where: { taskId: before.id } })).toBe(1);

    ok(await setProjectMemberAction(P, dan.userId, null));
    const after = ok(await createTaskAction({ title: "Après", projectId: P }));
    expect(await prisma.comment.count({ where: { taskId: after.id } })).toBe(0);
  });

  it("une règle s'arrête quand son auteur est désactivé", async () => {
    await signIn(dan);
    ok(await saveRuleAction(null, null, rule([{ kind: "add_comment", body: "auto" }])));
    await prisma.user.update({ where: { id: dan.userId }, data: { isActive: false } });
    await signIn(alice);
    const task = ok(await createTaskAction({ title: "Publique", projectId: W }));
    expect(await prisma.comment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("une règle ne change le responsable que si son auteur peut gérer la tâche", async () => {
    // Carol est commentatrice de W : elle lit les tâches mais ne les gère pas.
    ok(await setProjectMemberAction(W, carol.userId, "COMMENTER"));
    await signIn(carol);
    ok(await saveRuleAction(null, null, rule([{ kind: "set_assignee", userId: carol.userId }])));
    await signIn(alice);
    const task = ok(await createTaskAction({ title: "Publique", projectId: W }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
  });

  it("une règle d'espace n'est modifiable et supprimable que par son auteur", async () => {
    await signIn(bob);
    const ruleId = ok(await saveRuleAction(null, null, rule([{ kind: "add_comment", body: "auto" }])));
    await signIn(carol);
    expect(await saveRuleAction(ruleId, null, rule([{ kind: "set_assignee", userId: carol.userId }]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteRuleAction(ruleId)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const stored = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(stored.createdById).toBe(bob.userId);
    expect(JSON.stringify(stored.actions)).toContain("add_comment");

    // Auteur désactivé : la règle est inerte, un autre membre peut la reprendre ou la supprimer.
    await prisma.user.update({ where: { id: bob.userId }, data: { isActive: false } });
    ok(await saveRuleAction(ruleId, null, rule([{ kind: "add_comment", body: "reprise" }])));
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } })).createdById).toBe(carol.userId);
    ok(await deleteRuleAction(ruleId));
  });

  it("modifier une règle de projet la fait exécuter avec les droits de la personne qui l'enregistre", async () => {
    await signIn(dan);
    const ruleId = ok(await saveRuleAction(null, P, rule([{ kind: "add_comment", body: "auto" }])));
    await signIn(alice);
    ok(await setProjectMemberAction(P, dan.userId, null));
    // Inerte (Dan n'a plus accès) jusqu'à ce qu'une éditrice l'enregistre.
    ok(await saveRuleAction(ruleId, P, rule([{ kind: "add_comment", body: "reprise" }])));
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } })).createdById).toBe(alice.userId);
    const task = ok(await createTaskAction({ title: "Reprise", projectId: P }));
    expect(await prisma.comment.count({ where: { taskId: task.id } })).toBe(1);
  });

  it("le journal des exécutions ne montre que les tâches lisibles", async () => {
    // Règle d'espace d'Alice, qui voit P : elle s'exécute sur une tâche privée.
    ok(await saveRuleAction(null, null, rule([{ kind: "set_priority", priority: "HIGH" }], "TASK_CREATED")));
    const secret = ok(await createTaskAction({ title: "Secret", projectId: P }));
    const open = ok(await createTaskAction({ title: "Ouverte", projectId: W }));
    expect(await prisma.automationRun.count({ where: { taskId: secret.id } })).toBe(1);

    const forBob = await getProjectSettings(actorOf(bob), W);
    const taskIds = forBob.runs.map((r) => r.taskId);
    expect(taskIds).toContain(open.id);
    expect(taskIds).not.toContain(secret.id);
    // Alice, elle, voit les deux.
    const forAlice = await getProjectSettings(actorOf(alice), W);
    expect(forAlice.runs.map((r) => r.taskId)).toEqual(expect.arrayContaining([open.id, secret.id]));
  });

  it("une règle déclenchée par un changement ne réaffecte pas une tâche privée", async () => {
    // Bob n'a aucun accès à P : sa règle d'espace ne se déclenche pas sur ses tâches.
    await signIn(bob);
    ok(await saveRuleAction(null, null, rule([{ kind: "set_assignee", userId: bob.userId }], "PRIORITY_CHANGED")));
    await signIn(alice);
    const task = ok(await createTaskAction({ title: "Affectée à Carol", projectId: P, assigneeId: carol.userId }));
    ok(await updateTaskAction(task.id, { priority: "URGENT" }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(carol.userId);
  });
});
