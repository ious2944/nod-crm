"use client";

import { useState } from "react";

import { findContacts } from "@/app/(app)/contacts/actions";
import { FieldError, LABEL } from "@/components/ui/form";
import { PickerButton, SearchPicker } from "@/components/ui/search-picker";

/**
 * Sélecteur de contact.
 *
 * Remplace la liste déroulante de la V0.1, qui chargeait *tous* les contacts du
 * workspace dans la page. La mécanique de recherche est celle, partagée, de
 * `@/components/ui/search-picker` ; ne reste ici que ce qui est propre au
 * contact : la création rapide.
 *
 * Le contrat du formulaire n'a pas changé depuis la V0.2 — c'est ce qui
 * garantit la non-régression côté serveur. Le champ envoyé s'appelle toujours
 * `contactId` et vaut toujours `""` (aucun contact), `"new"` (création rapide)
 * ou l'UUID d'un contact existant.
 */

export interface PickerSelection {
  id: string;
  name: string;
}

export function ContactPicker({
  defaultSelection,
  mode,
  onModeChange,
  allowCreate = true,
  error,
}: {
  /** Contact pré-sélectionné (fiche contact → « + Nouveau Follow-Up »). */
  defaultSelection?: PickerSelection;
  /** `""`, `"new"` ou un UUID — la valeur réellement postée. */
  mode: string;
  onModeChange: (mode: string) => void;
  /**
   * Le formulaire de tâche ne propose pas la création rapide : un contact n'y
   * est qu'un repère facultatif, pas le sujet. Ajouter deux champs d'identité à
   * un formulaire censé se remplir en quelques secondes serait un mauvais
   * échange.
   */
  allowCreate?: boolean;
  error?: string;
}) {
  const [selection, setSelection] = useState<PickerSelection | null>(
    defaultSelection ?? null,
  );

  if (mode === "new") {
    return (
      <div>
        <p className={LABEL}>Contact</p>
        <input type="hidden" name="contactId" value={mode} />
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2">
          <span className="text-sm text-ink">Nouveau contact</span>
          <button
            type="button"
            onClick={() => {
              setSelection(null);
              onModeChange("");
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
          >
            Annuler
          </button>
        </div>
        <FieldError message={error} />
      </div>
    );
  }

  return (
    <SearchPicker
      name="contactId"
      label="Contact"
      placeholder="Rechercher un contact..."
      noneLabel="— Aucun contact —"
      emptyLabel="Aucun contact trouvé."
      search={findContacts}
      value={mode}
      selectionName={selection && mode === selection.id ? selection.name : null}
      onSelect={(option) => {
        setSelection({ id: option.id, name: option.name });
        onModeChange(option.id);
      }}
      onClear={() => {
        setSelection(null);
        onModeChange("");
      }}
      extraOptions={
        allowCreate
          ? (close) => (
              <PickerButton
                onSelect={() => {
                  setSelection(null);
                  onModeChange("new");
                  close();
                }}
              >
                <span className="text-accent">+ Créer un contact</span>
              </PickerButton>
            )
          : undefined
      }
      error={error}
    />
  );
}
