/**
 * Logique pure du module Organisations.
 *
 * Ces fonctions ne touchent pas la base et ne dépendent pas du contexte
 * HTTP : elles peuvent être testées unitairement sans infrastructure.
 */

/**
 * Normalise le nom d'une organisation pour la comparaison.
 *
 * Utilisé lors du backfill pour associer les `organization_name` textuels à
 * des organisations existantes.
 */
export function normalizeOrgName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Trie les organisations par nom, insensible à la casse.
 *
 * L'ordre alphabétique est le défaut de la liste : stable, attendu,
 * pas de surprise au rechargement.
 */
export function sortOrganizationsByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    normalizeOrgName(a.name).localeCompare(normalizeOrgName(b.name), "fr"),
  );
}

/**
 * Indique si une organisation peut être rattachée à un contact.
 *
 * Une organisation archivée ne doit pas apparaître dans le sélecteur de contact.
 * Cette règle est appliquée côté requête (filtre `archived_at IS NULL`), mais
 * une fonction pure la documente et la rend testable.
 */
export function isOrganizationSelectable(organization: {
  archivedAt: Date | null;
}): boolean {
  return organization.archivedAt === null;
}

/**
 * Projette les données d'une organisation pour le sélecteur de contact.
 *
 * Identique au pattern des pickers Contact et Follow-Up.
 */
export function toOrganizationPickerLabel(organization: {
  name: string;
  website: string | null;
}): string {
  if (!organization.website) return organization.name;
  const hostname = extractHostname(organization.website);
  return hostname ? `${organization.name} (${hostname})` : organization.name;
}

function extractHostname(website: string): string | null {
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
