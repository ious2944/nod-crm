import { addDays, isoWeekday } from "./recurrence";

/**
 * Charge de travail (module pur, testé unitairement).
 *
 * Règles :
 * - seules les tâches **ouvertes et affectées** comptent ;
 * - l'estimation restante (estimation − temps passé, jamais négative) est
 *   **répartie sur les jours ouvrés** (lundi–vendredi) entre la date de début
 *   et l'échéance (sans date de début : le jour de l'échéance) ; seule la part
 *   qui tombe dans la période affichée est comptée ;
 * - une tâche dont l'échéance précède la période est « en retard » : son reste
 *   est compté à part, entièrement ;
 * - la capacité est celle de la personne (`weeklyCapacityMinutes`), sinon la
 *   valeur par défaut ; elle est proratisée sur les semaines de la période ;
 * - les tâches **sans date** et celles **sans estimation** ne sont pas
 *   additionnées (on ne devine pas) : elles sont listées séparément.
 */

export const DEFAULT_WEEKLY_CAPACITY_MINUTES = 35 * 60;

export interface WorkloadTask {
  id: string;
  assigneeId: string | null;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  spentMinutes: number;
}

export interface WorkloadRow {
  userId: string;
  capacityMinutes: number;
  /** Minutes par semaine de la période. */
  weeks: number[];
  /** Tâches (ids) contribuant à chaque semaine. */
  weekTasks: string[][];
  overdueMinutes: number;
  overdueTasks: string[];
  totalMinutes: number;
  /** Datées dans la période mais sans estimation : non comptées. */
  unestimated: string[];
  /** Sans échéance ni début : non comptées. */
  undated: string[];
}

const isWorkday = (key: string) => isoWeekday(key) <= 5;

/** Jours ouvrés de `[from, to]` (bornes incluses), ou `[to]` s'il n'y en a aucun. */
export function workdaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let key = from, guard = 0; key <= to && guard < 3700; key = addDays(key, 1), guard += 1) {
    if (isWorkday(key)) days.push(key);
  }
  return days.length ? days : [to];
}

export function remainingMinutes(task: Pick<WorkloadTask, "estimatedMinutes" | "spentMinutes">): number {
  return Math.max(0, (task.estimatedMinutes ?? 0) - task.spentMinutes);
}

export function computeWorkload(input: {
  tasks: WorkloadTask[];
  /** Lundis des semaines affichées, dans l'ordre. */
  weekStarts: string[];
  capacities: Record<string, number | null | undefined>;
  defaultCapacityMinutes?: number;
}): WorkloadRow[] {
  const { tasks, weekStarts } = input;
  const periodStart = weekStarts[0];
  const periodEnd = addDays(weekStarts[weekStarts.length - 1], 6);
  const rows = new Map<string, WorkloadRow>();
  const rowOf = (userId: string) => {
    let row = rows.get(userId);
    if (!row) {
      row = {
        userId,
        capacityMinutes: input.capacities[userId] ?? input.defaultCapacityMinutes ?? DEFAULT_WEEKLY_CAPACITY_MINUTES,
        weeks: weekStarts.map(() => 0),
        weekTasks: weekStarts.map(() => []),
        overdueMinutes: 0,
        overdueTasks: [],
        totalMinutes: 0,
        unestimated: [],
        undated: [],
      };
      rows.set(userId, row);
    }
    return row;
  };

  for (const task of tasks) {
    if (!task.assigneeId || task.status === "DONE") continue;
    const due = task.dueDate ?? task.startDate;
    if (!due) {
      rowOf(task.assigneeId).undated.push(task.id);
      continue;
    }
    const start = task.startDate && task.startDate <= due ? task.startDate : due;
    if (start > periodEnd) continue; // entièrement après la période
    if (!task.estimatedMinutes) {
      if (due >= periodStart) rowOf(task.assigneeId).unestimated.push(task.id);
      else rowOf(task.assigneeId).overdueTasks.push(task.id);
      continue;
    }
    const remaining = remainingMinutes(task);
    const row = rowOf(task.assigneeId);
    if (due < periodStart) {
      row.overdueMinutes += remaining;
      row.overdueTasks.push(task.id);
      continue;
    }
    const days = workdaysBetween(start, due);
    const perDay = remaining / days.length;
    for (const day of days) {
      if (day < periodStart || day > periodEnd) continue;
      const index = weekStarts.findIndex((w) => day >= w && day <= addDays(w, 6));
      if (index < 0) continue;
      row.weeks[index] += perDay;
      if (!row.weekTasks[index].includes(task.id)) row.weekTasks[index].push(task.id);
    }
  }

  for (const row of rows.values()) {
    row.weeks = row.weeks.map((m) => Math.round(m));
    row.totalMinutes = row.weeks.reduce((s, m) => s + m, 0);
  }
  return [...rows.values()];
}

/** Niveau d'une cellule : sous 80 % de la capacité, jusqu'à 100 %, au-delà. */
export function loadLevel(minutes: number, capacityMinutes: number): "empty" | "ok" | "high" | "over" {
  if (minutes <= 0) return "empty";
  if (minutes > capacityMinutes) return "over";
  if (minutes > capacityMinutes * 0.8) return "high";
  return "ok";
}
