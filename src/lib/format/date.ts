/**
 * Utilitaires de formatage de dates en locale française.
 *
 * Fonctions pures, sans état, indépendantes du framework.
 * À utiliser pour l'affichage uniquement — ne contient pas de logique métier.
 */

/**
 * Formate une date en locale française courte.
 *
 * Accepte une Date JavaScript ou une chaîne ISO 8601 (YYYY-MM-DD ou
 * YYYY-MM-DDTHH:mm:ssZ).
 *
 * Exemple : `new Date("2026-12-31")` → `"31 déc. 2026"`
 *
 * La date ISO-only (YYYY-MM-DD) est interprétée en UTC pour éviter le
 * décalage d'un jour sur les fuseaux négatifs.
 */
export function formatFrenchDate(date: Date | string): string {
  const d = toUTCDate(date);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Formate une date+heure en locale française.
 *
 * Exemple : `new Date("2026-12-31T14:30:00Z")` → `"31 déc. 2026, 14:30"`
 */
export function formatFrenchDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Convertit une chaîne ou une Date en Date UTC.
 *
 * Les chaînes de la forme YYYY-MM-DD sont traitées en UTC (ajout du suffixe
 * T00:00:00Z) pour éviter le glissement d'un jour sur les fuseaux négatifs.
 * Les autres chaînes et les Date instances sont passées telles quelles.
 */
function toUTCDate(date: Date | string): Date {
  if (date instanceof Date) return date;
  // Chaîne date seule (YYYY-MM-DD) sans information de fuseau
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T00:00:00Z`);
  }
  return new Date(date);
}
