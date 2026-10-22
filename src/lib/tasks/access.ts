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
 * 2. **Le projet** (permissions V1, lot A — privé par défaut). Un projet est
 *    lisible par son propriétaire (`ownerId`, ou `createdById` s'il n'a plus
 *    de propriétaire) et par ses membres (`ProjectMember`), **par personne
 *    d'autre** : la visibilité `WORKSPACE` n'ouvre plus rien (la valeur reste
 *    dans l'enum, elle est refusée à l'écriture). Écrire dans un projet
 *    demande d'en être propriétaire ou membre `OWNER` / `EDITOR` ;
 *    administrer (renommer, membres, archiver, supprimer), d'en être
 *    propriétaire.
 *
 * Une tâche **racine** est visible si elle n'est pas dans la corbeille, si
 * tous ses projets ne sont pas dans la corbeille, et :
 *   - elle appartient à au moins un projet lisible ;
 *   - ou elle n'appartient à aucun projet (tâche « libre ») et l'utilisateur
 *     en est créateur, responsable ou collaborateur.
 * Être abonné (`FOLLOWER`) ne donne aucun accès ; être responsable d'une
 * tâche d'un projet qu'on ne lit pas non plus. Une **sous-tâche** suit sa
 * tâche racine, et seulement elle : elle n'est jamais lisible par un autre
 * chemin (même pas par son propre responsable).
 *
 * Droits sur une tâche visible (`evaluateTaskAccess`) :
 *   - lire et commenter : toute personne qui la voit ;
 *   - modifier ses champs : un éditeur d'un de ses projets, ou son
 *     responsable / créateur / collaborateur (règle inchangée ; la règle du
 *     responsable en Lecture est au lot B) ;
 *   - gérer (supprimer, dupliquer, rattacher à un autre projet, changer de
 *     parente, réaffecter, partager avec d'autres personnes) : un éditeur
 *     d'un de ses projets — ou, pour une tâche libre, quiconque la voit.
 */

export interface Actor {
  id: string;
  workspaceId: string;
}

/** Projets dont l'acteur est propriétaire ou membre, corbeille comprise (même règle que `isProjectOwner` / `canReadProject`). */
export function projectAccessWhere(actor: Actor): Prisma.ProjectWhereInput {
  return {
    workspaceId: actor.workspaceId,
    OR: [
      { ownerId: actor.id },
      { ownerId: null, createdById: actor.id },
      { members: { some: { userId: actor.id } } },
    ],
  };
}

export function readableProjectWhere(actor: Actor): Prisma.ProjectWhereInput {
  return {
    // Un projet de la corbeille n'est lisible par personne (voir `evaluateProjectTrashAccess`).
    deletedAt: null,
    AND: [projectAccessWhere(actor)],
  };
}

/**
 * Annuaire de l'acteur (décision b) : lui-même, et les personnes avec qui il
 * partage un projet lisible (propriétaire ou membre). Aucune autre personne de
 * l'espace n'est listée, proposée dans un sélecteur ni acceptée comme
 * responsable ou collaborateur.
 */
export function directoryUserWhere(actor: Actor): Prisma.UserWhereInput {
  return {
    workspaceId: actor.workspaceId,
    OR: [
      { id: actor.id },
      { projectMemberships: { some: { project: readableProjectWhere(actor) } } },
      { ownedProjects: { some: readableProjectWhere(actor) } },
    ],
  };
}

/** Voies d'accès personnelles à une tâche **libre** : créateur, responsable, collaborateur (jamais abonné). */
function ownTaskConditions(actor: Actor): Prisma.TaskWhereInput[] {
  return [
    { assigneeId: actor.id },
    { createdById: actor.id },
    { followers: { some: { userId: actor.id, kind: "COLLABORATOR" } } },
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
          { projects: { some: { project: readableProjectWhere(actor) } } },
          { projects: { none: {} }, OR: ownTaskConditions(actor) },
        ],
      },
    ],
  };
}

/** Filtre Prisma des tâches que l'acteur peut lire. Une sous-tâche ne l'est que par sa racine. */
export function visibleTaskWhere(actor: Actor): Prisma.TaskWhereInput {
  return {
    workspaceId: actor.workspaceId,
    deletedAt: null,
    OR: [
      { parentId: null, AND: [rootVisibleWhere(actor)] },
      { parentId: { not: null }, parent: rootVisibleWhere(actor) },
    ],
  };
}

/**
 * Notifications que l'acteur voit : les siennes, sur une tâche qu'il lit ou un
 * projet qu'il lit (ou sans cible). Une notification ne survit pas à la perte
 * d'accès — tâche à la corbeille, retirée du projet, projet devenu privé : elle
 * est masquée (liste ET compteur), pas supprimée, et sa copie figée (titre,
 * corps) ne s'affiche plus.
 */
export function readableNotificationWhere(actor: Actor): Prisma.NotificationWhereInput {
  return {
    userId: actor.id,
    workspaceId: actor.workspaceId,
    OR: [
      { taskId: null, projectId: null },
      { taskId: { not: null }, task: visibleTaskWhere(actor) },
      { taskId: null, projectId: { not: null }, project: readableProjectWhere(actor) },
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

/**
 * Lire le projet : propriétaire ou membre. `members` n'est chargé que pour
 * l'acteur (`projectAccessSelect`) : un membre quelconque, c'est lui.
 */
export function canReadProject(project: ProjectAccessInfo, actor: Actor): boolean {
  if (project.deletedAt) return false;
  return project.members.length > 0 || isProjectOwner(project, actor);
}

/** Modifier le contenu (tâches, sections) d'un projet. */
export function canEditProjectContent(project: ProjectAccessInfo, actor: Actor): boolean {
  if (project.archivedAt || project.deletedAt) return false;
  const role = projectRole(project);
  if (role === "OWNER" || role === "EDITOR") return true;
  if (role === "COMMENTER") return false;
  return isProjectOwner(project, actor);
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
  const readableProject = projects.some((p) => canReadProject(p, actor));
  const editableProject = projects.some((p) => canEditProjectContent(p, actor));

  const deleted = Boolean(task.deletedAt || task.parent?.deletedAt);
  // Lecture par la racine seulement : projet lisible, ou tâche libre dont
  // l'acteur est créateur, responsable ou collaborateur (jamais abonné).
  const canRead = !deleted && !onlyInTrash && (readableProject || (free && (top.owns || top.collaborates)));
  const canEdit =
    canRead &&
    (free || editableProject || self.owns || self.collaborates || top.owns || top.collaborates);
  const canManage = canRead && (free || editableProject);

  return { canRead, canEdit, canComment: canRead, canManage };
}

/**
 * Périmètre d'une règle d'automatisation (lot A) : elle n'agit, avec les
 * droits de son auteur, que sur ses propres données — une tâche libre dont il
 * est créateur, responsable ou collaborateur — et sur les tâches d'un projet
 * où il a l'Édition. Être responsable d'une tâche d'un projet en Lecture ne
 * suffit pas (contrairement à la modification manuelle de ses champs).
 */
export function canAutomateTask(task: TaskAccessInfo, actor: Actor): boolean {
  if (!evaluateTaskAccess(task, actor).canRead) return false;
  const root = task.parent ?? task;
  if (root.projects.length === 0) return true;
  return root.projects.some((p) => !p.project.deletedAt && canEditProjectContent(p.project, actor));
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
    // Tâche libre : seulement les personnes qui la voyaient (racine : créateur,
    // responsable, collaborateur) ou qui l'ont supprimée.
    const involved =
      root.assigneeId === actor.id ||
      root.createdById === actor.id ||
      root.followers.some((f) => f.kind === "COLLABORATOR") ||
      task.deletedById === actor.id;
    return { canRestore: involved, canPurge: task.createdById === actor.id || task.deletedById === actor.id };
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
