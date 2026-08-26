/**
 * Filtres de la page Tâches.
 *
 * Deux entrées seulement, calquées sur la convention d'URL déjà utilisée par
 * les suivis (`?f=…`) : les tâches terminées ne polluent pas la liste
 * principale, mais elles restent à un clic. Ce n'est pas un système d'archives,
 * et il n'a pas vocation à en devenir un.
 */
export const TASK_FILTERS = [
  { key: "todo", label: "À faire" },
  { key: "done", label: "Terminées" },
] as const;

export type TaskFilter = (typeof TASK_FILTERS)[number]["key"];

const KEYS = TASK_FILTERS.map((filter) => filter.key) as readonly string[];

export function parseTaskFilter(value: string | string[] | undefined): TaskFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return KEYS.includes(raw ?? "") ? (raw as TaskFilter) : "todo";
}
