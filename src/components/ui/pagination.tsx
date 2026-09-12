import Link from "next/link";

/**
 * Pagination serveur générique.
 *
 * Deux liens et un compteur : le volume attendu ne justifie pas une barre de
 * numéros, et des liens (plutôt que des boutons) restent partageables et
 * fonctionnent sans JavaScript.
 */
export function Pagination({
  page,
  pageCount,
  total,
  itemLabel,
  buildHref,
}: {
  /** Page courante (1-indexed). */
  page: number;
  /** Nombre total de pages. */
  pageCount: number;
  /** Nombre total d'éléments. */
  total: number;
  /** Étiquette singulier/pluriel pour le compteur (ex. "contact", "organisation"). */
  itemLabel: { singular: string; plural: string };
  /** Construit l'URL pour la page `n`. */
  buildHref: (n: number) => string;
}) {
  const totalLabel = `${total} ${total > 1 ? itemLabel.plural : itemLabel.singular}`;

  if (pageCount <= 1) {
    return <p className="text-xs text-muted">{totalLabel}</p>;
  }

  const link =
    "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-muted";
  const disabled = "rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-muted/60";

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={link}>
          ← Précédent
        </Link>
      ) : (
        <span className={disabled}>← Précédent</span>
      )}

      <p className="text-xs text-muted">
        Page {page} sur {pageCount} · {totalLabel}
      </p>

      {page < pageCount ? (
        <Link href={buildHref(page + 1)} className={link}>
          Suivant →
        </Link>
      ) : (
        <span className={disabled}>Suivant →</span>
      )}
    </nav>
  );
}
