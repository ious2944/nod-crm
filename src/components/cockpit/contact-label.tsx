import Link from "next/link";

import type { ContactRef } from "@/lib/cockpit/view";

/**
 * Un interlocuteur, partout pareil dans le cockpit.
 *
 * Trois raisons d'en faire un composant plutôt qu'un bout de JSX recopié :
 *
 * - le nom est **cliquable** vers la fiche contact (V0.2) dès qu'un contact est
 *   lié, sans que chaque section ait à s'en souvenir ;
 * - l'organisation a déjà sa place et son propre nœud : le jour où les
 *   entreprises deviennent des entités, seul `organizationHref` se remplit ;
 * - un contact archivé reste visible, signalé, jamais effacé.
 */
export function ContactLabel({
  contact,
  size = "default",
}: {
  contact: ContactRef;
  /** `compact` : sans avatar, pour les listes denses. */
  size?: "default" | "compact";
}) {
  const name = contact.href ? (
    <Link
      href={contact.href}
      className="truncate font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
    >
      {contact.name}
    </Link>
  ) : (
    <span className="truncate italic text-muted">{contact.name}</span>
  );

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
      {size === "default" && contact.id && (
        <span
          aria-hidden
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted"
        >
          {contact.initials}
        </span>
      )}

      {name}

      {contact.archived && (
        <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
          archivé
        </span>
      )}

      {/* Ligne « entreprise » — affichée uniquement si la donnée existe :
          aucune organisation fictive n'est inventée pour remplir la place. */}
      {contact.organizationName && (
        <span className="truncate text-muted">
          <span aria-hidden> · </span>
          {contact.organizationName}
        </span>
      )}
    </span>
  );
}
