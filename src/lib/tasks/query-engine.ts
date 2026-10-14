/**
 * Moteur de filtres, tris et regroupements — fonctions pures, client-safe.
 *
 * Les vues (Liste, Tableau, Calendrier, Chronologie, Mes tâches) appliquent
 * toutes la même configuration aux mêmes `TaskItem` : un filtre posé dans la
 * Liste vaut pour le Tableau. Le serveur ne fait confiance à rien de ce qui
 * est calculé ici — la sélection des tâches *visibles* est faite en amont par
 * la base, selon les permissions ; ce module ne fait que trier l'affichage.
 */

import { z } from "zod";

import { PRIORITY_LABELS, PRIORITY_RANK, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "./constants";
import { addDays, isoWeekday } from "./recurrence";
import type {
  CustomFieldDef,
  CustomFieldValue,
  SectionItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserRef,
} from "./types";

export type DueFilter = "overdue" | "today" | "this_week" | "next_7" | "no_date" | "has_date";
export type CompletionFilter = "incomplete" | "all" | "completed";

export interface CustomFilter {
  fieldId: string;
  op: "eq" | "contains" | "gt" | "lt" | "set" | "unset" | "any_of";
  value?: string | number | boolean | string[] | null;
}

export interface TaskFilters {
  search?: string;
  /** Ids d'utilisateurs, `"none"` (non affectée), `"me"`. */
  assigneeIds?: string[];
  projectIds?: string[];
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  tagIds?: string[];
  due?: DueFilter | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  custom?: CustomFilter[];
  completion?: CompletionFilter;
  blockedOnly?: boolean;
  milestonesOnly?: boolean;
}

export type SortKey =
  | "manual"
  | "due"
  | "start"
  | "priority"
  | "title"
  | "created"
  | "assignee"
  | "status"
  | `field:${string}`;

export type GroupKey =
  | "section"
  | "status"
  | "priority"
  | "assignee"
  | "due"
  | "project"
  | "none"
  | `field:${string}`;

export interface ViewConfig {
  filters: TaskFilters;
  sort: { key: SortKey; dir: "asc" | "desc" };
  group: GroupKey;
  /** Colonnes visibles de la vue Liste, dans l'ordre. */
  columns?: string[];
}

const sortKeySchema = z
  .string()
  .regex(/^(manual|due|start|priority|title|created|assignee|status|field:[0-9a-f-]{36})$/);
const groupKeySchema = z
  .string()
  .regex(/^(section|status|priority|assignee|due|project|none|field:[0-9a-f-]{36})$/);
const idList = z.array(z.string().max(64)).max(200);

/** Validation d'une configuration de vue venue du client (vues enregistrées). */
export const viewConfigSchema = z.object({
  filters: z
    .object({
      search: z.string().max(200).optional(),
      assigneeIds: idList.optional(),
      projectIds: idList.optional(),
      statuses: z.array(z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]])).optional(),
      priorities: z.array(z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]])).optional(),
      tagIds: idList.optional(),
      due: z.enum(["overdue", "today", "this_week", "next_7", "no_date", "has_date"]).nullable().optional(),
      dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      custom: z
        .array(
          z.object({
            fieldId: z.uuid(),
            op: z.enum(["eq", "contains", "gt", "lt", "set", "unset", "any_of"]),
            value: z
              .union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(64)).max(50), z.null()])
              .optional(),
          }),
        )
        .max(20)
        .optional(),
      completion: z.enum(["incomplete", "all", "completed"]).optional(),
      blockedOnly: z.boolean().optional(),
      milestonesOnly: z.boolean().optional(),
    })
    .default({}),
  sort: z
    .object({ key: sortKeySchema, dir: z.enum(["asc", "desc"]) })
    .default({ key: "manual", dir: "asc" }),
  group: groupKeySchema.default("section"),
  columns: z.array(z.string().max(64)).max(40).optional(),
});

export const DEFAULT_VIEW: ViewConfig = {
  filters: { completion: "incomplete" },
  sort: { key: "manual", dir: "asc" },
  group: "section",
};

export interface QueryContext {
  today: string;
  meId: string;
  fields: ReadonlyMap<string, CustomFieldDef>;
  users?: ReadonlyMap<string, UserRef>;
  /** Projet courant : la section et l'ordre manuel sont lus dans cette appartenance. */
  projectId?: string | null;
  /** Tâches dont la description complète contient la recherche (réponse du serveur). */
  searchMatches?: ReadonlySet<string> | null;
}

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function endOfWeek(today: string): string {
  return addDays(today, 7 - isoWeekday(today));
}

function matchesDue(task: TaskItem, filters: TaskFilters, ctx: QueryContext): boolean {
  const due = task.dueDate;
  if (filters.dueFrom && (!due || due < filters.dueFrom)) return false;
  if (filters.dueTo && (!due || due > filters.dueTo)) return false;
  switch (filters.due) {
    case undefined:
    case null:
      return true;
    case "overdue":
      return Boolean(due && due < ctx.today && task.status !== "DONE");
    case "today":
      return due === ctx.today;
    case "this_week":
      return Boolean(due && due >= ctx.today && due <= endOfWeek(ctx.today));
    case "next_7":
      return Boolean(due && due >= ctx.today && due <= addDays(ctx.today, 7));
    case "no_date":
      return !due;
    case "has_date":
      return Boolean(due);
  }
}

function matchesCustom(value: CustomFieldValue | undefined, filter: CustomFilter): boolean {
  const empty =
    value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  switch (filter.op) {
    case "set":
      return !empty;
    case "unset":
      return empty;
    case "eq":
      if (Array.isArray(value)) return typeof filter.value === "string" && value.includes(filter.value);
      return value === filter.value;
    case "contains":
      return typeof value === "string" && typeof filter.value === "string"
        ? normalize(value).includes(normalize(filter.value))
        : false;
    case "gt":
      return (typeof value === "number" && typeof filter.value === "number" && value > filter.value) ||
        (typeof value === "string" && typeof filter.value === "string" && value > filter.value);
    case "lt":
      return (typeof value === "number" && typeof filter.value === "number" && value < filter.value) ||
        (typeof value === "string" && typeof filter.value === "string" && value < filter.value);
    case "any_of": {
      const wanted = Array.isArray(filter.value) ? filter.value : [];
      if (wanted.length === 0) return true;
      if (Array.isArray(value)) return value.some((v) => wanted.includes(v));
      return typeof value === "string" && wanted.includes(value);
    }
  }
}

export function matchesFilters(task: TaskItem, filters: TaskFilters, ctx: QueryContext): boolean {
  const completion = filters.completion ?? "incomplete";
  if (completion === "incomplete" && task.status === "DONE") return false;
  if (completion === "completed" && task.status !== "DONE") return false;

  if (filters.search?.trim()) {
    const needle = normalize(filters.search.trim());
    // Titre et extrait locaux, ou correspondance trouvée par le serveur dans
    // la description complète (`searchMatches`).
    const local = normalize(`${task.title} ${task.excerpt}`).includes(needle);
    if (!local && !ctx.searchMatches?.has(task.id)) return false;
  }

  if (filters.assigneeIds?.length) {
    const wanted = filters.assigneeIds.map((id) => (id === "me" ? ctx.meId : id));
    const ok = task.assigneeId ? wanted.includes(task.assigneeId) : wanted.includes("none");
    if (!ok) return false;
  }

  if (filters.projectIds?.length) {
    if (!task.memberships.some((m) => filters.projectIds!.includes(m.projectId))) return false;
  }

  if (filters.statuses?.length && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities?.length && !filters.priorities.includes(task.priority)) return false;
  if (filters.tagIds?.length && !task.tagIds.some((id) => filters.tagIds!.includes(id))) return false;
  if (filters.blockedOnly && task.openBlockerCount === 0) return false;
  if (filters.milestonesOnly && !task.isMilestone) return false;
  if (!matchesDue(task, filters, ctx)) return false;

  for (const filter of filters.custom ?? []) {
    if (!matchesCustom(task.custom[filter.fieldId], filter)) return false;
  }
  return true;
}

export function membershipFor(task: TaskItem, projectId: string | null | undefined) {
  if (!projectId) return null;
  return task.memberships.find((m) => m.projectId === projectId) ?? null;
}

function compareNullable<T>(a: T | null | undefined, b: T | null | undefined, cmp: (x: T, y: T) => number) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // les valeurs vides passent toujours en dernier
  if (bNull) return -1;
  return cmp(a as T, b as T);
}

const str = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" });
const num = (a: number, b: number) => a - b;

function customSortValue(task: TaskItem, field: CustomFieldDef | undefined): string | number | null {
  if (!field) return null;
  const value = task.custom[field.id];
  if (value === undefined || value === null) return null;
  switch (field.type) {
    case "NUMBER":
      return typeof value === "number" ? value : null;
    case "CHECKBOX":
      return value ? 1 : 0;
    case "SINGLE_SELECT":
      return field.options.findIndex((o) => o.id === value);
    case "MULTI_SELECT":
      return Array.isArray(value) && value.length
        ? field.options.findIndex((o) => o.id === value[0])
        : null;
    default:
      return String(value);
  }
}

export function compareTasksBy(sort: ViewConfig["sort"], ctx: QueryContext) {
  const direction = sort.dir === "desc" ? -1 : 1;
  const manual = (a: TaskItem, b: TaskItem) => {
    if (a.parentId && a.parentId === b.parentId) return a.subtaskPosition - b.subtaskPosition;
    const ma = membershipFor(a, ctx.projectId);
    const mb = membershipFor(b, ctx.projectId);
    if (ma && mb) return ma.position - mb.position;
    return compareNullable(a.dueDate, b.dueDate, str) || str(a.createdAt, b.createdAt);
  };

  return (a: TaskItem, b: TaskItem): number => {
    let result = 0;
    const key = sort.key;
    if (key === "manual") return manual(a, b);
    if (key === "due") result = compareNullable(a.dueDate, b.dueDate, str) || compareNullable(a.dueTime, b.dueTime, str);
    else if (key === "start") result = compareNullable(a.startDate, b.startDate, str);
    else if (key === "priority") result = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    else if (key === "title") result = str(a.title, b.title);
    else if (key === "created") result = str(a.createdAt, b.createdAt);
    else if (key === "status") result = TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status);
    else if (key === "assignee") {
      const name = (id: string | null) => (id ? (ctx.users?.get(id)?.name ?? "") : null);
      result = compareNullable(name(a.assigneeId), name(b.assigneeId), str);
    } else if (key.startsWith("field:")) {
      const field = ctx.fields.get(key.slice(6));
      result = compareNullable(customSortValue(a, field), customSortValue(b, field), (x, y) =>
        typeof x === "number" && typeof y === "number" ? num(x, y) : str(String(x), String(y)),
      );
    }
    return result * direction || manual(a, b);
  };
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: TaskItem[];
  /** Pour un regroupement par section : la section (null = « Sans section »). */
  sectionId?: string | null;
  /** Valeur appliquée à une tâche déposée ou créée dans ce groupe. */
  patch?: Partial<Pick<TaskItem, "status" | "priority" | "assigneeId" | "dueDate">> & {
    custom?: { fieldId: string; value: CustomFieldValue };
  };
}

export const DUE_GROUPS = [
  { key: "overdue", label: "En retard" },
  { key: "today", label: "Aujourd'hui" },
  { key: "upcoming", label: "À venir" },
  { key: "later", label: "Plus tard" },
  { key: "none", label: "Sans échéance" },
] as const;

export function dueBucket(task: TaskItem, today: string): (typeof DUE_GROUPS)[number]["key"] {
  if (!task.dueDate) return "none";
  if (task.dueDate < today) return task.status === "DONE" ? "upcoming" : "overdue";
  if (task.dueDate === today) return "today";
  if (task.dueDate <= addDays(today, 7)) return "upcoming";
  return "later";
}

export function groupTasks(
  tasks: readonly TaskItem[],
  group: GroupKey,
  ctx: QueryContext & { sections?: readonly SectionItem[]; projectNames?: ReadonlyMap<string, string> },
): TaskGroup[] {
  const buckets = new Map<string, TaskGroup>();
  const ensure = (key: string, init: Omit<TaskGroup, "tasks">) => {
    if (!buckets.has(key)) buckets.set(key, { ...init, tasks: [] });
    return buckets.get(key)!;
  };

  switch (group) {
    case "none":
      return [{ key: "all", label: "Tâches", tasks: [...tasks] }];

    case "section": {
      const sections = [...(ctx.sections ?? [])].sort((a, b) => a.position - b.position);
      for (const section of sections) {
        ensure(section.id, { key: section.id, label: section.name, sectionId: section.id });
      }
      for (const task of tasks) {
        const membership = membershipFor(task, ctx.projectId);
        const sectionId = membership?.sectionId ?? null;
        const target =
          sectionId && buckets.has(sectionId)
            ? buckets.get(sectionId)!
            : ensure("__none__", { key: "__none__", label: "Sans section", sectionId: null });
        target.tasks.push(task);
      }
      const ordered = sections.map((s) => buckets.get(s.id)!);
      const orphan = buckets.get("__none__");
      return orphan ? [orphan, ...ordered] : ordered;
    }

    case "status":
      for (const status of TASK_STATUSES) {
        ensure(status, { key: status, label: STATUS_LABELS[status], patch: { status } });
      }
      for (const task of tasks) buckets.get(task.status)!.tasks.push(task);
      return [...buckets.values()];

    case "priority":
      for (const priority of [...TASK_PRIORITIES].reverse()) {
        ensure(priority, { key: priority, label: PRIORITY_LABELS[priority], patch: { priority } });
      }
      for (const task of tasks) buckets.get(task.priority)!.tasks.push(task);
      return [...buckets.values()];

    case "assignee": {
      for (const task of tasks) {
        const id = task.assigneeId;
        const label = id ? (ctx.users?.get(id)?.name ?? "Utilisateur") : "Non affectée";
        ensure(id ?? "none", { key: id ?? "none", label, patch: { assigneeId: id } }).tasks.push(task);
      }
      return [...buckets.values()].sort((a, b) =>
        a.key === "none" ? 1 : b.key === "none" ? -1 : str(a.label, b.label),
      );
    }

    case "due":
      for (const entry of DUE_GROUPS) ensure(entry.key, { key: entry.key, label: entry.label });
      for (const task of tasks) buckets.get(dueBucket(task, ctx.today))!.tasks.push(task);
      return [...buckets.values()].filter((g) => g.tasks.length > 0 || g.key !== "later");

    case "project": {
      for (const task of tasks) {
        if (task.memberships.length === 0) {
          ensure("none", { key: "none", label: "Sans projet" }).tasks.push(task);
        }
        for (const membership of task.memberships) {
          const label = ctx.projectNames?.get(membership.projectId) ?? "Projet";
          ensure(membership.projectId, { key: membership.projectId, label }).tasks.push(task);
        }
      }
      return [...buckets.values()];
    }

    default: {
      const field = ctx.fields.get(group.slice(6));
      if (!field) return [{ key: "all", label: "Tâches", tasks: [...tasks] }];
      if (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") {
        for (const option of field.options) {
          ensure(option.id, {
            key: option.id,
            label: option.label,
            patch: {
              custom: {
                fieldId: field.id,
                value: field.type === "SINGLE_SELECT" ? option.id : [option.id],
              },
            },
          });
        }
      }
      for (const task of tasks) {
        const value = task.custom[field.id];
        const keys =
          Array.isArray(value) && value.length
            ? value
            : value !== null && value !== undefined && value !== ""
              ? [String(value)]
              : ["__empty__"];
        for (const key of keys) {
          const label =
            key === "__empty__"
              ? `Sans ${field.name.toLocaleLowerCase("fr")}`
              : (field.options.find((o) => o.id === key)?.label ??
                (field.type === "CHECKBOX" ? (key === "true" ? "Coché" : "Non coché") : key));
          ensure(key, {
            key,
            label,
            patch: key === "__empty__" ? { custom: { fieldId: field.id, value: null } } : undefined,
          }).tasks.push(task);
        }
      }
      return [...buckets.values()];
    }
  }
}

/** Applique filtres, puis tri, à l'intérieur de chaque groupe. */
export function runQuery(
  tasks: readonly TaskItem[],
  config: ViewConfig,
  ctx: QueryContext & { sections?: readonly SectionItem[]; projectNames?: ReadonlyMap<string, string> },
): TaskGroup[] {
  const filtered = tasks.filter((task) => matchesFilters(task, config.filters, ctx));
  const groups = groupTasks(filtered, config.group, ctx);
  const compare = compareTasksBy(config.sort, ctx);
  for (const group of groups) group.tasks.sort(compare);
  return groups;
}

/** Nombre de filtres actifs (badge du bouton « Filtrer »). */
export function activeFilterCount(filters: TaskFilters): number {
  let count = 0;
  if (filters.assigneeIds?.length) count += 1;
  if (filters.projectIds?.length) count += 1;
  if (filters.statuses?.length) count += 1;
  if (filters.priorities?.length) count += 1;
  if (filters.tagIds?.length) count += 1;
  if (filters.due || filters.dueFrom || filters.dueTo) count += 1;
  if (filters.custom?.length) count += filters.custom.length;
  if (filters.blockedOnly) count += 1;
  if (filters.milestonesOnly) count += 1;
  if (filters.completion && filters.completion !== "incomplete") count += 1;
  return count;
}
