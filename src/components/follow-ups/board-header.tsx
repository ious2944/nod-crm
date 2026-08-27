import Link from "next/link";

import { attentionHeadline } from "@/lib/follow-ups/domain";
import {
  buildFollowUpHref,
  FOLLOW_UP_FILTERS,
  type FollowUpFilter,
} from "@/lib/follow-ups/filters";
import type { FollowUpStats } from "@/lib/follow-ups/queries";

const TILES = [
  {
    key: "all",
    label: "Ouverts",
    icon: "📂",
    read: (s: FollowUpStats) => s.open,
    accent: false,
  },
  {
    key: "me",
    label: "Chez moi",
    icon: "🏠",
    read: (s: FollowUpStats) => s.ballWithMe,
    accent: false,
  },
  {
    key: "them",
    label: "Chez eux",
    icon: "⏳",
    read: (s: FollowUpStats) => s.ballWithThem,
    accent: false,
  },
  {
    key: "nudge",
    label: "À relancer",
    icon: "⚠",
    read: (s: FollowUpStats) => s.toNudge,
    accent: true,
  },
] as const;

export function StatTiles({
  stats,
  filter,
  query = "",
}: {
  stats: FollowUpStats;
  filter: FollowUpFilter;
  query?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((tile) => {
        const active = filter === tile.key;
        const value = tile.read(stats);
        const isAlert = tile.accent && value > 0;

        return (
          <Link
            key={tile.key}
            href={buildFollowUpHref({ filter, query }, { filter: tile.key })}
            aria-current={active ? "true" : undefined}
            className={`group relative rounded-xl border bg-surface p-4 transition-all shadow-card hover:shadow-card-hover ${
              isAlert
                ? "border-critical-fg/25 hover:border-critical-fg/40"
                : active
                  ? "border-accent/50 hover:border-accent"
                  : "border-border-subtle hover:border-border-strong"
            }`}
          >
            {/* Icône */}
            <div
              className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-base ${
                isAlert
                  ? "bg-critical-bg text-critical-fg"
                  : active
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-muted text-muted"
              }`}
            >
              {tile.icon}
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {tile.label}
            </p>
            <p
              className={`mt-0.5 text-3xl font-bold tabular-nums tracking-tight ${
                isAlert ? "text-critical-fg" : active ? "text-accent" : "text-ink"
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

/** Onglets de filtre — au-dessus de la liste de cartes. */
export function FilterTabs({
  filter,
  query = "",
}: {
  filter: FollowUpFilter;
  query?: string;
}) {
  return (
    <nav
      aria-label="Filtres"
      className="-mx-1 flex flex-wrap gap-1 px-1 pb-1 border-b border-border-subtle"
    >
      {FOLLOW_UP_FILTERS.map((item) => {
        const active = filter === item.key;
        return (
          <Link
            key={item.key}
            href={buildFollowUpHref({ filter, query }, { filter: item.key })}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? "bg-accent text-accent-contrast shadow-sm"
                : "text-muted hover:bg-surface-muted hover:text-ink"
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
    <p className={`text-sm font-medium ${clear ? "text-done-fg" : "text-critical-fg"}`}>
      {clear && <span aria-hidden>✓ </span>}
      {attentionHeadline(count)}
    </p>
  );
}
