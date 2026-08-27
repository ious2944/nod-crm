import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";

/**
 * Validation des entrées du module Organisations.
 *
 * Mêmes règles que le module Contacts : nettoyage (`sanitizeText`), bornes
 * explicites sur chaque champ, liste explicite des champs pour éviter toute
 * affectation de masse.
 */

/** Bornes de champ, réutilisées par les attributs `maxLength` des formulaires. */
export const ORG_LIMITS = {
  name: 200,
  website: 500,
  phone: 40,
  email: 254,
  notes: 2000,
} as const;

const text = (max: number) =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().max(max, `Ce champ dépasse ${max} caractères.`));

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

const phone = optionalText(ORG_LIMITS.phone).refine(
  (value) =>
    value === null ||
    (/^[+(]?[\d\s().\-/+]+$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 4),
  "Numéro de téléphone invalide.",
);

const email = optionalText(ORG_LIMITS.email).refine(
  (value) => value === null || z.email().safeParse(value).success,
  "Adresse email invalide.",
);

/**
 * Schéma de création d'une organisation.
 *
 * `name` est le seul champ obligatoire.
 */
export const createOrganizationSchema = z.object({
  name: text(ORG_LIMITS.name).refine(
    (v) => v.trim().length > 0,
    "Le nom de l'organisation est obligatoire.",
  ),
  website: optionalText(ORG_LIMITS.website),
  phone,
  email,
  notes: optionalText(ORG_LIMITS.notes),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Schéma de modification : même champs + `id` obligatoire. */
export const updateOrganizationSchema = createOrganizationSchema.extend({
  id: z.string().uuid("Identifiant invalide."),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** Validation d'un UUID seul (archive, restore). */
export const organizationIdSchema = z.string().uuid("Identifiant invalide.");

/** Validation de la recherche dans le picker. */
export const organizationSearchSchema = z
  .string()
  .max(120, "Recherche trop longue.")
  .default("");
