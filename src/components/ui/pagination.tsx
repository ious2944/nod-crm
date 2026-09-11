import Link from "next/link";

/**
 * Composant de pagination générique côté serveur.
 *
 * Deux liens et un compteur : le volume attendu ne justifie pas une barre de
 * numéros, et des liens (plutôt que des boutons) restent partageables et
 * fonctionnent sans JavaScript.
 *
 * Utilisé par les listes Commerce, Contacts (via ContactPagination) et tout
 * nouveau module paginé.
 */
export function Pagination({
  page,
  pageCount,
  total,
  buildHref,
  noun = "élément",
}: {
  page: number;
  pageCount: number;
  total: number;
  /** Construit l'URL pour la page donnée (doit conserver les filtres actifs). */
  buildHref: (page: number) => string;
  /** Nom de l'entité au singulier, ex. « opportunité ». */
  noun?: string;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-xs text-muted">
        {total} {noun}
        {total > 1 ? "s" : ""}
      </p>
    );
  }

  const link =
    "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-muted";
  const disabled =
    "rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-muted/60";

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
        Page {page} sur {pageCount} · {total} {noun}
        {total > 1 ? "s" : ""}
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
