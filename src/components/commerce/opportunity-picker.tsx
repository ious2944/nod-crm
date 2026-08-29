"use client";

import { useCallback, useState } from "react";

import { findOpportunities } from "@/app/(app)/commerce/actions";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";

/**
 * Sélecteur d'opportunité pour les formulaires Task et FollowUp.
 *
 * Réutilise `SearchPicker`, exactement comme `OrganizationPicker` et
 * `FollowUpPicker`. La recherche est faite côté serveur et plafonnée.
 * Seules les opportunités ouvertes sont proposées.
 */
export function OpportunityPicker({
  opportunityId,
  opportunityName,
  error,
}: {
  opportunityId?: string;
  opportunityName?: string | null;
  error?: string;
}) {
  const [selected, setSelected] = useState<PickerOption | null>(
    opportunityId && opportunityName
      ? { id: opportunityId, name: opportunityName, subtitle: null }
      : null,
  );

  const search = useCallback(async (query: string) => {
    return findOpportunities(query);
  }, []);

  return (
    <SearchPicker
      name="opportunityId"
      label="Opportunité (facultatif)"
      placeholder="Rechercher une affaire…"
      noneLabel="Aucune opportunité"
      emptyLabel="Aucune opportunité trouvée"
      search={search}
      value={selected?.id ?? ""}
      selectionName={selected?.name ?? null}
      onSelect={(option) => setSelected(option)}
      onClear={() => setSelected(null)}
      error={error}
    />
  );
}
