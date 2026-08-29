"use client";

import { useCallback, useState } from "react";

import { findOrganizations } from "@/app/(app)/organizations/actions";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";

/**
 * Sélecteur d'organisation pour le formulaire Contact.
 *
 * Réutilise `SearchPicker`, comme le sélecteur de contact dans le formulaire
 * Follow-Up. La recherche est faite côté serveur et plafonnée.
 */
export function OrganizationPicker({
  organizationId,
  organizationName,
  required: _required,
  error,
}: {
  /** Identifiant de l'organisation actuellement sélectionnée. */
  organizationId: string | null;
  /** Nom affiché quand une organisation est sélectionnée. */
  organizationName: string | null;
  /** Indique visuellement que le champ est obligatoire (validation faite côté serveur). */
  required?: boolean;
  /** Message d'erreur de validation à afficher sous le sélecteur. */
  error?: string;
}) {
  const [selected, setSelected] = useState<PickerOption | null>(
    organizationId && organizationName
      ? { id: organizationId, name: organizationName, subtitle: null }
      : null,
  );

  const search = useCallback(async (query: string) => {
    return findOrganizations(query);
  }, []);

  return (
    <SearchPicker
      name="organizationId"
      label="Organisation (facultatif)"
      placeholder="Rechercher une organisation…"
      noneLabel="Aucune organisation"
      emptyLabel="Aucune organisation trouvée"
      search={search}
      value={selected?.id ?? ""}
      selectionName={selected?.name ?? null}
      onSelect={(option) => setSelected(option)}
      onClear={() => setSelected(null)}
      error={error}
    />
  );
}
