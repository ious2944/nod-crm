"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { archiveContact, restoreContact } from "@/app/(app)/contacts/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PopoverMenu } from "@/components/ui/popover-menu";
import type { ContactFormValues } from "@/lib/contacts/view";
import { ContactDialog } from "./contact-dialog";

/**
 * Modification et archivage d'un contact.
 *
 * Le même composant sert la liste (déclencheur `⋮`) et la fiche (boutons
 * visibles) : c'est la consigne « modifiable depuis les deux endroits », sans
 * dupliquer la logique d'archivage.
 *
 * Le dialogue et la confirmation sont montés **à côté** du menu, pas dedans :
 * le panneau se ferme au clic, et tout ce qu'il contient disparaît avec lui.
 */

const MENU_ITEM =
  "w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-surface-muted disabled:opacity-60";

export function ContactActions({
  contact,
  openFollowUps,
  archived,
  variant,
  /** Vers où aller après archivage depuis la fiche. */
  redirectTo,
}: {
  contact: ContactFormValues;
  openFollowUps: number;
  archived: boolean;
  variant: "menu" | "inline";
  redirectTo?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: (formData: FormData) => Promise<void>) => {
    const formData = new FormData();
    formData.set("id", contact.id);

    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
        setConfirming(false);
        if (redirectTo) router.push(redirectTo);
      } catch {
        setError("L'action n'a pas pu être appliquée. Recharge la page.");
      }
    });
  };

  const archiveLabel = archived ? "Restaurer" : "Archiver";
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const menuLabel = fullName ? `Actions du contact ${fullName}` : "Actions du contact";
  const onArchiveClick = () =>
    archived ? run(restoreContact) : setConfirming(true);

  return (
    <>
      {variant === "menu" ? (
        <PopoverMenu
          ariaLabel={menuLabel}
          // Le glyphe « ⋮ » est décoratif : sans le libellé caché qui le suit,
          // le déclencheur n'aurait aucun nom accessible — un lecteur d'écran
          // annoncerait « bouton », et rien d'autre.
          label={
            <>
              <span aria-hidden>⋮</span>
              <span className="sr-only">{menuLabel}</span>
            </>
          }
          triggerClassName="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted hover:text-ink"
        >
          {(close) => (
            <>
              <MenuButton
                onClick={() => {
                  close();
                  setEditing(true);
                }}
              >
                Modifier
              </MenuButton>
              <MenuButton
                onClick={() => {
                  close();
                  onArchiveClick();
                }}
              >
                {archiveLabel}
              </MenuButton>
            </>
          )}
        </PopoverMenu>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
          >
            Modifier
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onArchiveClick}
            className="rounded-lg border border-transparent px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-progress"
          >
            {archiveLabel}
          </button>
        </div>
      )}

      {error && (
        <p role="status" aria-live="polite" className="mt-1 text-xs text-critical-fg">
          {error}
        </p>
      )}

      <ContactDialog open={editing} onClose={() => setEditing(false)} contact={contact} />

      <ConfirmDialog
        open={confirming}
        pending={pending}
        title="Archiver ce contact ?"
        description={
          <>
            <p>
              Il disparaîtra de la liste, de la recherche et des sélecteurs. Rien n&apos;est
              supprimé : tu peux le restaurer depuis sa fiche.
            </p>
            {openFollowUps > 0 && (
              <p className="mt-2">
                {openFollowUps === 1
                  ? "Son suivi en cours est conservé"
                  : `Ses ${openFollowUps} suivis en cours sont conservés`}{" "}
                et reste{openFollowUps === 1 ? "" : "nt"} visible
                {openFollowUps === 1 ? "" : "s"} dans le module Follow-up.
              </p>
            )}
          </>
        }
        confirmLabel="Archiver"
        onConfirm={() => run(archiveContact)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={MENU_ITEM}>
      {children}
    </button>
  );
}
