/**
 * Validation des entrées du module Commerce.
 *
 * Même discipline que les autres modules : nettoyage (`sanitizeText`), bornes
 * explicites, champs inconnus éliminés par Zod pour prévenir la mass-assignment.
 * L'appartenance des UUIDs au workspace est **re-vérifiée côté serveur** dans
 * les Server Actions — le schéma ne prouve que la forme.
 */

import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";
import { PIPELINE_ORDER, type OpportunityStatus } from "./domain";

/** Bornes de champ, reprises par les attributs `maxLength` du formulaire. */
export const OPPORTUNITY_LIMITS = {
  name: 160,
  notes: 4000,
} as const;

// ─── Helpers internes ──────────────────────────────────────────────────────

const text = (max: number, min = 0, message?: string) =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(min, message).max(max, `Ce champ dépasse ${max} caractères.`));

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

/** Lien facultatif : `""` (aucun) ou UUID valide. Vérifié côté serveur. */
const optionalLink = (message: string) =>
  z
    .string()
    .trim()
    .default("")
    .refine((value) => value === "" || z.uuid().safeParse(value).success, message);

/**
 * Date calendaire facultative, même règle que `dueDateSchema`.
 * `""` (vide) devient `null` — le champ n'est pas obligatoire.
 */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "" ? value : null))
  .pipe(
    z
      .string()
      .nullable()
      .refine((value) => {
        if (value === null) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        );
      }, "Date invalide.")
      .refine(
        (value) => value === null || (value >= "2000-01-01" && value <= "2100-12-31"),
        "Date hors limites.",
      ),
  );

/**
 * Montant estimé facultatif.
 *
 * Arrive comme chaîne depuis `FormData` ; `""` devient `null`.
 * On accepte jusqu'à 12 chiffres entiers et 2 décimales (ex. `999999999999.99`).
 */
const optionalAmount = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "" ? value : null))
  .pipe(
    z
      .string()
      .nullable()
      .refine((value) => {
        if (value === null) return true;
        const n = Number(value.replace(",", "."));
        return !Number.isNaN(n) && n >= 0 && n <= 999_999_999_999.99;
      }, "Montant invalide.")
      .transform((value) => (value !== null ? parseFloat(value.replace(",", ".")) : null)),
  );

const statusSchema = z.enum(
  PIPELINE_ORDER as [OpportunityStatus, ...OpportunityStatus[]],
);

// ─── Schémas exportés ──────────────────────────────────────────────────────

export const createOpportunitySchema = z.object({
  name: text(OPPORTUNITY_LIMITS.name, 1, "Le nom est obligatoire."),
  organizationId: z
    .string()
    .trim()
    .uuid("Organisation invalide.")
    .min(1, "L'organisation est obligatoire."),
  contactId: optionalLink("Contact invalide."),
  status: statusSchema.default("A_QUALIFIER"),
  estimatedAmount: optionalAmount,
  expectedCloseDate: optionalDate,
  notes: optionalText(OPPORTUNITY_LIMITS.notes),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  id: z.string().uuid("Opportunité introuvable."),
  name: text(OPPORTUNITY_LIMITS.name, 1, "Le nom est obligatoire."),
  organizationId: z
    .string()
    .trim()
    .uuid("Organisation invalide.")
    .min(1, "L'organisation est obligatoire."),
  contactId: optionalLink("Contact invalide."),
  estimatedAmount: optionalAmount,
  expectedCloseDate: optionalDate,
  notes: optionalText(OPPORTUNITY_LIMITS.notes),
});

export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

/**
 * Changement de statut depuis les boutons de pipeline.
 * Le statut cible est revalidé par la machine à états côté serveur.
 */
export const changeStatusSchema = z.object({
  id: z.string().uuid("Opportunité introuvable."),
  status: statusSchema,
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

/** Recherche du sélecteur d'opportunité. */
export const opportunitySearchSchema = z
  .string()
  .transform(sanitizeText)
  .pipe(z.string().max(120));
