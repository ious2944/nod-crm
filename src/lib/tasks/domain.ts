/**
 * Cœur métier du module Tâches (V0.4).
 *
 * Une tâche, c'est **quelque chose à faire**. Un suivi, c'est **quelque chose à
 * faire avancer avec quelqu'un**. Toute la différence est là, et elle explique
 * ce que ce fichier ne contient pas : ni balle, ni relance, ni machine à états.
 *
 * Deux états seulement — `completedAt === null` (à faire) ou non (terminée).
 *
 * Le vocabulaire d'échéance (`dueLabel`, `urgencyLevel`) et les options de
 * report sont **importés du module Follow-Up** plutôt que redéfinis : une tâche
 * due demain doit se lire exactement comme un suivi dû demain, et un seul
 * endroit doit décider de la couleur d'un retard. Les jetons de couleur restent
 * ceux de `globals.css` : la V0.4 n'introduit aucune palette.
 *
 * Fonctions pures : testées dans `domain.test.ts`.
 */

import { daysBetween } from "@/lib/date";
import { dueLabel, urgencyLevel, type UrgencyLevel } from "@/lib/follow-ups/domain";

export { dueLabel, urgencyLevel, type UrgencyLevel };

/** Options de report proposées par l'action « Reporter ». */
export const TASK_SNOOZE_OPTIONS = [
  { days: 1, label: "Demain" },
  { days: 3, label: "+3 j" },
  { days: 7, label: "+1 sem." },
] as const;

/** Les trois transitions possibles. Volontairement pauvre : c'est le sujet. */
export type TaskIntent = "complete" | "reopen" | "snooze";

/**
 * Regroupement d'affichage de la page Tâches, dans l'ordre de priorité voulu :
 * en retard, puis aujourd'hui, puis à venir. `completed` sort de la liste
 * principale.
 */
export type TaskBucket = "overdue" | "today" | "upcoming" | "completed";

export interface TaskTimingInput {
  dueAt: Date;
  completedAt: Date | null;
}

export interface TaskTiming {
  /** > 0 : en retard. 0 : dû aujourd'hui. < 0 : encore du temps. */
  overdueDays: number;
  bucket: TaskBucket;
  level: UrgencyLevel;
  /** Étiquette courte : `J+4`, `Aujourd'hui`, `Demain`, `Dans 5 j`. */
  dueLabel: string;
  /**
   * La tâche demande une action aujourd'hui — c'est **la** définition du feed
   * Aujourd'hui : `completed_at IS NULL` ET `due_at <= fin du jour courant`.
   */
  isActionable: boolean;
}

export function computeTaskTiming(
  input: TaskTimingInput,
  now: Date,
  timeZone: string,
): TaskTiming {
  // Comparaison en jours calendaires, pas en heures : « dû aujourd'hui » reste
  // vrai à 23 h 59 comme à 8 h, quel que soit le fuseau du serveur.
  const overdueDays = daysBetween(input.dueAt, now, timeZone);

  if (input.completedAt) {
    return {
      overdueDays,
      bucket: "completed",
      level: "done",
      dueLabel: "Terminée",
      isActionable: false,
    };
  }

  return {
    overdueDays,
    bucket: taskBucket(overdueDays),
    level: urgencyLevel(overdueDays),
    dueLabel: dueLabel(overdueDays),
    isActionable: overdueDays >= 0,
  };
}

/** Regroupement d'une tâche **non terminée**. */
export function taskBucket(overdueDays: number): Exclude<TaskBucket, "completed"> {
  if (overdueDays >= 1) return "overdue";
  if (overdueDays === 0) return "today";
  return "upcoming";
}

/** Ordre d'affichage : la plus en retard d'abord, la plus lointaine ensuite. */
export function compareTasks(
  a: { dueAt: Date; createdAt: Date },
  b: { dueAt: Date; createdAt: Date },
): number {
  return a.dueAt.getTime() - b.dueAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime();
}

/** Titre du bandeau de la page Tâches. Compte les tâches à faire, rien d'autre. */
export function taskHeadline(count: number): string {
  if (count === 0) return "Aucune tâche à faire.";
  if (count === 1) return "1 tâche à faire.";
  return `${count} tâches à faire.`;
}
