import Link from "next/link";

import { attentionHeadline } from "@/lib/follow-ups/domain";
import { FOLLOW_UP_FILTERS, type FollowUpFilter } from "@/lib/follow-ups/filters";
import type { FollowUpStats } from "@/lib/follow-ups/queries";

const TILES = [
  { key: "all", label: "Ouverts", read: (s: FollowUpStats) => s.open },
  { key: "me", label: "Chez moi", read: (s: FollowUpStats) => s.ballWithMe },
  { key: "them", label: "Chez eux", read: (s: FollowUpStats) => s.ballWithThem },
  { key: "nudge", label: "À relancer", read: (s: FollowUpStats) => s.toNudge },
] as const;

export function StatTiles({
  stats,
  filter,
}: {
  stats: FollowUpStats;
  filter: FollowUpFilter;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {TILES.map((tile) => {
        const active = filter === tile.key;
        const value = tile.read(stats);
        const highlight = tile.key === "nudge" && value > 0;

        return (
          <Link
            key={tile.key}
            href={`/follow-ups?f=${tile.key}`}
            aria-current={active ? "true" : undefined}
            className={`rounded-xl border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong ${
              active ? "border-accent" : "border-border-subtle"
            }`}
          >
            <p className="text-xs font-medium text-muted">{tile.label}</p>
            <p
              className={`mt-0.5 text-2xl font-semibold tabular-nums ${
                highlight ? "text-late-fg" : "text-ink"
              }`}
            >
              {value}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

// Les filtres passent à la ligne plutôt que de défiler horizontalement : sous
// 768 px, « Chez eux » et « Terminés » sortaient de l'écran sans aucun indice
// qu'un défilement latéral existait.
export function FilterTabs({ filter }: { filter: FollowUpFilter }) {
  return (
    <nav aria-label="Filtres" className="-mx-1 flex flex-wrap gap-1 px-1 pb-1">
      {FOLLOW_UP_FILTERS.map((item) => {
        const active = filter === item.key;
        return (
          <Link
            key={item.key}
            href={`/follow-ups?f=${item.key}`}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle bg-surface text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AttentionHeadline({ count }: { count: number }) {
  const clear = count === 0;

  return (
    <p className={`text-sm ${clear ? "text-done-fg" : "text-muted"}`}>
      {clear && <span aria-hidden>✓ </span>}
      {attentionHeadline(count)}
    </p>
  );
}
