import { z } from "zod";

import { dueDateSchema, sanitizeText } from "@/lib/follow-ups/schemas";

/**
 * Validation des entrées du module Tâches.
 *
 * Même discipline que Follow-up et Contacts : nettoyage (`sanitizeText`), puis
 * bornes explicites. Le schéma énumère ses champs et Zod écarte les clés
 * inconnues — un `FormData` enrichi de `workspaceId`, `completedAt` ou
 * `isDemo` ne peut donc pas atteindre un `create()`.
 *
 * L'échéance réutilise `dueDateSchema` : une tâche et un suivi acceptent
 * exactement les mêmes dates.
 */

/** Bornes de champ, reprises par les attributs `maxLength` du formulaire. */
export const TASK_LIMITS = {
  title: 160,
  notes: 2000,
} as const;

const text = (max: number, min = 0, message?: string) =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(min, message).max(max, `Ce champ dépasse ${max} caractères.`));

/** Champ facultatif : vide devient `null`, pas `""`. */
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * Lien facultatif : `""` (aucun) ou l'UUID d'un objet du workspace courant.
 * L'appartenance est **re-vérifiée côté serveur** — cet identifiant vient du
 * client, la validation de forme ne prouve rien d'autre que sa forme.
 */
const optionalLink = (message: string) =>
  z
    .string()
    .trim()
    .default("")
    .refine((value) => value === "" || z.uuid().safeParse(value).success, message);

export const createTaskSchema = z.object({
  title: text(TASK_LIMITS.title, 1, "Le titre est obligatoire."),
  dueDate: dueDateSchema,
  contactId: optionalLink("Contact invalide."),
  followUpId: optionalLink("Suivi invalide."),
  opportunityId: optionalLink("Opportunité invalide."),
  notes: optionalText(TASK_LIMITS.notes),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Actions de ligne. Trois intentions, pas une machine à états : une tâche est
 * à faire ou terminée.
 */
export const taskActionSchema = z.object({
  id: z.uuid("Tâche introuvable."),
  intent: z.enum(["complete", "reopen", "snooze"]),
  days: z.coerce.number().int().min(1).max(60).optional(),
});

export type TaskActionInput = z.infer<typeof taskActionSchema>;

/** Recherche du sélecteur de suivi, dans le formulaire de tâche. */
export const followUpSearchSchema = z
  .string()
  .transform(sanitizeText)
  .pipe(z.string().max(120));
