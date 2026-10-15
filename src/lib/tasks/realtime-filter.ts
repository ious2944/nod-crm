import "server-only";

import { prisma } from "@/lib/prisma";

import { visibleTaskWhere, type Actor } from "./access";
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
 *   - que les projets ouverts à l'espace ou dont elle est membre (y compris
 *     dans la corbeille, pour qu'ils disparaissent de ses listes).
 * Un changement qui ne concernait que des éléments invisibles n'est pas
 * transmis du tout. Un changement sans identifiant (réglages de l'espace) est
 * transmis tel quel.
 */
export async function changeFor(actor: Actor, message: ChangeMessage): Promise<ChangeEvent | null> {
  const forMe = (message.u ?? []).includes(actor.id);
  const taskIds = message.t ?? [];
  const projectIds = message.p ?? [];
  const seenProject = { workspaceId: actor.workspaceId, OR: [{ visibility: "WORKSPACE" as const }, { members: { some: { userId: actor.id } } }] };

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
    actorId: message.a,
    taskIds: taskIds.filter((id) => visibleTasks.has(id)),
    projectIds: projectIds.filter((id) => visibleProjects.has(id)),
    forMe,
  };
  const hadTargets = taskIds.length > 0 || projectIds.length > 0;
  if (hadTargets && !forMe && event.taskIds.length === 0 && event.projectIds.length === 0) return null;
  return event;
}
