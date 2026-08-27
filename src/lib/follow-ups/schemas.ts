import { z } from "zod";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Nettoie une chaîne venue d'un formulaire avant toute validation.
 *
 * Deux problèmes que `String.prototype.trim()` seul ne règle pas :
 *
 * - les caractères de contrôle, dont l'octet NUL. PostgreSQL refuse `\u0000`
 *   dans une colonne texte : sans ce filtre, un sujet contenant un NUL fait
 *   remonter une erreur Prisma jusqu'à une page 500, déclenchable par
 *   n'importe quel utilisateur authentifié ;
 * - les espaces Unicode invisibles (U+00A0 insécable, U+200B sans chasse,
 *   U+FEFF), qui laissaient passer un titre visuellement vide.
 */
export function sanitizeText(value: string): string {
  return value
    // Caractères de contrôle : ils sont ici la cible, pas un oubli.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
    .trim();
}

/** Texte nettoyé puis borné. `min` sert aux champs obligatoires. */
const text = (max: number, min = 0, message?: string) =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(min, message).max(max, `Ce champ dépasse ${max} caractères.`));

/**
 * Échéance : une date calendaire, jamais une heure.
 *
 * Exporté parce que le module Tâches applique exactement la même règle : une
 * échéance de tâche et une échéance de suivi ne doivent pas pouvoir diverger
 * sur ce qui est acceptable.
 */
export const dueDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Échéance invalide.")
  // `Date.parse` accepte 2026-02-31 et le décale au 3 mars : on exige que la
  // date fasse l'aller-retour à l'identique, sinon elle n'existe pas.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Échéance invalide.")
  // Bornes de bon sens : elles écartent les dates absurdes (an 0001, an 9999)
  // qui n'ont aucun usage métier et compliquent l'affichage.
  .refine((value) => value >= "2000-01-01" && value <= "2100-12-31", "Échéance hors limites.");

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

export const ballOwnerSchema = z.enum(["ME", "THEM"]);

export const createFollowUpSchema = z
  .object({
    title: text(160, 1, "Le sujet est obligatoire."),
    description: optionalText(2000),
    dueDate: dueDateSchema,
    ballOwner: ballOwnerSchema,
    // "" = aucun contact ; "new" = création rapide ; sinon l'UUID d'un contact
    // existant, dont l'appartenance au workspace est revérifiée côté serveur.
    contactId: z
      .string()
      .trim()
      .default("")
      .refine(
        (value) => value === "" || value === "new" || UUID_PATTERN.test(value),
        "Contact invalide.",
      ),
    newContactFirstName: optionalText(80),
    newContactLastName: optionalText(80),
    newContactOrganization: optionalText(120),
  })
  .superRefine((value, ctx) => {
    if (value.contactId !== "new") return;

    if (!value.newContactFirstName && !value.newContactLastName) {
      ctx.addIssue({
        code: "custom",
        path: ["newContactFirstName"],
        message: "Indique au moins un prénom ou un nom.",
      });
    }
  });

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

/**
 * Schéma de mise à jour d'un suivi existant.
 *
 * Champs éditables : sujet, description, échéance, contact.
 * Champs non éditables : propriétaire de la balle, statut — ils appartiennent
 * aux actions rapides, dont la logique métier (machine à états, compteurs de
 * relances) ne doit pas être contournée par un formulaire générique.
 */
export const updateFollowUpSchema = z.object({
  id: z.string().uuid("Suivi introuvable."),
  title: text(160, 1, "Le sujet est obligatoire."),
  description: optionalText(2000),
  dueDate: dueDateSchema,
  contactId: z
    .string()
    .trim()
    .default("")
    .refine(
      (value) => value === "" || UUID_PATTERN.test(value),
      "Contact invalide.",
    ),
});

export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;

export const quickActionSchema = z.object({
  id: z.uuid("Suivi introuvable."),
  intent: z.enum([
    "nudge",
    "handoff",
    "received",
    "snooze",
    "complete",
    "abandon",
    "reopen",
  ]),
  days: z.coerce.number().int().min(1).max(60).optional(),
});

export type QuickActionInput = z.infer<typeof quickActionSchema>;
