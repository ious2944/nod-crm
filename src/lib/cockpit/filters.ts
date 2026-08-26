/**
 * Filtres du cockpit.
 *
 * Les quatre indicateurs d'attention et les quatre filtres du feed sont la même
 * chose vue deux fois : un compteur, c'est le nombre de suivis que son filtre
 * laisserait passer. Une seule définition (`matchesCockpitFilter`) sert donc
 * aux deux, ce qui interdit qu'un compteur annonce 3 et que le clic en montre 4.
 */

import type { CockpitSignals, FeedReason } from "./domain";
import { UPCOMING_WINDOW_DAYS } from "./domain";

export const COCKPIT_FILTERS = [
  { key: "all", label: "Tout" },
  { key: "late", label: "En retard" },
  { key: "today", label: "Aujourd'hui" },
  { key: "upcoming", label: "À venir" },
  { key: "waiting", label: "Chez eux" },
] as const;

export type CockpitFilter = (typeof COCKPIT_FILTERS)[number]["key"];

/** Les quatre indicateurs, dans l'ordre d'affichage. « Tout » n'en est pas un. */
export const ATTENTION_KEYS = ["late", "today", "upcoming", "waiting"] as const;

export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export type AttentionCounters = Record<AttentionKey, number>;

const KEYS = COCKPIT_FILTERS.map((filter) => filter.key) as readonly string[];

export function parseCockpitFilter(value: string | string[] | undefined): CockpitFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return KEYS.includes(raw ?? "") ? (raw as CockpitFilter) : "all";
}

/**
 * Un suivi ouvert entre-t-il dans ce filtre ?
 *
 * Les trois premiers découpent le temps sans recouvrement ; « chez eux » est
 * transversal — un suivi en retard dont la balle est chez eux compte dans les
 * deux, et c'est voulu : ce sont deux questions différentes.
 */
export function matchesCockpitFilter(
  filter: CockpitFilter,
  signals: CockpitSignals,
): boolean {
  if (signals.status !== "OPEN") return false;

  switch (filter) {
    case "late":
      return signals.overdueDays >= 1;
    case "today":
      return signals.overdueDays === 0;
    case "upcoming":
      return signals.overdueDays < 0 && signals.overdueDays >= -UPCOMING_WINDOW_DAYS;
    case "waiting":
      return signals.ballOwner === "THEM";
    case "all":
    default:
      return true;
  }
}

/**
 * Le feed par défaut mélange les groupes utiles et écarte le lointain ; un
 * filtre explicite, lui, montre tout ce que son compteur a compté.
 */
export function belongsToFeed(
  filter: CockpitFilter,
  item: CockpitSignals & { reason: FeedReason | null },
): boolean {
  if (item.reason === null) return false;
  if (filter === "all") return item.reason !== "later";
  return matchesCockpitFilter(filter, item);
}
