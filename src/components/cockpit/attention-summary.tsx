import Link from "next/link";

import type { AttentionCounters, AttentionKey, CockpitFilter } from "@/lib/cockpit/filters";
import { ATTENTION_KEYS } from "@/lib/cockpit/filters";

/**
 * Les quatre indicateurs d'attention — V0.7 Lumina Enterprise.
 *
 * Pas de graphique, pas de KPI commercial, pas de gros chiffre décoratif : quatre
 * nombres qui répondent à « où ça coince ? ». Chacun est un filtre du feed.
 */
const LABELS: Record<AttentionKey, string> = {
  late: "En retard",
  today: "Aujourd'hui",
  upcoming: "À venir",
  waiting: "Chez eux",
};

const ICONS: Record<AttentionKey, string> = {
  late: "🔴",
  today: "📅",
  upcoming: "🗓",
  waiting: "⏳",
};

const TONE: Record<AttentionKey, string> = {
  late: "text-critical-fg",
  today: "text-today-fg",
  upcoming: "text-ink",
  waiting: "text-ink",
};

export function AttentionSummary({
  counters,
  filter,
}: {
  counters: AttentionCounters;
  filter: CockpitFilter;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ATTENTION_KEYS.map((key) => {
        const value = counters[key];
        const active = filter === key;
        const isAlert = key === "late" && value > 0;

        return (
          <li key={key}>
            <Link
              href={active ? "/today" : `/today?f=${key}`}
              aria-current={active ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl border bg-surface p-3.5 shadow-card transition-all hover:shadow-card-hover ${
                isAlert
                  ? "border-critical-fg/25 hover:border-critical-fg/40"
                  : active
                    ? "border-accent/50 hover:border-accent"
                    : "border-border-subtle hover:border-border-strong"
              }`}
            >
              <span className="text-xl">{ICONS[key]}</span>
              <div className="min-w-0">
                <p
                  className={`text-xl font-bold tabular-nums leading-none ${
                    value > 0 ? TONE[key] : "text-muted"
                  }`}
                >
                  {value}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-muted">
                  {LABELS[key]}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
