import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import type { ProjectRole } from "./types";

/**
 * Contrôle d'accès du module de gestion de travail.
 *
 * Deux frontières, vérifiées **côté serveur** dans chaque lecture et chaque
 * mutation :
 *
 * 1. **L'espace (workspace)** — dérivé de la session, jamais d'une entrée
 *    client. Chaque `where` commence par `workspaceId: actor.workspaceId`.
 *
 * 2. **Le projet.** Un projet `WORKSPACE` est lisible par tout l'espace ; un
 *    projet `PRIVATE` par ses seuls membres. Écrire dans un projet demande le
 *    rôle `OWNER` ou `EDITOR` — ou, pour un projet `WORKSPACE`, de ne pas y
 *    avoir été restreint au rôle `COMMENTER`. Administrer (renommer, membres,
 *    archiver, supprimer) demande d'être propriétaire.
 *
 * Une tâche est visible si :
 *   - elle n'appartient à aucun projet (comportement historique de la V0.4 :
 *     les tâches « libres » restent partagées dans l'espace) ;
 *   - ou elle appartient à au moins un projet lisible ;
 *   - ou l'utilisateur en est responsable, créateur, collaborateur ou abonné.
 * Une sous-tâche hérite de la visibilité de sa parente (un seul niveau).
 */

export interface Actor {
  id: string;
  workspaceId: string;
}

export function readableProjectWhere(actor: Actor): Prisma.ProjectWhereInput {
  return {
    workspaceId: actor.workspaceId,
    OR: [{ visibility: "WORKSPACE" }, { members: { some: { userId: actor.id } } }],
  };
}

function ownTaskConditions(actor: Actor): Prisma.TaskWhereInput[] {
  return [
    { assigneeId: actor.id },
    { createdById: actor.id },
    { followers: { some: { userId: actor.id } } },
  ];
}

function rootVisibleWhere(actor: Actor): Prisma.TaskWhereInput {
  return {
    OR: [
      { projects: { none: {} } },
      { projects: { some: { project: readableProjectWhere(actor) } } },
      ...ownTaskConditions(actor),
    ],
  };
}

/** Filtre Prisma des tâches que l'acteur peut lire. */
export function visibleTaskWhere(actor: Actor): Prisma.TaskWhereInput {
  return {
    workspaceId: actor.workspaceId,
    OR: [
      { parentId: null, AND: [rootVisibleWhere(actor)] },
      {
        parentId: { not: null },
        OR: [...ownTaskConditions(actor), { parent: rootVisibleWhere(actor) }],
      },
    ],
  };
}

/** Les tâches des modèles de projet n'apparaissent dans aucune vue transverse. */
export const NOT_TEMPLATE_TASK: Prisma.TaskWhereInput = {
  NOT: { projects: { some: { project: { isTemplate: true } } } },
};

/** Sélection minimale pour évaluer les droits sur un projet. */
export function projectAccessSelect(actor: Actor) {
  return {
    id: true,
    visibility: true,
    archivedAt: true,
    isTemplate: true,
    ownerId: true,
    createdById: true,
    members: { where: { userId: actor.id }, select: { role: true } },
  } satisfies Prisma.ProjectSelect;
}

export interface ProjectAccessInfo {
  id: string;
  visibility: "WORKSPACE" | "PRIVATE";
  archivedAt: Date | null;
  isTemplate: boolean;
  ownerId: string | null;
  createdById: string | null;
  members: { role: ProjectRole }[];
}

export function projectRole(project: ProjectAccessInfo): ProjectRole | null {
  return project.members[0]?.role ?? null;
}

export function canReadProject(project: ProjectAccessInfo): boolean {
  return project.visibility === "WORKSPACE" || project.members.length > 0;
}

/** Modifier le contenu (tâches, sections) d'un projet. */
export function canEditProjectContent(project: ProjectAccessInfo, actor: Actor): boolean {
  if (project.archivedAt) return false;
  const role = projectRole(project);
  if (role === "OWNER" || role === "EDITOR") return true;
  if (role === "COMMENTER") return false;
  if (project.ownerId === actor.id) return true;
  return project.visibility === "WORKSPACE";
}

/** Administrer le projet : réglages, membres, archivage, suppression. */
export function canManageProject(project: ProjectAccessInfo, actor: Actor): boolean {
  const role = projectRole(project);
  return role === "OWNER" || project.ownerId === actor.id || (project.ownerId === null && project.createdById === actor.id);
}

export function taskAccessSelect(actor: Actor) {
  const rootSelect = {
    assigneeId: true,
    createdById: true,
    followers: { where: { userId: actor.id }, select: { kind: true } },
    projects: { select: { project: { select: projectAccessSelect(actor) } } },
  } satisfies Prisma.TaskSelect;

  return {
    id: true,
    workspaceId: true,
    parentId: true,
    ...rootSelect,
    parent: { select: rootSelect },
  } satisfies Prisma.TaskSelect;
}

interface TaskAccessRoot {
  assigneeId: string | null;
  createdById: string | null;
  followers: { kind: "COLLABORATOR" | "FOLLOWER" }[];
  projects: { project: ProjectAccessInfo }[];
}

export interface TaskAccessInfo extends TaskAccessRoot {
  parentId: string | null;
  parent: TaskAccessRoot | null;
}

export interface TaskPermissions {
  canRead: boolean;
  canEdit: boolean;
  canComment: boolean;
}

/**
 * Droits effectifs d'un acteur sur une tâche déjà bornée à son espace.
 *
 * - lecture : voir `visibleTaskWhere` (la même règle, évaluée en mémoire) ;
 * - écriture : la tâche est libre, ou au moins un de ses projets est
 *   modifiable par l'acteur, ou l'acteur en est responsable, créateur ou
 *   collaborateur ;
 * - commentaire : quiconque peut la lire.
 */
export function evaluateTaskAccess(task: TaskAccessInfo, actor: Actor): TaskPermissions {
  const root = task.parent ?? task;
  const involvement = (node: TaskAccessRoot) => ({
    owns: node.assigneeId === actor.id || node.createdById === actor.id,
    collaborates: node.followers.some((f) => f.kind === "COLLABORATOR"),
    follows: node.followers.length > 0,
  });
  const self = involvement(task);
  const top = involvement(root);

  const projects = root.projects.map((p) => p.project);
  const free = projects.length === 0;
  const readableProject = projects.some(canReadProject);
  const editableProject = projects.some((p) => canEditProjectContent(p, actor));

  const canRead = free || readableProject || self.owns || self.follows || top.owns || top.follows;
  const canEdit =
    canRead &&
    (free || editableProject || self.owns || self.collaborates || top.owns || top.collaborates);

  return { canRead, canEdit, canComment: canRead };
}

/** Erreur d'accès : message neutre, identique pour « absent » et « interdit ». */
export class TaskAccessError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN";
  constructor(code: "NOT_FOUND" | "FORBIDDEN" = "NOT_FOUND", message?: string) {
    super(
      message ??
        (code === "NOT_FOUND"
          ? "Élément introuvable."
          : "Vous n'avez pas les droits nécessaires pour cette action."),
    );
    this.name = "TaskAccessError";
    this.code = code;
  }
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

export class TaskVersionConflictError extends Error {
  readonly taskId: string;
  constructor(taskId: string, message = "Cette tâche a été modifiée par quelqu'un d'autre entre-temps.") {
    super(message);
    this.name = "TaskVersionConflictError";
    this.taskId = taskId;
  }
}
