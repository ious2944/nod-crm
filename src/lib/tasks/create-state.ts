/**
 * État renvoyé par l'action de création, partagé entre le serveur et le
 * formulaire. Il vit hors du fichier `"use server"`, qui ne peut exporter que
 * des fonctions asynchrones.
 */
export interface CreateTaskState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialCreateTaskState: CreateTaskState = { status: "idle" };
