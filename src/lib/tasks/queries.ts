import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import type { TaskBucket } from "./domain";
import type { TaskFilter } from "./filters";
import { toTaskView, type TaskView } from "./view";

/**
 * Lectures du module Tâches.
 *
 * Invariant unique et non négociable : **le workspace vient de la session**,
 * jamais d'un paramètre. Aucune fonction de ce fichier n'accepte de
 * `workspaceId` — il n'existe donc pas de chemin par lequel une tâche d'un
 * autre espace pourrait être lue, même par erreur de programmation.
 */

const TASK_INCLUDE = {
  contact: {
    // `archivedAt` sert à afficher « archivé » : une tâche ne doit pas perdre
    // silencieusement le contact qui lui donne son contexte.
    select: { id: true, firstName: true, lastName: true, archivedAt: true },
  },
  followUp: {
    select: {
      id: true,
      title: true,
      contact: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

/** Une section de la page Tâches : en retard, aujourd'hui, à venir. */
export interface TaskSection {
  bucket: Exclude<TaskBucket, "completed">;
  label: string;
  items: TaskView[];
}

export interface TaskList {
  /** Nombre de tâches à faire, tous horizons confondus. */
  todoCount: number;
  /** Nombre de tâches terminées — sert seulement à proposer l'onglet. */
  completedCount: number;
  sections: TaskSection[];
  /** Rempli uniquement par le filtre « Terminées ». */
  completed: TaskView[];
}

const SECTION_LABELS: Record<Exclude<TaskBucket, "completed">, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  upcoming: "À venir",
};

/** Les 100 dernières tâches terminées : de quoi les retrouver, pas une GED. */
const COMPLETED_LIMIT = 100;

export async function getTaskList(filter: TaskFilter): Promise<TaskList> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();

  const [todoRecords, completedCount] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId, completedAt: null },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      include: TASK_INCLUDE,
    }),
    prisma.task.count({ where: { workspaceId, completedAt: { not: null } } }),
  ]);

  const todo = todoRecords.map((record) => toTaskView(record, now, APP_TIME_ZONE));

  const sections: TaskSection[] = (["overdue", "today", "upcoming"] as const)
    .map((bucket) => ({
      bucket,
      label: SECTION_LABELS[bucket],
      items: todo.filter((item) => item.bucket === bucket),
    }))
    .filter((section) => section.items.length > 0);

  if (filter !== "done") {
    return { todoCount: todo.length, completedCount, sections, completed: [] };
  }

  const completedRecords = await prisma.task.findMany({
    where: { workspaceId, completedAt: { not: null } },
    orderBy: [{ completedAt: "desc" }],
    take: COMPLETED_LIMIT,
    include: TASK_INCLUDE,
  });

  return {
    todoCount: todo.length,
    completedCount,
    sections: [],
    completed: completedRecords.map((record) => toTaskView(record, now, APP_TIME_ZONE)),
  };
}

/**
 * Tâches actionnables aujourd'hui, pour le cockpit.
 *
 * Définition exacte du feed : `completed_at IS NULL` **et** échéance au plus
 * tard aujourd'hui. Le filtre est posé sur la fin du jour courant *dans le
 * fuseau de l'application* (`APP_TIME_ZONE`), pas sur `new Date()` : sans cela,
 * une tâche due aujourd'hui à minuit local disparaîtrait du feed dès 00 h 01
 * pour un serveur en UTC.
 */
export async function getActionableTasks(endOfToday: Date): Promise<TaskView[]> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();

  const records = await prisma.task.findMany({
    where: { workspaceId, completedAt: null, dueAt: { lte: endOfToday } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: TASK_INCLUDE,
  });

  return records.map((record) => toTaskView(record, now, APP_TIME_ZONE));
}

export interface FollowUpPickerOption {
  id: string;
  name: string;
  subtitle: string | null;
}

/** Nombre de suggestions renvoyées au sélecteur de suivi. */
const FOLLOW_UP_PICKER_LIMIT = 8;

/**
 * Suivis proposés par le sélecteur du formulaire de tâche.
 *
 * Seuls les suivis **ouverts du workspace courant** sont proposés : lier une
 * tâche à un suivi déjà clos n'a pas de sens, et la recherche est faite par
 * PostgreSQL — le navigateur ne reçoit jamais la liste entière.
 */
export async function searchFollowUpOptions(
  search: string,
): Promise<FollowUpPickerOption[]> {
  const workspaceId = await getWorkspaceIdForPage();
  const term = search.trim();

  const records = await prisma.followUp.findMany({
    where: {
      workspaceId,
      status: "OPEN",
      ...(term ? { title: { contains: term, mode: "insensitive" as const } } : {}),
    },
    orderBy: term ? [{ dueAt: "asc" }] : [{ updatedAt: "desc" }],
    take: FOLLOW_UP_PICKER_LIMIT,
    select: {
      id: true,
      title: true,
      contact: { select: { firstName: true, lastName: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.title,
    subtitle: record.contact
      ? `${record.contact.firstName} ${record.contact.lastName}`.trim() || null
      : null,
  }));
}
