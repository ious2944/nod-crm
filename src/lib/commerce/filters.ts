/**
 * Types et helpers pour le filtrage de la liste Commerce.
 *
 * Le filtre est transmis via les paramètres de recherche de l'URL (searchParams)
 * et lu côté serveur dans la page. Aucun état client n'est nécessaire.
 */

import { CLOSED_STATUSES, OPEN_STATUSES, type OpportunityStatus } from "./domain";

/**
 * Filtre de statut affiché dans la barre de navigation de la liste.
 *
 * - `open`   : affaires en cours (A_QUALIFIER, EN_DISCUSSION, PROPOSITION)
 * - `closed` : affaires closes (GAGNEE, PERDUE)
 * - `all`    : toutes, triées par date de mise à jour
 */
export type StatusFilter = "open" | "closed" | "all";

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  open: "En cours",
  closed: "Closes",
  all: "Toutes",
};

/** Convertit un filtre d'URL en liste de statuts Prisma. */
export function filterToStatuses(
  filter: StatusFilter,
): OpportunityStatus[] | undefined {
  if (filter === "open") return [...OPEN_STATUSES];
  if (filter === "closed") return [...CLOSED_STATUSES];
  return undefined; // « all » = pas de filtre
}

/** Sanitise la valeur brute du searchParam pour éviter les valeurs inconnues. */
export function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === "closed" || raw === "all") return raw;
  return "open"; // valeur par défaut
}
