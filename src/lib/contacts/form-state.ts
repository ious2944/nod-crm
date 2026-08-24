/**
 * État renvoyé par les actions de création et de modification d'un contact.
 *
 * Il vit hors du fichier `"use server"`, qui ne peut exporter que des fonctions
 * asynchrones — même contrainte que `src/lib/follow-ups/create-state.ts`.
 */
export interface ContactFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Identifiant du contact créé, pour enchaîner sur sa fiche. */
  contactId?: string;
}

export const initialContactFormState: ContactFormState = { status: "idle" };
