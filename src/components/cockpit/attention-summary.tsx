import Link from "next/link";

import type { AttentionCounters, AttentionKey, CockpitFilter } from "@/lib/cockpit/filters";
import { ATTENTION_KEYS } from "@/lib/cockpit/filters";

/**
 * Les quatre indicateurs d'attention.
 *
 * Pas de graphique, pas de KPI commercial, pas de gros chiffre décoratif : quatre
 * nombres qui répondent à « où ça coince ? ». Chacun est un **filtre du feed** —
 * l'indicateur n'est donc pas seulement une information, c'est le chemin le plus
 * court vers les suivis qu'il compte.
 */
const LABELS: Record<AttentionKey, string> = {
  late: "En retard",
  today: "Aujourd'hui",
  upcoming: "À venir",
  waiting: "Chez eux",
};

/** Seul le retard change de couleur : c'est le seul chiffre qui doit accrocher. */
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
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ATTENTION_KEYS.map((key) => {
        const value = counters[key];
        const active = filter === key;

        return (
          <li key={key}>
            <Link
              href={active ? "/today" : `/today?f=${key}`}
              aria-current={active ? "true" : undefined}
              className={`flex items-baseline gap-2 rounded-xl border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong ${
                active ? "border-accent bg-accent-soft" : "border-border-subtle"
              }`}
            >
              <span
                className={`text-lg font-semibold tabular-nums ${
                  value > 0 ? TONE[key] : "text-muted"
                }`}
              >
                {value}
              </span>
              <span className="truncate text-xs font-medium text-muted">{LABELS[key]}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
