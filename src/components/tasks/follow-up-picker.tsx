"use client";

import { useState } from "react";

import { findFollowUps } from "@/app/(app)/tasks/actions";
import { SearchPicker } from "@/components/ui/search-picker";

/**
 * Sélecteur de suivi lié, dans le formulaire de tâche.
 *
 * Même mécanique que le sélecteur de contact (`@/components/ui/search-picker`),
 * appliquée aux suivis **ouverts** du workspace. Le lien est facultatif et ne
 * crée aucune synchronisation : il dit seulement « cette tâche sert à faire
 * avancer ce suivi ».
 *
 * Le champ posté s'appelle `followUpId` et vaut `""` ou l'UUID d'un suivi,
 * dont l'appartenance au workspace est revérifiée côté serveur.
 */
export function FollowUpPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [name, setName] = useState<string | null>(null);

  return (
    <SearchPicker
      name="followUpId"
      label="Suivi lié (facultatif)"
      placeholder="Rechercher un suivi..."
      noneLabel="— Aucun suivi —"
      emptyLabel="Aucun suivi ouvert trouvé."
      search={findFollowUps}
      value={value}
      selectionName={value && name ? name : null}
      onSelect={(option) => {
        setName(option.name);
        onChange(option.id);
      }}
      onClear={() => {
        setName(null);
        onChange("");
      }}
      error={error}
    />
  );
}
