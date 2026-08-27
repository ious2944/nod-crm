import { DueBadge } from "@/components/ui/due-badge";
import type { UrgencyLevel } from "@/lib/follow-ups/domain";
import type { FollowUpView } from "@/lib/follow-ups/view";
import { EditFollowUpDialog } from "./edit-follow-up-dialog";
import { CardActions, QuickAction, SnoozeMenu } from "./quick-actions";

/**
 * Carte de suivi — V0.7 Lumina Enterprise.
 *
 * Le vieillissement se lit d'abord à la couleur de la barre latérale gauche,
 * puis au badge d'échéance (DueBadge). La carte reste compacte : on ne
 * sacrifie pas la densité utile pour reproduire la maquette pixel-perfect.
 */
const EDGE: Record<UrgencyLevel, string> = {
  done: "bg-done-fg/30",
  calm: "bg-border-strong",
  soon: "bg-soon-fg/50",
  today: "bg-today-fg",
  late: "bg-late-fg",
  critical: "bg-critical-fg",
};

const BALL_CHIP: Record<"ME" | "THEM", string> = {
  ME: "bg-accent-soft text-accent",
  THEM: "bg-surface-muted text-muted",
};

export function FollowUpCard({ item }: { item: FollowUpView }) {
  const isOpen = item.status === "OPEN";
  const isCritical = item.level === "critical";

  return (
    <article
      className={`relative flex flex-col gap-3 rounded-xl border bg-surface p-4 pl-5 shadow-card transition-all hover:shadow-card-hover sm:p-5 sm:pl-6 ${
        isCritical
          ? "border-critical-fg/30 hover:border-critical-fg/50"
          : "border-border-subtle hover:border-border-strong"
      } ${item.status !== "OPEN" ? "opacity-70" : ""}`}
    >
      {/* Barre de vieillissement gauche */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${EDGE[item.level]}`}
      />

      {/* En-tête : titre + badge d'échéance */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {/* Pastilles de contexte */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                BALL_CHIP[item.ballOwner]
              }`}
            >
              🏓 {item.ballLabel}
            </span>

            {item.contactName && (
              <span className="inline-flex min-w-0 max-w-[200px] items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
                <span
                  aria-hidden
                  className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-border-strong text-[9px] font-bold text-muted"
                >
                  {item.contactInitials}
                </span>
                <span className="truncate">{item.contactName}</span>
                {item.contactArchived && (
                  <span className="shrink-0 italic opacity-70">· archivé</span>
                )}
              </span>
            )}

            {item.organizationName && (
              <span className="truncate rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted max-w-[160px]">
                {item.organizationName}
              </span>
            )}

            {item.isDemo && (
              <span className="rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
                démo
              </span>
            )}
          </div>

          <h3 className="text-[15px] font-semibold leading-snug text-ink">{item.title}</h3>
        </div>

        {/* Badge + édition */}
        <div className="flex shrink-0 items-center gap-2">
          <EditFollowUpDialog item={item} />
          <DueBadge level={item.level} label={item.dueLabel} />
        </div>
      </div>

      {/* Description facultative */}
      {item.description && (
        <p className="text-[13px] leading-relaxed text-muted">{item.description}</p>
      )}

      {/* Méta-données secondaires */}
      <p className="text-xs text-muted/80">
        {item.ageLabel}
        {item.nudgeLabel && ` · ${item.nudgeLabel}`}
        {isOpen && item.overdueDays >= 1 && (
          <span className="font-medium text-late-fg"> · en retard de {item.overdueDays} j</span>
        )}
      </p>

      {/* Actions rapides */}
      <CardActions>
        {isOpen ? (
          <>
            {item.ballOwner === "THEM" ? (
              <>
                <QuickAction
                  id={item.id}
                  intent="nudge"
                  label="Relancer"
                  variant="primary"
                  title="Noter une relance — l'échéance repart à +3 jours"
                />
                <QuickAction
                  id={item.id}
                  intent="received"
                  label="Reçu"
                  title="Ils ont répondu — la balle revient chez moi"
                />
              </>
            ) : (
              <QuickAction
                id={item.id}
                intent="handoff"
                label="Balle envoyée"
                variant="primary"
                title="J'ai fait ma part — la balle repart chez eux"
              />
            )}
            <SnoozeMenu id={item.id} />
            <QuickAction id={item.id} intent="complete" label="Terminer" />
            <QuickAction
              id={item.id}
              intent="abandon"
              label="Abandonner"
              variant="ghost"
              className="sm:ml-auto"
            />
          </>
        ) : (
          <QuickAction id={item.id} intent="reopen" label="Rouvrir" />
        )}
      </CardActions>
    </article>
  );
}
