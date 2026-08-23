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
