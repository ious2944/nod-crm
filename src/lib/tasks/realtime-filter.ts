import "server-only";

import { prisma } from "@/lib/prisma";

import { projectAccessWhere, visibleTaskWhere, type Actor } from "./access";
import type { ChangeMessage } from "./realtime";

export interface ChangeEvent {
  kind: string;
  actorId: string | null;
  taskIds: string[];
  projectIds: string[];
  forMe: boolean;
}

/**
 * Ce qu'une personne reçoit d'un changement de son espace (flux SSE).
 *
 * Le message ne contient que des identifiants, mais l'identifiant d'une tâche
 * ou d'un projet privé — et le fait même qu'il change — ne doit pas parvenir
 * à qui ne peut pas le voir. On ne garde donc :
 *   - que les tâches que la personne peut lire, ou qui appartiennent à un
 *     projet qu'elle peut voir (une tâche supprimée ou retirée y était
 *     visible : sa vue doit se mettre à jour) ;
 *   - que les projets dont elle est propriétaire ou membre (y compris dans la
 *     corbeille, pour qu'ils disparaissent de ses listes) — même règle que
 *     `projectAccessWhere` ;
 *   - l'auteur du changement (`actorId`) seulement si c'est elle, ou si le
 *     changement porte sur un élément qu'elle voit : sinon il révélerait
 *     l'activité d'une personne hors de son périmètre.
 * Un changement qui ne concernait que des éléments invisibles n'est pas
 * transmis du tout. Un changement sans identifiant (réglages de l'espace) est
 * transmis sans auteur.
 */
export async function changeFor(actor: Actor, message: ChangeMessage): Promise<ChangeEvent | null> {
  const forMe = (message.u ?? []).includes(actor.id);
  const taskIds = message.t ?? [];
  const projectIds = message.p ?? [];
  const seenProject = projectAccessWhere(actor);

  const [tasks, projects] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({
          where: {
            workspaceId: actor.workspaceId,
            id: { in: taskIds },
            OR: [
              visibleTaskWhere(actor),
              { projects: { some: { project: seenProject } } },
              { parent: { projects: { some: { project: seenProject } } } },
            ],
          },
          select: { id: true },
        })
      : [],
    projectIds.length ? prisma.project.findMany({ where: { ...seenProject, id: { in: projectIds } }, select: { id: true } }) : [],
  ]);

  const visibleTasks = new Set(tasks.map((t) => t.id));
  const visibleProjects = new Set(projects.map((p) => p.id));
  const event: ChangeEvent = {
    kind: message.k,
    actorId: null,
    taskIds: taskIds.filter((id) => visibleTasks.has(id)),
    projectIds: projectIds.filter((id) => visibleProjects.has(id)),
    forMe,
  };
  const hadTargets = taskIds.length > 0 || projectIds.length > 0;
  const seesTarget = event.taskIds.length > 0 || event.projectIds.length > 0;
  if (hadTargets && !forMe && !seesTarget) return null;
  event.actorId = message.a === actor.id || seesTarget ? message.a : null;
  return event;
}
