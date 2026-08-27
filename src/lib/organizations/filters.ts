/**
 * Lecture des paramètres d'URL de la liste Organisations.
 *
 * Même logique que le module Contacts : l'URL est la source de vérité de l'état
 * de la liste, les noms de paramètres restent courts, et toute valeur inconnue
 * retombe sur le défaut plutôt que d'atteindre la couche de données.
 *
 *   `?q=` recherche · `?archived=` filtre archivées
 *
 * Fonctions pures, testables.
 */

/** Taille de page. */
export const ORGANIZATIONS_PAGE_SIZE = 20;

/** Bornes de la recherche. */
export const MAX_ORG_SEARCH_LENGTH = 120;

/** Nombre maximal de mots pour la recherche. */
export const MAX_ORG_SEARCH_TOKENS = 5;

export interface OrganizationListParams {
  search: string;
  /** `false` = actives uniquement ; `true` = archivées uniquement. */
  archived: boolean;
  page: number;
}

export const DEFAULT_ORG_LIST_PARAMS: OrganizationListParams = {
  search: "",
  archived: false,
  page: 1,
};

type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

export function parsePage(value: RawParam): number {
  const parsed = Number.parseInt(first(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 10_000);
}

export function parseOrganizationListParams(
  searchParams: Record<string, RawParam>,
): OrganizationListParams {
  return {
    search: first(searchParams.q).slice(0, MAX_ORG_SEARCH_LENGTH).trim(),
    archived: first(searchParams.archived) === "1",
    page: parsePage(searchParams.page),
  };
}

/**
 * Neutralise les jokers `LIKE` — identique au module Contacts.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

export function orgSearchTokens(search: string): string[] {
  return search
    .slice(0, MAX_ORG_SEARCH_LENGTH)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, MAX_ORG_SEARCH_TOKENS);
}

/** Reconstruit une URL de liste en ne gardant que ce qui s'écarte du défaut. */
export function buildOrganizationListHref(
  params: Partial<OrganizationListParams>,
): string {
  const merged = { ...DEFAULT_ORG_LIST_PARAMS, ...params };
  const query = new URLSearchParams();

  if (merged.search) query.set("q", merged.search);
  if (merged.archived) query.set("archived", "1");
  if (merged.page > 1) query.set("page", String(merged.page));

  const search = query.toString();
  return search ? `/organizations?${search}` : "/organizations";
}
