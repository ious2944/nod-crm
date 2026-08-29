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
  required = false,
  error,
}: {
  /** Identifiant de l'organisation actuellement sélectionnée. */
  organizationId: string | null;
  /** Nom affiché quand une organisation est sélectionnée. */
  organizationName: string | null;
  /** Champ obligatoire : masque l'option « Aucune organisation » et retire « (facultatif) » du libellé. */
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
      label={required ? "Organisation" : "Organisation (facultatif)"}
      placeholder="Rechercher une organisation…"
      noneLabel={required ? undefined : "Aucune organisation"}
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
