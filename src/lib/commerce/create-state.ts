/**
 * États renvoyés par les Server Actions du module Commerce, partagés entre le
 * serveur et les formulaires. Ils vivent hors des fichiers `"use server"`, qui
 * ne peuvent exporter que des fonctions asynchrones.
 */

export interface CreateOpportunityState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialCreateOpportunityState: CreateOpportunityState = { status: "idle" };

export interface UpdateOpportunityState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialUpdateOpportunityState: UpdateOpportunityState = { status: "idle" };
