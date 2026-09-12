/**
 * État renvoyé par l'action de mise à jour d'une tâche.
 *
 * Même forme que `EditFollowUpState` : sérialisable, partagé entre le
 * serveur (`"use server"`) et le composant client. Séparé de `create-state.ts`
 * pour ne pas alourdir ce dernier avec des champs différents.
 */
export interface EditTaskState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialEditTaskState: EditTaskState = { status: "idle" };
