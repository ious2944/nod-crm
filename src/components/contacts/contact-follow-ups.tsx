import Link from "next/link";

import type { UrgencyLevel } from "@/lib/follow-ups/domain";
import type { FollowUpView } from "@/lib/follow-ups/view";

/**
 * Les suivis d'un contact, en lecture.
 *
 * Volontairement plus sobre que la carte du tableau Follow-up : ici on veut
 * savoir *où on en est* avec cette personne, pas piloter la journée. Les
 * actions rapides restent là où elles ont un sens, sur `/follow-ups`.
 */

const CHIP: Record<UrgencyLevel, string> = {
  done: "bg-done-bg text-done-fg",
  calm: "bg-calm-bg text-calm-fg",
  soon: "bg-soon-bg text-soon-fg",
  today: "bg-today-bg text-today-fg",
  late: "bg-late-bg text-late-fg",
  critical: "bg-critical-bg text-critical-fg",
};

const STATUS_LABEL = {
  OPEN: "En cours",
  COMPLETED: "Terminé",
  ABANDONED: "Abandonné",
} as const;

/** `2026-06-10` → `10 juin 2026`. Formatage en UTC : la clé est déjà locale. */
function formatDueDate(dueDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dueDate}T00:00:00Z`));
}

export function ContactFollowUps({ followUps }: { followUps: FollowUpView[] }) {
  if (followUps.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong bg-surface px-4 py-8 text-center text-sm text-muted">
        Aucun suivi pour ce contact.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {followUps.map((followUp) => (
        <li
          key={followUp.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border-subtle bg-surface px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink">{followUp.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span>{STATUS_LABEL[followUp.status]}</span>
              <span aria-hidden>·</span>
              <span>🏓 {followUp.ballLabel}</span>
              {followUp.status === "OPEN" && (
                <>
                  <span aria-hidden>·</span>
                  <span>Échéance {formatDueDate(followUp.dueDate)}</span>
                </>
              )}
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[followUp.level]}`}
          >
            {followUp.dueLabel}
          </span>
        </li>
      ))}

      <li className="pt-1">
        <Link href="/follow-ups" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Ouvrir le tableau Follow-up →
        </Link>
      </li>
    </ul>
  );
}
