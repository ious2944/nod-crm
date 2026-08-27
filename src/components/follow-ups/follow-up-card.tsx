import { DueBadge } from "@/components/ui/due-badge";
import type { UrgencyLevel } from "@/lib/follow-ups/domain";
import type { FollowUpView } from "@/lib/follow-ups/view";
import { EditFollowUpDialog } from "./edit-follow-up-dialog";
import { CardActions, QuickAction, SnoozeMenu } from "./quick-actions";

/** Le vieillissement se lit d'abord à la couleur : discret → très visible.
 *  La pastille est partagée avec les tâches (`DueBadge`) ; le liseré de gauche
 *  reste propre à la carte de suivi. */
const EDGE: Record<UrgencyLevel, string> = {
  done: "bg-done-fg/35",
  calm: "bg-border-subtle",
  soon: "bg-soon-fg/50",
  today: "bg-today-fg",
  late: "bg-late-fg",
  critical: "bg-critical-fg",
};

export function FollowUpCard({ item }: { item: FollowUpView }) {
  const isOpen = item.status === "OPEN";
  const isCritical = item.level === "critical";

  return (
    <article
      className={`relative flex flex-col gap-3 rounded-xl border bg-surface p-4 pl-5 transition-shadow hover:shadow-sm sm:p-5 sm:pl-6 ${
        isCritical ? "border-critical-fg/40" : "border-border-subtle"
      } ${item.status !== "OPEN" ? "opacity-75" : ""}`}
    >
      {/* Arrondi porté par le liseré lui-même : la carte n'a plus besoin
          d'`overflow-hidden`, qui découpait les menus ouverts depuis ses actions. */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${EDGE[item.level]}`} />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-ink">
            {item.title}
            {item.isDemo && (
              <span className="ml-2 rounded-full border border-border-subtle px-1.5 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-muted">
                démo
              </span>
            )}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
            {item.contactName ? (
              <span className="inline-flex items-center gap-1.5 text-ink">
                <span
                  aria-hidden
                  className="grid h-5 w-5 place-items-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted"
                >
                  {item.contactInitials}
                </span>
                {item.contactName}
                {item.contactArchived && (
                  <span className="rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
                    archivé
                  </span>
                )}
              </span>
            ) : (
              <span className="italic">Sans contact</span>
            )}
            {item.organizationName && <span>· {item.organizationName}</span>}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                item.ballOwner === "ME" ? "bg-accent-soft text-accent" : "bg-surface-muted text-ink"
              }`}
            >
              🏓 {item.ballLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <EditFollowUpDialog item={item} />
          <DueBadge level={item.level} label={item.dueLabel} />
        </div>
      </div>

      {item.description && (
        <p className="text-[13px] leading-relaxed text-muted">{item.description}</p>
      )}

      <p className="text-xs text-muted">
        {item.ageLabel}
        {item.nudgeLabel && ` · ${item.nudgeLabel}`}
        {isOpen && item.overdueDays >= 1 && ` · en retard de ${item.overdueDays} j`}
      </p>

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
