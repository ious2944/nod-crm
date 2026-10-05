import { BallBadge } from "@/components/follow-ups/ball-badge";
import { URGENCY_CHIP, URGENCY_EDGE } from "@/components/follow-ups/urgency-styles";
import type { CockpitItem } from "@/lib/cockpit/view";
import { ContactLabel } from "./contact-label";
import { FollowUpActionRow } from "./follow-up-action-row";

/**
 * Une ligne du feed « À traiter ».
 *
 * Elle porte le minimum exigé d'un élément actionnable : qui, quoi, quand, où
 * est la balle, depuis combien de temps, et quoi faire. Plus dense que la carte
 * du tableau Follow-up — c'est une liste de travail, pas une fiche.
 *
 * La zone `after` reste libre : c'est là que viendra se poser une action
 * discrète (« Ajouter une note », un lien GED) sans toucher à la structure.
 */
export function FollowUpRow({ item }: { item: CockpitItem }) {
  const isCritical = item.level === "critical";

  return (
    // Le liseré coloré ne suffisait pas à distinguer un J+15 d'un « Dans 6 j »
    // dans une pile de lignes identiques : le niveau critique reprend le
    // traitement de bordure que la carte du tableau utilise déjà.
    <article
      className={`relative rounded-xl border bg-surface p-3 pl-4 shadow-card transition-all hover:shadow-card-hover sm:pl-5 ${
        isCritical
          ? "border-critical-fg/40 hover:border-critical-fg/60"
          : "border-border-subtle hover:border-border-strong"
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${URGENCY_EDGE[item.level]}`}
      />

      {/* Même hiérarchie que les tâches : l'objet du suivi d'abord, avec la
          seule échéance à sa droite ; qui, où est la balle et les actions
          viennent dessous. */}
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <h3 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-ink">
            {item.title}
          </h3>
          {item.isDemo && (
            <span className="mt-0.5 shrink-0 rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
              démo
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
            URGENCY_CHIP[item.level]
          }`}
        >
          {item.dueLabel}
        </span>
      </div>

      {/* Contexte et actions partagent une ligne dès qu'il y a la place : sur
          une pile de dix suivis, la ligne d'actions isolée transformait le feed
          en succession de grosses cartes. */}
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <ContactLabel contact={item.contact} />
          <BallBadge ballOwner={item.ballOwner} label={item.ballLabel} />
          {item.overdueDays >= 1 && <span>En retard de {item.overdueDays} j</span>}
          {item.stagnationLabel && (
            <span className="font-medium text-late-fg">⚠ {item.stagnationLabel}</span>
          )}
          {item.nudgeLabel && <span>{item.nudgeLabel}</span>}
        </div>

        <div className="shrink-0">
          <FollowUpActionRow item={item} />
        </div>
      </div>
    </article>
  );
}
