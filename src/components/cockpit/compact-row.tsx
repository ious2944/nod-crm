import type { ReactNode } from "react";

import { URGENCY_CHIP } from "@/components/follow-ups/urgency-styles";
import type { CockpitItem } from "@/lib/cockpit/view";
import { ContactLabel } from "./contact-label";

/**
 * Ligne dense des zones secondaires (« Prochainement », « En attente chez eux »).
 *
 * Une ligne dense : quand, quoi, qui — et rien de plus, sinon ces
 * zones concurrenceraient le feed au lieu de le compléter. `trailing` accueille
 * l'action éventuelle.
 */
export function CompactFollowUpRow({
  item,
  note,
  trailing,
}: {
  item: CockpitItem;
  /** Précision de second plan : délai d'attente, motif… */
  note?: string | null;
  trailing?: ReactNode;
}) {
  return (
    // Pas de `flex-wrap` : une ligne reste une ligne. Avec le retour à la
    // ligne, l'action tombait sous le texte pour certaines lignes seulement,
    // et la liste perdait son alignement — donc sa lisibilité en diagonale.
    <article className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface px-3 py-2 shadow-card transition-shadow hover:shadow-card-hover hover:border-border-strong">
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
          URGENCY_CHIP[item.level]
        }`}
      >
        {item.dueLabel}
      </span>

      <span className="min-w-0 flex-1">
        {/* L'objet d'abord, sur deux lignes au plus : tronqué à une ligne
            dans cette colonne étroite, il ne disait plus de quoi il s'agissait. */}
        <span
          title={item.title}
          className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-ink"
        >
          {item.title}
        </span>
        <ContactLabel contact={item.contact} size="compact" />
        {/* La note n'est pas tronquée : dans « En attente chez eux », c'est
            elle qui porte l'information — un « sans mouvement depuis … » coupé
            ne dit plus rien. */}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </span>

      {trailing && <span className="shrink-0">{trailing}</span>}
    </article>
  );
}
