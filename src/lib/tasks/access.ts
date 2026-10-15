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
 * Une tâche est visible si elle n'est pas dans la corbeille, si tous ses
 * projets ne sont pas dans la corbeille, et :
 *   - elle n'appartient à aucun projet (comportement historique de la V0.4 :
 *     les tâches « libres » restent partagées dans l'espace) ;
 *   - ou elle appartient à au moins un projet lisible ;
 *   - ou l'utilisateur en est responsable, créateur, collaborateur ou abonné.
 * Une sous-tâche est visible si elle l'est elle-même à ce titre, ou si sa
 * parente l'est (un seul niveau). La réciproque est fausse : le responsable
 * d'une sous-tâche ne voit pas la parente pour autant.
 *
 * Cette visibilité « par implication » ne s'étend jamais au-delà de la tâche :
 * le responsable d'une tâche d'un projet privé n'en voit ni les autres tâches,
 * ni les sections, ni le nom du projet (voir `serialize.ts`).
 *
 * Droits sur une tâche visible (`evaluateTaskAccess`) :
 *   - lire et commenter : toute personne qui la voit ;
 *   - modifier ses champs : un éditeur d'un de ses projets, ou son
 *     responsable / créateur / collaborateur (même commentateur ou non membre) ;
 *   - gérer (supprimer, dupliquer, rattacher à un autre projet, changer de
 *     parente, réaffecter, partager avec d'autres personnes) : un éditeur
 *     d'un de ses projets — ou, pour une tâche libre, tout l'espace.
 *     Un responsable non membre ne peut donc pas faire sortir la tâche de son
 *     projet privé ni y donner accès à quelqu'un d'autre.
 */

export interface Actor {
  id: string;
  workspaceId: string;
}

export function readableProjectWhere(actor: Actor): Prisma.ProjectWhereInput {
  return {
    workspaceId: actor.workspaceId,
    // Un projet de la corbeille n'est lisible par personne (voir `evaluateProjectTrashAccess`).
    deletedAt: null,
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

/**
 * Une tâche dont **tous** les projets sont dans la corbeille n'est visible de
 * personne, pas même de son responsable : elle suit ses projets et réapparaît
 * à leur restauration. (Ce cas ne se produit plus — un retrait ou une
 * suppression la fait passer à la corbeille avec eux —, mais des données
 * antérieures peuvent le contenir.)
 */
const NOT_ONLY_IN_TRASH: Prisma.TaskWhereInput = {
  OR: [{ projects: { none: {} } }, { projects: { some: { project: { deletedAt: null } } } }],
};

function rootVisibleWhere(actor: Actor): Prisma.TaskWhereInput {
  return {
    deletedAt: null,
    AND: [
      NOT_ONLY_IN_TRASH,
      {
        OR: [
          { projects: { none: {} } },
          { projects: { some: { project: readableProjectWhere(actor) } } },
          ...ownTaskConditions(actor),
        ],
      },
    ],
  };
}

/** Filtre Prisma des tâches que l'acteur peut lire. */
export function visibleTaskWhere(actor: Actor): Prisma.TaskWhereInput {
  return {
    workspaceId: actor.workspaceId,
    deletedAt: null,
    OR: [
      { parentId: null, AND: [rootVisibleWhere(actor)] },
      {
        parentId: { not: null },
        parent: { deletedAt: null, AND: [NOT_ONLY_IN_TRASH] },
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
    deletedAt: true,
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
  deletedAt?: Date | null;
  members: { role: ProjectRole }[];
}

export function projectRole(project: ProjectAccessInfo): ProjectRole | null {
  return project.members[0]?.role ?? null;
}

export function canReadProject(project: ProjectAccessInfo): boolean {
  if (project.deletedAt) return false;
  return project.visibility === "WORKSPACE" || project.members.length > 0;
}

/** Modifier le contenu (tâches, sections) d'un projet. */
export function canEditProjectContent(project: ProjectAccessInfo, actor: Actor): boolean {
  if (project.archivedAt || project.deletedAt) return false;
  const role = projectRole(project);
  if (role === "OWNER" || role === "EDITOR") return true;
  if (role === "COMMENTER") return false;
  if (project.ownerId === actor.id) return true;
  return project.visibility === "WORKSPACE";
}

/** Administrer le projet : réglages, membres, archivage, suppression. */
export function canManageProject(project: ProjectAccessInfo, actor: Actor): boolean {
  if (project.deletedAt) return false;
  return isProjectOwner(project, actor);
}

/** Propriétaire du projet, qu'il soit actif ou dans la corbeille. */
export function isProjectOwner(project: ProjectAccessInfo, actor: Actor): boolean {
  const role = projectRole(project);
  return role === "OWNER" || project.ownerId === actor.id || (project.ownerId === null && project.createdById === actor.id);
}

/**
 * Corbeille des projets : seul le propriétaire voit un projet supprimé, le
 * restaure ou le supprime définitivement. Ses tâches restent inaccessibles à
 * tous tant qu'il n'est pas restauré.
 */
export function evaluateProjectTrashAccess(project: ProjectAccessInfo, actor: Actor): { canRestore: boolean; canPurge: boolean } {
  const owner = Boolean(project.deletedAt) && isProjectOwner(project, actor);
  return { canRestore: owner, canPurge: owner };
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
    deletedAt: true,
    ...rootSelect,
    parent: { select: { ...rootSelect, deletedAt: true } },
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
  deletedAt?: Date | null;
  parent: (TaskAccessRoot & { deletedAt?: Date | null }) | null;
}

export interface TaskPermissions {
  canRead: boolean;
  canEdit: boolean;
  canComment: boolean;
  /** Structure et partage : supprimer, dupliquer, déplacer, réaffecter, abonner d'autres personnes. */
  canManage: boolean;
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

  const all = root.projects.map((p) => p.project);
  // Les appartenances à un projet de la corbeille sont conservées (pour la
  // restauration) mais ne donnent aucun droit ; elles ne rendent pas non plus
  // la tâche « libre ».
  const projects = all.filter((p) => !p.deletedAt);
  const free = all.length === 0;
  const onlyInTrash = all.length > 0 && projects.length === 0;
  const readableProject = projects.some(canReadProject);
  const editableProject = projects.some((p) => canEditProjectContent(p, actor));

  const deleted = Boolean(task.deletedAt || task.parent?.deletedAt);
  const canRead =
    !deleted && !onlyInTrash && (free || readableProject || self.owns || self.follows || top.owns || top.follows);
  const canEdit =
    canRead &&
    (free || editableProject || self.owns || self.collaborates || top.owns || top.collaborates);
  const canManage = canRead && (free || editableProject);

  return { canRead, canEdit, canComment: canRead, canManage };
}

/**
 * Droits sur une tâche **dans la corbeille** : la voir et la restaurer
 * demandent de pouvoir la gérer (comme pour la supprimer). La suppression
 * définitive demande d'être propriétaire de **tous** ses projets, y compris
 * ceux qui sont eux-mêmes dans la corbeille : leur propriétaire doit la
 * retrouver s'il les restaure. Pour une tâche libre, il faut en être le
 * créateur ou la personne qui l'a supprimée.
 */
export function evaluateTrashAccess(
  task: TaskAccessInfo & { createdById: string | null; deletedById: string | null; deletedWithProjectId?: string | null },
  actor: Actor,
): { canRestore: boolean; canPurge: boolean } {
  // Mise à la corbeille avec son projet : elle se restaure avec lui.
  if (task.deletedWithProjectId) return { canRestore: false, canPurge: false };
  const root = task.parent ?? task;
  const all = root.projects.map((p) => p.project);
  const projects = all.filter((p) => !p.deletedAt);
  // Tous ses projets sont dans la corbeille : elle n'est pas « libre » pour
  // autant (ce serait l'ouvrir à tout l'espace) — on attend la restauration
  // d'un projet.
  if (all.length > 0 && projects.length === 0) return { canRestore: false, canPurge: false };
  if (projects.length === 0) {
    return { canRestore: true, canPurge: task.createdById === actor.id || task.deletedById === actor.id };
  }
  return {
    canRestore: projects.some((p) => canEditProjectContent(p, actor)),
    canPurge: all.every((p) => (p.deletedAt ? isProjectOwner(p, actor) : canManageProject(p, actor))),
  };
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
