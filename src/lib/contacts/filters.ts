/**
 * Lecture des paramètres d'URL de la liste Contacts.
 *
 * L'URL est la seule source de vérité de l'état de la liste : elle est
 * partageable, rechargeable, et le bouton « précédent » du navigateur y
 * fonctionne sans code. Les noms restent courts, comme le `?f=` du module
 * Follow-up :
 *
 *   `?q=` recherche · `?org=` organisation · `?fu=` suivi · `?sort=` tri · `?page=`
 *
 * Tout est *parsé*, jamais pris tel quel : une valeur inconnue retombe sur le
 * défaut plutôt que d'atteindre la couche de données.
 *
 * Fonctions pures : testées dans `filters.test.ts`.
 */

export const CONTACT_SORTS = [
  { key: "name-asc", label: "Nom A → Z" },
  { key: "name-desc", label: "Nom Z → A" },
  { key: "recent", label: "Récemment ajoutés" },
  { key: "updated", label: "Récemment modifiés" },
] as const;

export type ContactSort = (typeof CONTACT_SORTS)[number]["key"];

export const CONTACT_FOLLOW_UP_FILTERS = [
  { key: "any", label: "Tous" },
  { key: "active", label: "Avec suivi actif" },
  { key: "none", label: "Sans suivi" },
  { key: "done", label: "Suivis terminés" },
] as const;

export type ContactFollowUpFilter = (typeof CONTACT_FOLLOW_UP_FILTERS)[number]["key"];

/** Valeur réservée du filtre organisation : « les contacts sans organisation ». */
export const NO_ORGANIZATION = "__none__";

/** Taille de page. Une liste lisible, pas un tableur. */
export const CONTACTS_PAGE_SIZE = 20;

/** Bornes de la recherche : au-delà, ce n'est plus une recherche. */
export const MAX_SEARCH_LENGTH = 120;

/** Nombre maximal de mots pris en compte — chacun ajoute une clause SQL. */
export const MAX_SEARCH_TOKENS = 5;

export interface ContactListParams {
  search: string;
  /** `""` = toutes ; `NO_ORGANIZATION` = sans organisation ; sinon le nom exact. */
  organization: string;
  followUp: ContactFollowUpFilter;
  sort: ContactSort;
  page: number;
}

export const DEFAULT_CONTACT_LIST_PARAMS: ContactListParams = {
  search: "",
  organization: "",
  followUp: "any",
  sort: "name-asc",
  page: 1,
};

type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

const SORT_KEYS: readonly string[] = CONTACT_SORTS.map((sort) => sort.key);
const FOLLOW_UP_KEYS: readonly string[] = CONTACT_FOLLOW_UP_FILTERS.map(
  (filter) => filter.key,
);

export function parseContactSort(value: RawParam): ContactSort {
  const raw = first(value);
  return SORT_KEYS.includes(raw) ? (raw as ContactSort) : "name-asc";
}

export function parseContactFollowUpFilter(value: RawParam): ContactFollowUpFilter {
  const raw = first(value);
  return FOLLOW_UP_KEYS.includes(raw) ? (raw as ContactFollowUpFilter) : "any";
}

export function parsePage(value: RawParam): number {
  const parsed = Number.parseInt(first(value), 10);
  // Une page absurde (0, -3, 1e9, « ../ ») retombe sur la première : mieux vaut
  // une liste que l'écran d'erreur d'un `OFFSET` négatif.
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 10_000);
}

/**
 * Découpe la recherche en mots. Chaque mot devra correspondre à *au moins un*
 * champ du contact : « julien doussot » retrouve ainsi la personne, alors
 * qu'aucun champ pris isolément ne contient les deux mots.
 */
export function searchTokens(search: string): string[] {
  return search
    .slice(0, MAX_SEARCH_LENGTH)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, MAX_SEARCH_TOKENS);
}

export function parseContactListParams(
  searchParams: Record<string, RawParam>,
): ContactListParams {
  return {
    search: first(searchParams.q).slice(0, MAX_SEARCH_LENGTH).trim(),
    organization: first(searchParams.org).slice(0, 200).trim(),
    followUp: parseContactFollowUpFilter(searchParams.fu),
    sort: parseContactSort(searchParams.sort),
    page: parsePage(searchParams.page),
  };
}

/** Reconstruit une URL de liste en ne gardant que ce qui s'écarte du défaut. */
export function buildContactListHref(params: Partial<ContactListParams>): string {
  const merged = { ...DEFAULT_CONTACT_LIST_PARAMS, ...params };
  const query = new URLSearchParams();

  if (merged.search) query.set("q", merged.search);
  if (merged.organization) query.set("org", merged.organization);
  if (merged.followUp !== "any") query.set("fu", merged.followUp);
  if (merged.sort !== "name-asc") query.set("sort", merged.sort);
  if (merged.page > 1) query.set("page", String(merged.page));

  const search = query.toString();
  return search ? `/contacts?${search}` : "/contacts";
}
