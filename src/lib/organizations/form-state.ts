/**
 * État renvoyé par les actions de création et de modification d'une organisation.
 *
 * Il vit hors du fichier `"use server"`, qui ne peut exporter que des fonctions
 * asynchrones — même contrainte que `src/lib/contacts/form-state.ts`.
 */
export interface OrganizationFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Identifiant de l'organisation créée, pour enchaîner sur sa fiche. */
  organizationId?: string;
}

export const initialOrganizationFormState: OrganizationFormState = { status: "idle" };
