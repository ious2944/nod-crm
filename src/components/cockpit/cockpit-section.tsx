import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Cadre commun des zones du cockpit : titre, compteur, lien « voir tout »,
 * état vide.
 *
 * Une zone future (notes rapides, rappels, bloc Mirai) se branche en réutilisant
 * ce cadre : elle hérite alors de l'espacement, du titrage et du traitement des
 * listes vides sans les redéfinir.
 */
export function CockpitSection({
  title,
  count,
  moreHref,
  moreLabel = "Voir tout",
  empty,
  children,
}: {
  title: string;
  /** Total réel, quand la zone n'en montre qu'une partie. */
  count?: number;
  moreHref?: string;
  moreLabel?: string;
  /** Phrase affichée à la place du contenu quand il n'y a rien — et c'est
   *  une bonne nouvelle : « Rien en retard. », pas « Aucun résultat ». */
  empty: string;
  children?: ReactNode;
}) {
  const isEmpty = children == null;

  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          {title}
          {count != null && count > 0 && (
            <span className="ml-1.5 text-xs font-medium tabular-nums text-muted">
              {count}
            </span>
          )}
        </h2>

        {moreHref && !isEmpty && (
          <Link
            href={moreHref}
            className="shrink-0 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {moreLabel} →
          </Link>
        )}
      </div>

      <div className="mt-2.5">
        {isEmpty ? (
          <p className="rounded-xl border border-dashed border-border-subtle bg-surface px-4 py-5 text-center text-[13px] text-muted">
            {empty}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
