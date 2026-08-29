"use client";

import { useTransition } from "react";

import { changeOpportunityStatus } from "@/app/(app)/commerce/actions";
import {
  PIPELINE_ORDER,
  STATUS_LABELS,
  type OpportunityStatus,
} from "@/lib/commerce/domain";

/**
 * Formulaire de changement de statut du pipeline.
 *
 * Un bouton par statut cible autorisé. La liste complète des statuts est
 * affichée, le statut courant est mis en évidence. La transition est validée
 * côté serveur — le formulaire ne filtre pas côté client par sécurité, mais
 * masque les transitions impossibles pour éviter les clics inutiles.
 */

export function ChangeStatusForm({
  opportunityId,
  currentStatus,
}: {
  opportunityId: string;
  currentStatus: OpportunityStatus;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(newStatus: OpportunityStatus) {
    if (newStatus === currentStatus) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", opportunityId);
      fd.set("status", newStatus);
      await changeOpportunityStatus(fd);
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {PIPELINE_ORDER.map((status) => {
        const isCurrent = status === currentStatus;
        const isTerminal = status === "GAGNEE" || status === "PERDUE";

        return (
          <button
            key={status}
            type="button"
            disabled={isPending || isCurrent}
            onClick={() => handleChange(status)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-default ${
              isCurrent
                ? isTerminal && status === "GAGNEE"
                  ? "bg-done-bg text-done-fg ring-1 ring-done-fg/30"
                  : isTerminal && status === "PERDUE"
                    ? "bg-critical-bg text-critical-fg ring-1 ring-critical-fg/30"
                    : "bg-accent text-accent-contrast shadow-sm"
                : "bg-surface-muted text-muted hover:bg-surface hover:text-ink border border-border-subtle disabled:opacity-40"
            }`}
            aria-pressed={isCurrent}
          >
            {STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}
