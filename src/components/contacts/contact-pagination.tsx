import Link from "next/link";

import { buildContactListHref, type ContactListParams } from "@/lib/contacts/filters";

/**
 * Pagination serveur.
 *
 * Deux liens et un compteur : le volume attendu ne justifie pas une barre de
 * numéros, et des liens (plutôt que des boutons) restent partageables et
 * fonctionnent sans JavaScript.
 */
export function ContactPagination({
  params,
  page,
  pageCount,
  total,
}: {
  params: ContactListParams;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-xs text-muted">
        {total} contact{total > 1 ? "s" : ""}
      </p>
    );
  }

  const link =
    "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-muted";
  const disabled = "rounded-lg border border-border-subtle px-3 py-1.5 text-[13px] text-muted/60";

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={buildContactListHref({ ...params, page: page - 1 })} className={link}>
          ← Précédent
        </Link>
      ) : (
        <span className={disabled}>← Précédent</span>
      )}

      <p className="text-xs text-muted">
        Page {page} sur {pageCount} · {total} contact{total > 1 ? "s" : ""}
      </p>

      {page < pageCount ? (
        <Link href={buildContactListHref({ ...params, page: page + 1 })} className={link}>
          Suivant →
        </Link>
      ) : (
        <span className={disabled}>Suivant →</span>
      )}
    </nav>
  );
}
