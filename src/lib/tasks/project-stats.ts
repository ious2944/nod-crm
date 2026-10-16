import type { TaskItem } from "./types";

/**
 * Indicateurs d'un projet, calculés sur les tâches chargées (jamais une valeur
 * stockée à part).
 *
 * La progression ne compte que les **tâches principales** : une tâche et ses
 * sous-tâches ne pèsent qu'une fois. Les tâches de la corbeille ne sont jamais
 * chargées (`visibleTaskWhere`) ; le filtre `deleted` couvre en plus les
 * éléments qu'un client garderait en mémoire.
 */
export function computeStats(tasks: (TaskItem & { deleted?: boolean })[], today: string) {
  const live = tasks.filter((t) => !t.deleted);
  const top = live.filter((t) => !t.parentId);
  const done = top.filter((t) => t.status === "DONE");
  const open = top.filter((t) => t.status !== "DONE");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const blocked = open.filter((t) => t.openBlockerCount > 0);
  const estimated = live.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const spent = live.reduce((s, t) => s + t.spentMinutes, 0);
  return { top, done, open, overdue, blocked, estimated, spent, progress: top.length ? done.length / top.length : 0 };
}
