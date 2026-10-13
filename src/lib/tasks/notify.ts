import "server-only";

import { prisma } from "@/lib/prisma";

import { evaluateTaskAccess, taskAccessSelect, type Actor } from "./access";
import type { NotificationType } from "./constants";
import { publishChange } from "./realtime";

/**
 * Notifications in-app.
 *
 * Trois garanties :
 * - **isolation** : un destinataire doit appartenir au même espace que la
 *   tâche *et* pouvoir la lire (projets privés compris) — sinon il ne reçoit
 *   rien, pas même le titre ;
 * - **préférences** : un type désactivé par l'utilisateur n'est pas créé ;
 * - **pas de doublon** : `dedupeKey` (unique par destinataire) rend les rappels
 *   et les règles idempotents.
 *
 * L'auteur d'une action n'est jamais notifié de sa propre action.
 *
 * E-mail : NOD CRM ne dispose aujourd'hui d'aucune infrastructure d'envoi
 * (ni SMTP ni fournisseur). Les notifications restent donc in-app ; le jour où
 * un transport existera, il se branchera ici, après le filtrage ci-dessous.
 */

export interface NotifyInput {
  workspaceId: string;
  recipients: Iterable<string | null | undefined>;
  actorId: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  commentId?: string | null;
  actionKind?: string | null;
  /** Clé d'idempotence ; combinée au destinataire. */
  dedupeKey?: string | null;
  /** Notifier aussi l'auteur (rappels générés par le système). */
  includeActor?: boolean;
}

export async function notify(input: NotifyInput): Promise<number> {
  const unique = new Set<string>();
  for (const id of input.recipients) {
    if (id && (input.includeActor || id !== input.actorId)) unique.add(id);
  }
  if (unique.size === 0) return 0;

  // Destinataires actifs du même espace uniquement.
  const users = await prisma.user.findMany({
    where: { id: { in: [...unique] }, workspaceId: input.workspaceId, isActive: true },
    select: { id: true, notificationPreferences: { where: { type: input.type }, select: { inApp: true } } },
  });

  let allowed = users.filter((u) => u.notificationPreferences[0]?.inApp !== false).map((u) => u.id);

  if (input.taskId && allowed.length) {
    const checks = await Promise.all(
      allowed.map(async (userId) => {
        const actor: Actor = { id: userId, workspaceId: input.workspaceId };
        const task = await prisma.task.findFirst({
          where: { id: input.taskId!, workspaceId: input.workspaceId },
          select: taskAccessSelect(actor),
        });
        return task && evaluateTaskAccess(task, actor).canRead ? userId : null;
      }),
    );
    allowed = checks.filter((id): id is string => id !== null);
  }

  if (input.projectId && !input.taskId && allowed.length) {
    const readers = await prisma.project.findMany({
      where: {
        id: input.projectId,
        workspaceId: input.workspaceId,
      },
      select: { visibility: true, members: { where: { userId: { in: allowed } }, select: { userId: true } } },
    });
    const project = readers[0];
    if (!project) return 0;
    if (project.visibility === "PRIVATE") {
      const memberIds = new Set(project.members.map((m) => m.userId));
      allowed = allowed.filter((id) => memberIds.has(id));
    }
  }

  if (allowed.length === 0) return 0;

  const result = await prisma.notification.createMany({
    data: allowed.map((userId) => ({
      workspaceId: input.workspaceId,
      userId,
      actorId: input.actorId,
      type: input.type,
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 500) ?? null,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      commentId: input.commentId ?? null,
      actionKind: input.actionKind ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });

  if (result.count > 0) {
    await publishChange({ w: input.workspaceId, a: input.actorId, u: allowed, k: "notification" });
  }
  return result.count;
}
