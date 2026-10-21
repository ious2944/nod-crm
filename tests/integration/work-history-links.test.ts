import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyTaskAction } from "@/app/(app)/tasks/actions";
import {
  addDependencyAction,
  commentStatusUpdateAction,
  createProjectAction,
  createTagAction,
  createTaskAction,
  deleteCommentAction,
  duplicateTaskAction,
  editCommentAction,
  postStatusUpdateAction,
  removeDependencyAction,
  setProjectMemberAction,
  setTaskTagsAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { GET as streamGet } from "@/app/api/tasks/stream/route";
import { prisma } from "@/lib/prisma";
import { addDependency, createTask, setTaskParent, userContext } from "@/lib/tasks/service";
import { StructureBusyError } from "@/lib/tasks/structure";
import { setTestHook } from "@/lib/tasks/test-hooks";
import type { ActionResult } from "@/lib/tasks/types";
import { getTaskDetail } from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createWorkspaceWithUser, formData, resetDatabase, signIn, type TestUser, shareDirectory } from "./fixtures";
import { interleave } from "./interleave";

/**
 * Historique, commentaires, temps réel, tags et liens entre tâches
 * (revue c580137 : I2, m1, m2, m3, m4, m9).
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
const historyText = async (u: TestUser, taskId: string) => JSON.stringify((await getTaskDetail(actorOf(u), taskId)).activity);

describe("historique, commentaires, temps réel et liens", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser;
  let P: string, W: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("history-links");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    // Lot A (décision b) : les personnes du scénario partagent un projet « Équipe », donc l'annuaire.
    await shareDirectory(alice, bob, carol);
    await signIn(alice);
    P = ok(await createProjectAction({ name: "Privé", visibility: "PRIVATE" }));
    // Lot A (décision f) : plus de projet ouvert à l'espace ; W est partagé
    // avec Bob et Carol en éditeurs.
    W = ok(await createProjectAction({ name: "Partagé" }));
    ok(await setProjectMemberAction(W, bob.userId, "EDITOR"));
    ok(await setProjectMemberAction(W, carol.userId, "EDITOR"));
  });
  afterEach(() => setTestHook(null));

  it("I2 : l'historique d'une tâche publique ne révèle pas le titre d'une dépendance privée", async () => {
    const a = ok(await createTaskAction({ title: "A visible", projectId: W }));
    const b = ok(await createTaskAction({ title: "TITRE-SECRET", projectId: P }));
    ok(await addDependencyAction(a.id, b.id));
    ok(await removeDependencyAction(a.id, b.id));

    const forCarol = await historyText(carol, a.id);
    expect(forCarol).not.toContain("TITRE-SECRET");
    const detail = await getTaskDetail(actorOf(carol), a.id);
    // Les lignes restent, sans le titre.
    expect(detail.activity.filter((x) => x.kind.startsWith("dependency_"))).toHaveLength(2);
    // Alice, qui lit B, voit le titre.
    expect(await historyText(alice, a.id)).toContain("TITRE-SECRET");
  });

  it("I2 : une ancienne entrée contenant déjà un titre privé est masquée à la lecture", async () => {
    const a = ok(await createTaskAction({ title: "A visible", projectId: W }));
    // Ligne écrite par c580137 (titre en clair, sans référence).
    await prisma.taskActivity.create({
      data: { workspaceId: alice.workspaceId, taskId: a.id, actorId: alice.userId, kind: "dependency_added", field: "Bloquée par", newValue: "ANCIEN-SECRET" },
    });
    const detail = await getTaskDetail(actorOf(carol), a.id);
    expect(JSON.stringify(detail.activity)).not.toContain("ANCIEN-SECRET");
    expect(detail.activity.some((x) => x.kind === "dependency_added")).toBe(true);
  });

  it("I2 : la copie d'une tâche ne révèle pas le titre de la source à qui ne la lit pas", async () => {
    const source = ok(await createTaskAction({ title: "SOURCE-SECRETE", projectId: P }));
    const copy = ok(await duplicateTaskAction(source.id, true));
    // La copie est déplacée dans un projet public (et retirée de P).
    await prisma.taskProject.deleteMany({ where: { taskId: copy.id } });
    await prisma.taskProject.create({ data: { taskId: copy.id, projectId: W, workspaceId: alice.workspaceId, position: 1 } });
    await prisma.task.update({ where: { id: copy.id }, data: { title: "Copie renommée" } });
    expect(await historyText(carol, copy.id)).not.toContain("SOURCE-SECRETE");
  });

  it("m1 : l'auteur d'un commentaire de point d'avancement ne peut plus le modifier ni le supprimer après son retrait", async () => {
    ok(await setProjectMemberAction(P, bob.userId, "EDITOR"));
    await signIn(bob);
    const updateId = ok(await postStatusUpdateAction(P, { status: "ON_TRACK", title: "Point", body: "x" }));
    ok(await commentStatusUpdateAction(updateId, "mon commentaire"));
    const comment = await prisma.comment.findFirstOrThrow({ where: { statusUpdateId: updateId } });
    await signIn(alice);
    ok(await setProjectMemberAction(P, bob.userId, null));
    await signIn(bob);
    expect(await editCommentAction(comment.id, "modifié après retrait")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await deleteCommentAction(comment.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).body).toBe("mon commentaire");
  });

  it("m9 : une action rapide répond de la même façon pour une tâche inexistante ou inaccessible", async () => {
    const secret = ok(await createTaskAction({ title: "Secret", projectId: P }));
    await signIn(carol);
    const missing = await applyTaskAction(formData({ id: "00000000-0000-4000-8000-000000000000", intent: "reopen" })).catch((e: Error) => e.message);
    const hidden = await applyTaskAction(formData({ id: secret.id, intent: "reopen" })).catch((e: Error) => e.message);
    expect(missing).toBe("Tâche introuvable.");
    expect(hidden).toBe(missing);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: secret.id } })).completedAt).toBeNull();
  });

  it("m2 : le flux temps réel ne transmet pas les identifiants privés aux personnes sans accès", async () => {
    const secret = ok(await createTaskAction({ title: "Secret", projectId: P }));
    const open = ok(await createTaskAction({ title: "Ouverte", projectId: W }));
    await signIn(bob);
    const controller = new AbortController();
    const response = await streamGet(new Request("http://localhost/api/tasks/stream", { signal: controller.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string, ms: number) => {
      const deadline = Date.now() + ms;
      while (!text.includes(needle) && Date.now() < deadline) {
        const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value);
      }
    };
    await readUntil("ready", 3000);
    await signIn(alice);
    ok(await updateTaskAction(secret.id, { priority: "URGENT" }));
    ok(await updateTaskAction(open.id, { priority: "URGENT" }));
    await readUntil(open.id, 5000);
    controller.abort();
    expect(text).toContain(open.id);
    expect(text).not.toContain(secret.id);
    expect(text).not.toContain(P);
  });

  it("m3 : une sauvegarde tardive des tags n'efface pas un tag ajouté entre-temps", async () => {
    const a = ok(await createTagAction({ name: "a" }));
    const b = ok(await createTagAction({ name: "b" }));
    const c = ok(await createTagAction({ name: "c" }));
    const task = ok(await createTaskAction({ title: "Étiquetée", projectId: W, tagIds: [a.id] }));
    // Onglet 1 voit [a] ; onglet 2 ajoute b ; onglet 1 enregistre [a, c].
    ok(await setTaskTagsAction(task.id, [a.id, b.id], [a.id]));
    ok(await setTaskTagsAction(task.id, [a.id, c.id], [a.id]));
    const tags = await prisma.taskTag.findMany({ where: { taskId: task.id }, select: { tagId: true } });
    expect(tags.map((t) => t.tagId).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("m4 : deux dépendances inverses simultanées ne créent pas de boucle", async () => {
    const x = ok(await createTaskAction({ title: "X", projectId: W }));
    const y = ok(await createTaskAction({ title: "Y", projectId: W }));
    const ctx = userContext(actorOf(alice));
    const { first, second, secondReachedProbe } = await interleave({
      pauseAt: "addDependency:checked",
      probe: "addDependency:checked",
      first: () => addDependency(ctx, x.id, y.id),
      second: () => addDependency(ctx, y.id, x.id),
    });
    expect(first.ok).toBe(true);
    expect(!second.ok && second.error instanceof StructureBusyError).toBe(true);
    expect(secondReachedProbe).toBe(false);
    // Rejouée : la boucle est détectée.
    await expect(addDependency(ctx, y.id, x.id)).rejects.toThrow(/boucle/);
    expect(await prisma.taskDependency.count()).toBe(1);
  });

  it("m4 : une tâche qui devient sous-tâche pendant qu'on lui ajoute une sous-tâche : jamais deux niveaux", async () => {
    const parent = ok(await createTaskAction({ title: "Future parente", projectId: W }));
    const task = ok(await createTaskAction({ title: "Future sous-tâche", projectId: W }));
    const ctx = userContext(actorOf(alice));
    const { first, second } = await interleave({
      pauseAt: "setTaskParent:checked",
      probe: "createTask:checked",
      first: () => setTaskParent(ctx, task.id, parent.id),
      second: () => createTask(ctx, { title: "Petite-fille", parentId: task.id }),
    });
    expect(first.ok).toBe(true);
    expect(!second.ok && second.error instanceof StructureBusyError).toBe(true);
    await expect(createTask(ctx, { title: "Petite-fille", parentId: task.id })).rejects.toThrow(/sous-tâche/);
    const nested = await prisma.task.count({ where: { parent: { parentId: { not: null } } } });
    expect(nested).toBe(0);
  });
});
