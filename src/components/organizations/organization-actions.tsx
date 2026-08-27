"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { archiveOrganization, restoreOrganization } from "@/app/(app)/organizations/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PopoverMenu } from "@/components/ui/popover-menu";
import type { OrganizationFormValues } from "@/lib/organizations/view";
import { OrganizationDialog } from "./organization-dialog";

/**
 * Modification et archivage d'une organisation.
 *
 * Même pattern que `ContactActions` : un seul composant pour la liste et la
 * fiche, avec le même découpage menu/inline.
 */

const MENU_ITEM =
  "w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-surface-muted disabled:opacity-60";

export function OrganizationActions({
  organization,
  archived,
  variant,
  redirectTo,
}: {
  organization: OrganizationFormValues;
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
    formData.set("id", organization.id);

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
  const menuLabel = `Actions de ${organization.name}`;
  const onArchiveClick = () =>
    archived ? run(restoreOrganization) : setConfirming(true);

  return (
    <>
      {variant === "menu" ? (
        <PopoverMenu
          ariaLabel={menuLabel}
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

      <OrganizationDialog
        open={editing}
        onClose={() => setEditing(false)}
        organization={organization}
      />

      <ConfirmDialog
        open={confirming}
        pending={pending}
        title="Archiver cette organisation ?"
        description={
          <p>
            Elle disparaîtra de la liste et du sélecteur de contact. Les contacts rattachés
            ne sont pas touchés. Tu peux la restaurer depuis sa fiche.
          </p>
        }
        confirmLabel="Archiver"
        onConfirm={() => run(archiveOrganization)}
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
