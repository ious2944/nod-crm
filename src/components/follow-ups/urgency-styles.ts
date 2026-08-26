import type { UrgencyLevel } from "@/lib/follow-ups/domain";

/**
 * Traduction du vieillissement en couleurs, partagée par le tableau Follow-up
 * et par le cockpit.
 *
 * Elle vit ici plutôt que dans un composant : deux copies de cette table
 * finiraient par diverger, et « J+11 » n'aurait pas la même couleur selon la
 * page qui l'affiche.
 */

/** Pastille d'échéance : du discret au très visible. */
export const URGENCY_CHIP: Record<UrgencyLevel, string> = {
  done: "bg-done-bg text-done-fg",
  calm: "bg-calm-bg text-calm-fg",
  soon: "bg-soon-bg text-soon-fg",
  today: "bg-today-bg text-today-fg",
  late: "bg-late-bg text-late-fg",
  critical: "bg-critical-bg text-critical-fg",
};

/** Liseré vertical de la carte ou de la ligne. */
export const URGENCY_EDGE: Record<UrgencyLevel, string> = {
  done: "bg-done-fg/35",
  calm: "bg-border-subtle",
  soon: "bg-soon-fg/50",
  today: "bg-today-fg",
  late: "bg-late-fg",
  critical: "bg-critical-fg",
};
