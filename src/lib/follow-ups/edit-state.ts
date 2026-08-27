/**
 * État renvoyé par l'action de mise à jour d'un suivi.
 *
 * Même forme que `CreateFollowUpState` : sérialisable, partagé entre le
 * serveur (`"use server"`) et le composant client. Séparé pour ne pas
 * alourdir `create-state.ts` avec un état qui n'a pas les mêmes champs.
 */
export interface EditFollowUpState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialEditFollowUpState: EditFollowUpState = { status: "idle" };
