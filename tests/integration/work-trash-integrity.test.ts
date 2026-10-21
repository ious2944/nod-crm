import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addTaskToProjectAction,
  createProjectAction,
  createTaskAction,
  deleteProjectAction,
  deleteTaskAction,
  previewProjectPurgeAction,
  purgeProjectAction,
  purgeTaskAction,
  removeTaskFromProjectAction,
  restoreProjectAction,
  restoreTaskAction,
  setProjectMemberAction,
  setTaskParentAction,
} from "@/app/(app)/tasks/work-actions";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";
import { deleteProject } from "@/lib/tasks/project-service";
import { createTask, moveTask, purgeTask, removeTaskFromProject, restoreTask, userContext } from "@/lib/tasks/service";
import { StructureBusyError } from "@/lib/tasks/structure";
import { setTestHook } from "@/lib/tasks/test-hooks";
import type { ActionResult } from "@/lib/tasks/types";
import { getTaskDetail } from "@/lib/tasks/work-queries";

import { addUserToWorkspace, createWorkspaceWithUser, resetDatabase, signIn, type TestUser, shareDirectory } from "./fixtures";
import { interleave } from "./interleave";

/**
 * Retraits, suppressions et purges : une tâche ne devient jamais « libre »
 * (visible de tout l'espace) par effet de bord (revue c580137 : B2, I4,
 * hypothèse « purge et restauration simultanées »).
 */

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}
const actorOf = (u: TestUser) => ({ id: u.userId, workspaceId: u.workspaceId });
/** Refus « opération en cours » : le verrou de structure était déjà tenu. */
const busy = (r: { ok: boolean; error?: unknown }) => !r.ok && r.error instanceof StructureBusyError;
const readable = (u: TestUser, id: string) => getTaskDetail(actorOf(u), id).then(() => true, () => false);

/** Aucune tâche active dont tous les projets sont dans la corbeille ; aucune tâche devenue libre. */
async function assertNoExposedTask(ids: string[], outsider: TestUser) {
  for (const id of ids) {
    const row = await prisma.task.findUnique({
      where: { id },
      include: { projects: { include: { project: { include: { members: { select: { userId: true } } } } } } },
    });
    if (!row || row.deletedAt) continue;
    const active = row.projects.filter((m) => !m.project.deletedAt);
    expect({ id, onlyTrashed: row.projects.length > 0 && active.length === 0 }).toEqual({ id, onlyTrashed: false });
    if (row.projects.length === 0 && !row.parentId) throw new Error(`La tâche ${id} est devenue libre.`);
    // Lot A : seuls le propriétaire et les membres d'un projet actif la lisent.
    const insider = active.some((m) => m.project.ownerId === outsider.userId || m.project.members.some((x) => x.userId === outsider.userId));
    if (!insider) expect(await readable(outsider, id)).toBe(false);
  }
}

describe("retraits, suppressions et purges sans élargissement de visibilité", () => {
  let alice: TestUser, bob: TestUser, carol: TestUser;
  let P: string, Q: string;

  const upload = async (taskId: string) => {
    const body = new FormData();
    body.append("file", new File([new TextEncoder().encode("pièce")], "piece.txt"));
    const response = await attachmentPost(
      new Request(`http://localhost/api/tasks/items/${taskId}/attachments`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(201);
  };

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("trash-integrity");
    bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    carol = await addUserToWorkspace(alice.workspaceId, "Carol");
    // Lot A (décision b) : les personnes du scénario partagent un projet « Équipe », donc l'annuaire.
    await shareDirectory(alice, bob, carol);
    await signIn(alice);
    P = ok(await createProjectAction({ name: "Privé", visibility: "PRIVATE" }));
    // Lot A (décision f) : plus de projet ouvert à l'espace ; Q est partagé
    // avec Bob et Carol en éditeurs (ce qu'ils avaient sur un projet « espace »).
    Q = ok(await createProjectAction({ name: "Partagé" }));
    ok(await setProjectMemberAction(Q, bob.userId, "EDITOR"));
    ok(await setProjectMemberAction(Q, carol.userId, "EDITOR"));
  });
  afterEach(() => setTestHook(null));

  it("B2 : retrait du dernier projet actif puis purge du projet privé — jamais libre", async () => {
    const t = ok(await createTaskAction({ title: "Secret partagé", projectId: P }));
    ok(await addTaskToProjectAction(t.id, Q, null));
    expect(await readable(carol, t.id)).toBe(true); // via Q, public
    ok(await deleteProjectAction(P));
    // Q est son dernier projet actif ; l'autre est dans la corbeille : refusé.
    expect(await removeTaskFromProjectAction(t.id, Q)).toMatchObject({ ok: false, code: "VALIDATION" });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { projects: true } });
    expect(row.deletedAt).toBeNull();
    expect(row.projects.map((m) => m.projectId).sort()).toEqual([P, Q].sort());

    const preview = ok(await previewProjectPurgeAction(P));
    expect(preview).toMatchObject({ purgedTasks: 0, keptTasks: 1 });
    const result = ok(await purgeProjectAction(P, preview.token));
    expect(result).toMatchObject({ status: "purged", purgedTasks: 0, keptTasks: 1 });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { projects: true } });
    expect(after.projects.map((m) => m.projectId)).toEqual([Q]);
    await assertNoExposedTask([t.id], carol);
  });

  it("B2 : après le refus, la restauration du projet retrouve la tâche dans ses deux projets", async () => {
    const t = ok(await createTaskAction({ title: "Partagée", projectId: P }));
    ok(await addTaskToProjectAction(t.id, Q, null));
    ok(await deleteProjectAction(P));
    expect((await removeTaskFromProjectAction(t.id, Q)).ok).toBe(false);
    ok(await restoreProjectAction(P));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { projects: true } });
    expect(row.deletedAt).toBeNull();
    expect(row.projects.map((m) => m.projectId).sort()).toEqual([P, Q].sort());
    // P restauré : la tâche peut maintenant quitter Q sans s'ouvrir à l'espace.
    ok(await removeTaskFromProjectAction(t.id, Q));
    expect(await readable(carol, t.id)).toBe(false);
  });

  it("retirer une tâche de son seul projet : refusé si, libre, elle s'ouvrait à quelqu'un ; sinon elle devient libre", async () => {
    // Lot A : une tâche libre n'est visible que de son créateur, de son
    // responsable et de ses collaborateurs. Bob, responsable mais non membre
    // de P, ne la voit pas aujourd'hui : la retirer de P la lui ouvrirait.
    const priv = ok(await createTaskAction({ title: "Privée", projectId: P, assigneeId: bob.userId }));
    expect(await readable(bob, priv.id)).toBe(false);
    expect(await removeTaskFromProjectAction(priv.id, P)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await readable(bob, priv.id)).toBe(false);

    // Sans personne à qui l'ouvrir, le retrait passe : elle devient libre,
    // visible de sa seule créatrice (elle sort de la vue des membres de Q).
    const shared = ok(await createTaskAction({ title: "Partagée", projectId: Q }));
    expect(await readable(carol, shared.id)).toBe(true);
    ok(await removeTaskFromProjectAction(shared.id, Q));
    expect(await readable(alice, shared.id)).toBe(true);
    expect(await readable(carol, shared.id)).toBe(false);
  });

  it("une sous-tâche convertie en tâche garde les projets de sa parente", async () => {
    const parent = ok(await createTaskAction({ title: "Parente privée", projectId: P }));
    const sub = ok(await createTaskAction({ title: "Sous-tâche", parentId: parent.id }));
    expect(await readable(carol, sub.id)).toBe(false);
    ok(await setTaskParentAction(sub.id, null));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: sub.id }, include: { projects: true } });
    expect(row.parentId).toBeNull();
    expect(row.projects.map((m) => m.projectId)).toEqual([P]);
    expect(await readable(carol, sub.id)).toBe(false);
  });

  it("devenir sous-tâche ne doit pas ouvrir une tâche privée à d'autres personnes", async () => {
    const priv = ok(await createTaskAction({ title: "Privée", projectId: P }));
    const publicParent = ok(await createTaskAction({ title: "Parente publique", projectId: Q }));
    expect(await setTaskParentAction(priv.id, publicParent.id)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await readable(carol, priv.id)).toBe(false);
    // Même projet privé : autorisé, la visibilité ne change pas.
    const privateParent = ok(await createTaskAction({ title: "Parente privée", projectId: P }));
    ok(await setTaskParentAction(priv.id, privateParent.id));
    expect(await readable(carol, priv.id)).toBe(false);
    // Une tâche publique peut devenir sous-tâche d'une tâche privée (elle se restreint).
    const pub = ok(await createTaskAction({ title: "Publique", projectId: Q }));
    ok(await setTaskParentAction(pub.id, privateParent.id));
    expect(await readable(carol, pub.id)).toBe(false);
  });

  it("I4 : purger une tâche exige d'être propriétaire de tous ses projets, corbeille comprise", async () => {
    await signIn(bob);
    const R = ok(await createProjectAction({ name: "R de Bob" }));
    const t = ok(await createTaskAction({ title: "Partagée", projectId: R }));
    ok(await setProjectMemberAction(R, alice.userId, "EDITOR"));
    await signIn(alice);
    ok(await addTaskToProjectAction(t.id, Q, null));
    await signIn(bob);
    ok(await deleteProjectAction(R));
    await signIn(alice);
    ok(await deleteTaskAction(t.id));
    expect(await purgeTaskAction(t.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await prisma.task.findUnique({ where: { id: t.id } })).not.toBeNull();

    // Bob restaure R : la tâche existe toujours (dans la corbeille des tâches).
    await signIn(bob);
    ok(await restoreProjectAction(R));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { projects: true } });
    expect(row.projects.map((m) => m.projectId).sort()).toEqual([Q, R].sort());
    ok(await restoreTaskAction(t.id));
  });

  it("données héritées : une tâche active liée seulement à un projet de la corbeille reste protégée et l'aperçu correspond au résultat", async () => {
    // État que pouvait produire c580137 (retrait sans contrôle) : simulé en base.
    const t = ok(await createTaskAction({ title: "Héritée", projectId: P, assigneeId: bob.userId }));
    const kept = ok(await createTaskAction({ title: "Encore dans Q", projectId: P }));
    ok(await addTaskToProjectAction(kept.id, Q, null));
    await prisma.project.update({ where: { id: P }, data: { deletedAt: new Date(), deletedById: alice.userId } });
    expect(await readable(carol, t.id)).toBe(false);
    expect(await readable(bob, t.id)).toBe(false);

    const preview = ok(await previewProjectPurgeAction(P));
    expect(preview).toMatchObject({ purgedTasks: 1, keptTasks: 1 });
    const result = ok(await purgeProjectAction(P, preview.token));
    expect(result).toMatchObject({ status: "purged", purgedTasks: preview.purgedTasks, keptTasks: preview.keptTasks });
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await readable(carol, kept.id)).toBe(true);
    await assertNoExposedTask([t.id, kept.id], carol);
  });

  // ─── Entrelacements contrôlés ───────────────────────────────────────────────
  //
  // Le verrou de structure est pris sans attendre : pendant que la première
  // opération le détient, la seconde est refusée (« opération en cours »)
  // sans rien écrire. On la rejoue ensuite : elle décide alors sur l'état réel.

  it("suppressions simultanées de deux projets partageant une tâche : elle part à la corbeille", async () => {
    const t = ok(await createTaskAction({ title: "Partagée", projectId: P }));
    ok(await addTaskToProjectAction(t.id, Q, null));
    const ctx = actorOf(alice);
    const { first, second, secondReachedProbe } = await interleave({
      pauseAt: "deleteProject:scanned",
      probe: "deleteProject:scanned",
      first: () => deleteProject(ctx, P),
      second: () => deleteProject(ctx, Q),
    });
    expect(first.ok).toBe(true);
    expect(busy(second)).toBe(true);
    expect(secondReachedProbe).toBe(false);
    // Rien n'a été écrit par la tentative refusée.
    expect((await prisma.project.findUniqueOrThrow({ where: { id: Q } })).deletedAt).toBeNull();
    await deleteProject(ctx, Q);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedWithProjectId).toBe(Q);
    await assertNoExposedTask([t.id], carol);
  });

  it("retrait concurrent d'une suppression de projet : la tâche ne reste pas exposée", async () => {
    const t = ok(await createTaskAction({ title: "Partagée", projectId: P }));
    ok(await addTaskToProjectAction(t.id, Q, null));
    const ctx = actorOf(alice);
    const { first, second, secondReachedProbe } = await interleave({
      pauseAt: "deleteProject:scanned",
      probe: "removeTaskFromProject:checked",
      first: () => deleteProject(ctx, P),
      second: () => removeTaskFromProject(userContext(ctx), t.id, Q),
    });
    expect(first.ok).toBe(true);
    expect(busy(second)).toBe(true);
    expect(secondReachedProbe).toBe(false);
    // Rejoué après la suppression : Q serait le dernier projet actif, refusé.
    await expect(removeTaskFromProject(userContext(ctx), t.id, Q)).rejects.toThrow(/corbeille/);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { projects: true } });
    expect(row.projects.map((m) => m.projectId).sort()).toEqual([P, Q].sort());
    await assertNoExposedTask([t.id], carol);
    const preview = ok(await previewProjectPurgeAction(P));
    ok(await purgeProjectAction(P, preview.token));
    await assertNoExposedTask([t.id], carol);
  });

  it("création dans un projet en cours de suppression : refusée", async () => {
    const ctx = actorOf(alice);
    const { first, second } = await interleave({
      pauseAt: "deleteProject:scanned",
      probe: "createTask:checked",
      first: () => deleteProject(ctx, P),
      second: () => createTask(userContext(ctx), { title: "Tardive", projectId: P }),
    });
    expect(first.ok).toBe(true);
    expect(busy(second)).toBe(true);
    await expect(createTask(userContext(ctx), { title: "Tardive", projectId: P })).rejects.toThrow("Projet introuvable.");
    const late = await prisma.task.findMany({ where: { title: "Tardive" }, select: { id: true } });
    expect(late).toEqual([]);
  });

  it("rattachement à un projet en cours de suppression : refusé", async () => {
    const t = ok(await createTaskAction({ title: "À rattacher", projectId: Q }));
    const ctx = actorOf(alice);
    const { first, second } = await interleave({
      pauseAt: "deleteProject:scanned",
      probe: "never",
      first: () => deleteProject(ctx, P),
      second: () => moveTask(userContext(ctx), { taskId: t.id, projectId: P, sectionId: null }),
    });
    expect(first.ok).toBe(true);
    expect(busy(second)).toBe(true);
    await expect(moveTask(userContext(ctx), { taskId: t.id, projectId: P, sectionId: null })).rejects.toThrow("Projet introuvable.");
    expect((await prisma.taskProject.findMany({ where: { taskId: t.id } })).map((m) => m.projectId)).toEqual([Q]);
  });

  it("purge et restauration simultanées d'une tâche : jamais de tâche restaurée sans ses fichiers", async () => {
    const t = ok(await createTaskAction({ title: "Avec fichier", projectId: Q }));
    await upload(t.id);
    const { storageKey } = await prisma.taskAttachment.findFirstOrThrow({ where: { taskId: t.id } });
    ok(await deleteTaskAction(t.id));
    const ctx = userContext(actorOf(alice));
    const { first, second } = await interleave({
      pauseAt: "purgeTask:scanned",
      probe: "restoreTask:checked",
      first: () => purgeTask(ctx, t.id),
      second: () => restoreTask(ctx, t.id),
    });
    expect(first.ok).toBe(true);
    expect(busy(second)).toBe(true);
    // Rejouée après la purge : la tâche n'existe plus.
    await expect(restoreTask(ctx, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
    // L'inverse : restauration d'abord, la purge refusée puis rejouée ne trouve plus rien à purger.
    const u = ok(await createTaskAction({ title: "Avec fichier 2", projectId: Q }));
    await upload(u.id);
    const { storageKey: key2 } = await prisma.taskAttachment.findFirstOrThrow({ where: { taskId: u.id } });
    ok(await deleteTaskAction(u.id));
    const reverse = await interleave({
      pauseAt: "restoreTask:checked",
      probe: "purgeTask:scanned",
      first: () => restoreTask(ctx, u.id),
      second: () => purgeTask(ctx, u.id),
    });
    expect(reverse.first.ok).toBe(true);
    expect(busy(reverse.second)).toBe(true);
    await expect(purgeTask(ctx, u.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toBeNull();
    expect(await objectStore.read(key2)).not.toBeNull();
    void storageKey;
  });
});
