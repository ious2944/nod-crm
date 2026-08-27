import type { BallOwner, Timing } from "./domain";

export const FOLLOW_UP_FILTERS = [
  { key: "all", label: "Tous" },
  { key: "nudge", label: "À relancer" },
  { key: "me", label: "Chez moi" },
  { key: "them", label: "Chez eux" },
  { key: "done", label: "Terminés" },
] as const;

export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number]["key"];

const KEYS = FOLLOW_UP_FILTERS.map((filter) => filter.key) as readonly string[];

export function parseFilter(value: string | string[] | undefined): FollowUpFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return KEYS.includes(raw ?? "") ? (raw as FollowUpFilter) : "all";
}

/** Longueur maximale d'une recherche de suivi — au-delà, ce n'est plus une recherche. */
export const MAX_FOLLOW_UP_SEARCH_LENGTH = 120;

/**
 * Parse le paramètre `?q=` de la liste de suivis.
 *
 * Retourne une chaîne normalisée (trimmée, plafonnée) ou `""` si la valeur
 * est absente ou vide. Jamais `undefined` : les couches supérieures n'ont
 * pas à tester l'existence.
 */
export function parseSearchQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_FOLLOW_UP_SEARCH_LENGTH);
}

/**
 * Construit l'URL de la liste de suivis en préservant tous les paramètres
 * actifs (filtre + recherche).
 */
export function buildFollowUpHref(
  params: { filter: FollowUpFilter; query: string },
  overrides: Partial<{ filter: FollowUpFilter; query: string }> = {},
): string {
  const f = overrides.filter ?? params.filter;
  const q = overrides.query ?? params.query;

  const parts: string[] = [];
  if (f !== "all") parts.push(`f=${encodeURIComponent(f)}`);
  if (q) parts.push(`q=${encodeURIComponent(q)}`);

  return `/follow-ups${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

/** Un suivi ouvert appartient-il au filtre ? (« Terminés » est servi par une autre requête.) */
export function matchesOpenFilter(
  filter: FollowUpFilter,
  item: { ballOwner: BallOwner; timing: Pick<Timing, "needsAttention"> },
): boolean {
  switch (filter) {
    case "nudge":
      // Relancer, c'est aller chercher quelqu'un : la balle est chez eux et le délai est passé.
      return item.ballOwner === "THEM" && item.timing.needsAttention;
    case "me":
      return item.ballOwner === "ME";
    case "them":
      return item.ballOwner === "THEM";
    case "done":
      return false;
    case "all":
    default:
      return true;
  }
}
