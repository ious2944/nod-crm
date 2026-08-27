import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";
import { MAX_SEARCH_LENGTH } from "./filters";

/**
 * Validation des entrées du module Contacts.
 *
 * Les mêmes règles que le module Follow-up s'appliquent : nettoyage
 * (`sanitizeText` retire les caractères de contrôle que PostgreSQL refuse et
 * les espaces Unicode invisibles), puis bornes explicites sur chaque champ.
 * Rien n'atteint la base sans être passé par ici.
 *
 * Le schéma liste explicitement ses champs et Zod écarte les clés inconnues :
 * un `FormData` enrichi de `workspaceId`, `isDemo` ou `archivedAt` ne peut donc
 * pas se retrouver dans un `create()` (affectation de masse).
 */

/** Bornes de champ, réutilisées par les attributs `maxLength` du formulaire. */
export const CONTACT_LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 254,
  phone: 40,
  jobTitle: 120,
  organizationName: 120,
  notes: 2000,
} as const;

const text = (max: number) =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().max(max, `Ce champ dépasse ${max} caractères.`));

/** Champ facultatif : vide devient `null`, pas `""`. */
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * Téléphone volontairement souple : indicatifs, espaces, points, tirets,
 * parenthèses et barres obliques sont tous des usages courants. On exige
 * seulement que ce soit plausible — au moins quatre chiffres — plutôt que de
 * rejeter des numéros valides au nom d'un format.
 */
const phone = optionalText(CONTACT_LIMITS.phone).refine(
  (value) =>
    value === null ||
    (/^[+(]?[\d\s().\-/+]+$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 4),
  "Numéro de téléphone invalide.",
);

const email = optionalText(CONTACT_LIMITS.email).refine(
  (value) => value === null || z.email().safeParse(value).success,
  "Adresse email invalide.",
);

const identityFields = {
  firstName: optionalText(CONTACT_LIMITS.firstName),
  lastName: optionalText(CONTACT_LIMITS.lastName),
  email,
  phone,
  jobTitle: optionalText(CONTACT_LIMITS.jobTitle),
  organizationName: optionalText(CONTACT_LIMITS.organizationName),
  notes: optionalText(CONTACT_LIMITS.notes),
  /**
   * Identifiant UUID de l'organisation liée (V0.5).
   *
   * Vide (`""`) = pas de rattachement : on le transforme en `null` pour que la
   * couche données n'ait pas à distinguer chaîne vide et absence.
   */
  organizationId: z
    .string()
    .optional()
    .transform((value) => (value && z.uuid().safeParse(value).success ? value : null)),
};

/**
 * Un contact doit rester identifiable.
 *
 * Règle unique et énonçable en une phrase — c'est ce qui la rend
 * compréhensible : au moins un prénom, un nom, un email ou une organisation.
 * Le reste (téléphone, fonction, notes) ne suffit pas à désigner quelqu'un.
 */
const IDENTIFYING_FIELDS = ["firstName", "lastName", "email", "organizationName"] as const;

const IDENTITY_MESSAGE =
  "Renseigne au moins un prénom, un nom, un email ou une organisation.";

function requireIdentity(
  value: Record<(typeof IDENTIFYING_FIELDS)[number], string | null>,
  ctx: z.RefinementCtx,
): void {
  if (IDENTIFYING_FIELDS.some((field) => value[field])) return;

  ctx.addIssue({ code: "custom", path: ["firstName"], message: IDENTITY_MESSAGE });
}

export const createContactSchema = z.object(identityFields).superRefine(requireIdentity);

export const updateContactSchema = z
  .object({
    id: z.uuid("Contact introuvable."),
    ...identityFields,
    /** Case « retirer la photo » du formulaire d'édition. */
    removePhoto: z
      .string()
      .optional()
      .transform((value) => value === "1" || value === "on" || value === "true"),
  })
  .superRefine(requireIdentity);

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactIdSchema = z.object({ id: z.uuid("Contact introuvable.") });

/** Recherche du sélecteur de contact, dans le formulaire Follow-Up. */
export const contactSearchSchema = z
  .string()
  .transform(sanitizeText)
  .pipe(z.string().max(MAX_SEARCH_LENGTH));

export { IDENTITY_MESSAGE };
