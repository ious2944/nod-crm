/**
 * Cœur métier du module Follow-up.
 *
 * Le principe tient en une phrase : « qui me doit quoi, depuis quand, et où est
 * la balle ? ». Tout ce qui relève du temps (retard, urgence, relance) est
 * calculé ici, en fonctions pures, et testé dans `domain.test.ts`.
 */

import { daysBetween } from "@/lib/date";

export type FollowUpStatus = "OPEN" | "COMPLETED" | "ABANDONED";
export type BallOwner = "ME" | "THEM";

/** Du plus discret au plus visible. Pilote la couleur et le poids visuel. */
export type UrgencyLevel = "done" | "calm" | "soon" | "today" | "late" | "critical";

/** Nombre de jours de retard au-delà duquel un suivi devient très visible. */
export const CRITICAL_OVERDUE_DAYS = 7;

/** Options de report proposées en action rapide. */
export const SNOOZE_OPTIONS = [
  { days: 1, label: "+1 j" },
  { days: 3, label: "+3 j" },
  { days: 7, label: "+1 sem." },
] as const;

/** Une relance repousse l'échéance d'autant de jours : on vient de rendre la balle. */
export const NUDGE_SNOOZE_DAYS = 3;

/** Quand la balle revient chez moi, je me laisse ce délai pour traiter. */
export const RECEIVED_SNOOZE_DAYS = 1;

/** Les sept transitions possibles d'un suivi. */
export type FollowUpIntent =
  | "nudge"
  | "handoff"
  | "received"
  | "snooze"
  | "complete"
  | "abandon"
  | "reopen";

/**
 * Machine à états.
 *
 * Une Server Action est un point d'entrée public : sans cette table, un POST
 * forgé pouvait « rouvrir » un suivi déjà ouvert — ce qui écrasait son échéance
 * — ou relancer un suivi terminé. L'interface ne proposait pas ces boutons,
 * mais l'action, elle, les acceptait.
 */
const ALLOWED_FROM: Record<FollowUpIntent, readonly FollowUpStatus[]> = {
  nudge: ["OPEN"],
  handoff: ["OPEN"],
  received: ["OPEN"],
  snooze: ["OPEN"],
  complete: ["OPEN"],
  abandon: ["OPEN"],
  // Rouvrir n'a de sens que depuis un état clos.
  reopen: ["COMPLETED", "ABANDONED"],
};

export function isTransitionAllowed(
  intent: FollowUpIntent,
  status: FollowUpStatus,
): boolean {
  return ALLOWED_FROM[intent].includes(status);
}

export interface TimingInput {
  status: FollowUpStatus;
  dueAt: Date;
  createdAt: Date;
}

export interface Timing {
  /** > 0 : en retard. 0 : dû aujourd'hui. < 0 : encore du temps. */
  overdueDays: number;
  /** Jours écoulés depuis la création — l'« ancienneté » du sujet. */
  ageDays: number;
  level: UrgencyLevel;
  /** Étiquette courte affichée sur la carte : `J+6`, `Aujourd'hui`, `Demain`… */
  dueLabel: string;
  /** Le suivi réclame une action aujourd'hui. */
  needsAttention: boolean;
}

export function computeTiming(input: TimingInput, now: Date, timeZone: string): Timing {
  const overdueDays = daysBetween(input.dueAt, now, timeZone);
  const ageDays = Math.max(0, daysBetween(input.createdAt, now, timeZone));

  if (input.status !== "OPEN") {
    return {
      overdueDays,
      ageDays,
      level: "done",
      dueLabel: input.status === "COMPLETED" ? "Terminé" : "Abandonné",
      needsAttention: false,
    };
  }

  return {
    overdueDays,
    ageDays,
    level: urgencyLevel(overdueDays),
    dueLabel: dueLabel(overdueDays),
    needsAttention: overdueDays >= 0,
  };
}

export function urgencyLevel(overdueDays: number): UrgencyLevel {
  if (overdueDays >= CRITICAL_OVERDUE_DAYS) return "critical";
  if (overdueDays >= 1) return "late";
  if (overdueDays === 0) return "today";
  if (overdueDays === -1) return "soon";
  return "calm";
}

export function dueLabel(overdueDays: number): string {
  if (overdueDays >= 1) return `J+${overdueDays}`;
  if (overdueDays === 0) return "Aujourd'hui";
  if (overdueDays === -1) return "Demain";
  return `Dans ${-overdueDays} j`;
}

/** Phrase d'ancienneté affichée en second plan sur la carte. */
export function ageLabel(ageDays: number): string {
  if (ageDays <= 0) return "Ouvert aujourd'hui";
  if (ageDays === 1) return "Ouvert depuis 1 jour";
  return `Ouvert depuis ${ageDays} jours`;
}

/** Titre de la barre d'état : on veut avoir envie de le faire tomber à zéro. */
export function attentionHeadline(count: number): string {
  if (count === 0) return "Tout est sous contrôle.";
  if (count === 1) return "1 sujet nécessite ton attention.";
  return `${count} sujets nécessitent ton attention.`;
}
