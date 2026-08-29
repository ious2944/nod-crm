/**
 * Cœur métier du module Commerce.
 *
 * Une Opportunity, c'est **l'état et le contexte d'une affaire commerciale**.
 * Ce fichier ne contient aucune logique de tâche, de relance ou d'échéance :
 * ces préoccupations appartiennent respectivement aux modules Task, FollowUp
 * et Today.
 *
 * Cinq statuts, regroupés en deux phases :
 *  - Phase ouverte  : À qualifier → En discussion → Proposition
 *  - Phase terminée : Gagnée | Perdue
 *
 * Fonctions pures : testables sans base de données.
 */

/** Valeurs de l'enum Prisma `OpportunityStatus`, exportées pour typer le domaine. */
export type OpportunityStatus =
  | "A_QUALIFIER"
  | "EN_DISCUSSION"
  | "PROPOSITION"
  | "GAGNEE"
  | "PERDUE";

/** Libellés affichés dans l'interface. */
export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  A_QUALIFIER: "À qualifier",
  EN_DISCUSSION: "En discussion",
  PROPOSITION: "Proposition",
  GAGNEE: "Gagnée",
  PERDUE: "Perdue",
};

/**
 * Ordre du pipeline, pour l'affichage en colonne / sélecteur.
 * Les statuts terminaux (`GAGNEE`, `PERDUE`) restent en dernier.
 */
export const PIPELINE_ORDER: OpportunityStatus[] = [
  "A_QUALIFIER",
  "EN_DISCUSSION",
  "PROPOSITION",
  "GAGNEE",
  "PERDUE",
];

/** Statuts considérés comme « ouverts » (affaire en cours). */
export const OPEN_STATUSES: readonly OpportunityStatus[] = [
  "A_QUALIFIER",
  "EN_DISCUSSION",
  "PROPOSITION",
];

/** Statuts considérés comme « terminés » (affaire close). */
export const CLOSED_STATUSES: readonly OpportunityStatus[] = ["GAGNEE", "PERDUE"];

/** Renvoie `true` si le statut correspond à une affaire encore en cours. */
export function isOpenStatus(status: OpportunityStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Renvoie `true` si le statut correspond à une affaire close. */
export function isClosedStatus(status: OpportunityStatus): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * Variante visuelle associée à chaque statut.
 *
 * `neutral` → gris ; `active` → accent ; `won` → vert ; `lost` → rouge.
 * Ces valeurs pilotent le choix du jeton CSS (badge, puce…) sans que les
 * composants aient à connaître les statuts individuels.
 */
export type StatusVariant = "neutral" | "active" | "won" | "lost";

export function statusVariant(status: OpportunityStatus): StatusVariant {
  if (status === "GAGNEE") return "won";
  if (status === "PERDUE") return "lost";
  if (status === "A_QUALIFIER") return "neutral";
  return "active";
}

/**
 * Transitions autorisées depuis chaque statut.
 *
 * Une Server Action est un point d'entrée public : sans cette table, un POST
 * forgé pourrait revenir en arrière ou rouvrir une affaire close arbitrairement.
 */
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  A_QUALIFIER: ["EN_DISCUSSION", "PROPOSITION", "GAGNEE", "PERDUE"],
  EN_DISCUSSION: ["A_QUALIFIER", "PROPOSITION", "GAGNEE", "PERDUE"],
  PROPOSITION: ["EN_DISCUSSION", "GAGNEE", "PERDUE"],
  // Une affaire close peut être rouverte.
  GAGNEE: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"],
  PERDUE: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"],
};

export function isTransitionAllowed(
  from: OpportunityStatus,
  to: OpportunityStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** Titre du bandeau de la page Commerce. */
export function commerceHeadline(openCount: number): string {
  if (openCount === 0) return "Aucune affaire ouverte.";
  if (openCount === 1) return "1 affaire en cours.";
  return `${openCount} affaires en cours.`;
}

/**
 * Formate un montant estimé pour l'affichage.
 *
 * Le montant est stocké en `Decimal(14,2)` côté Prisma et converti en `number`
 * (ou `null`) avant d'arriver ici : pas d'import Decimal dans le domaine pur.
 */
export function formatAmount(amount: number | null): string | null {
  if (amount === null) return null;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Option du sélecteur d'opportunité (dans les formulaires Task / FollowUp).
 */
export interface OpportunityPickerOption {
  id: string;
  name: string;
  subtitle: string | null;
}
