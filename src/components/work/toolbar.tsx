"use client";

import { ArrowUpDown, Columns3, Eye, ListFilter, Plus, Rows3, Save, Search, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { deleteViewAction, saveViewAction } from "@/app/(app)/tasks/work-actions";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";
import { activeFilterCount, type CustomFilter, type GroupKey, type SortKey, type TaskFilters, type ViewConfig } from "@/lib/tasks/query-engine";
import type { CustomFieldDef, TaskPriority, TaskStatus } from "@/lib/tasks/types";

import { allColumns, type ColumnDef } from "./columns";
import { useWork, useWorkApi } from "./store";
import { BTN_GHOST, BTN_PRIMARY, ColorChip, INPUT, MenuList, Popover, type MenuEntry } from "./ui";

export interface SavedViewItem {
  id: string;
  name: string;
  scope: string;
  config: ViewConfig;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "Ordre manuel" },
  { key: "due", label: "Échéance" },
  { key: "start", label: "Date de début" },
  { key: "priority", label: "Priorité" },
  { key: "status", label: "Statut" },
  { key: "assignee", label: "Responsable" },
  { key: "title", label: "Nom" },
  { key: "created", label: "Date de création" },
];

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "section", label: "Section" },
  { key: "status", label: "Statut" },
  { key: "priority", label: "Priorité" },
  { key: "assignee", label: "Responsable" },
  { key: "due", label: "Échéance" },
  { key: "project", label: "Projet" },
  { key: "none", label: "Aucun regroupement" },
];

function ToolButton({ icon: Icon, label, active, onClick, buttonRef, badge }: { icon: typeof Search; label: string; active?: boolean; onClick: () => void; buttonRef?: React.RefObject<HTMLButtonElement | null>; badge?: number }) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-pressed={active} className={`${BTN_GHOST} ${active ? "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent" : ""}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      {badge ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-contrast">{badge}</span> : null}
    </button>
  );
}

export function Toolbar({
  config,
  onChange,
  onAdd,
  addLabel = "Ajouter une tâche",
  fields,
  columns,
  onColumns,
  groupOptions = GROUPS.map((g) => g.key),
  scope,
  savedViews,
  onSavedViewsChange,
  extra,
  showColumns = true,
  showGroup = true,
}: {
  config: ViewConfig;
  onChange: (config: ViewConfig) => void;
  onAdd?: () => void;
  addLabel?: string;
  fields: CustomFieldDef[];
  columns?: string[];
  onColumns?: (ids: string[]) => void;
  groupOptions?: GroupKey[];
  scope?: string;
  savedViews?: SavedViewItem[];
  onSavedViewsChange?: () => void;
  extra?: ReactNode;
  showColumns?: boolean;
  showGroup?: boolean;
}) {
  const [open, setOpen] = useState<"filter" | "sort" | "group" | "columns" | "views" | null>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLButtonElement>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);
  const viewsRef = useRef<HTMLButtonElement>(null);
  const filters = config.filters;
  const setFilters = (next: TaskFilters) => onChange({ ...config, filters: next });
  const completion = filters.completion ?? "incomplete";
  const count = activeFilterCount(filters);

  const fieldGroups: GroupKey[] = fields.filter((f) => f.type === "SINGLE_SELECT" || f.type === "MULTI_SELECT" || f.type === "CHECKBOX").map((f) => `field:${f.id}` as GroupKey);
  const groupItems = [...GROUPS.filter((g) => groupOptions.includes(g.key)), ...fieldGroups.map((key) => ({ key, label: fields.find((f) => f.id === key.slice(6))!.name }))];
  const sortItems = [...SORTS, ...fields.map((f) => ({ key: `field:${f.id}` as SortKey, label: f.name }))];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-3 py-1.5 sm:px-4">
      {onAdd && (
        <button type="button" onClick={onAdd} className={`${BTN_PRIMARY} mr-1`}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      )}
      <div className="relative mr-1 min-w-36 flex-1 sm:max-w-64">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          value={filters.search ?? ""}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Rechercher…"
          aria-label="Rechercher dans les tâches"
          className={`${INPUT} py-1 pl-7`}
        />
        {filters.search && (
          <button type="button" aria-label="Effacer la recherche" onClick={() => setFilters({ ...filters, search: "" })} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <ToolButton icon={ListFilter} label="Filtrer" buttonRef={filterRef} active={count > 0} badge={count} onClick={() => setOpen("filter")} />
      <ToolButton icon={ArrowUpDown} label={config.sort.key === "manual" ? "Trier" : `Tri : ${sortItems.find((s) => s.key === config.sort.key)?.label ?? ""}`} buttonRef={sortRef} active={config.sort.key !== "manual"} onClick={() => setOpen("sort")} />
      {showGroup && <ToolButton icon={Rows3} label={`Grouper : ${groupItems.find((g) => g.key === config.group)?.label ?? ""}`} buttonRef={groupRef} onClick={() => setOpen("group")} />}
      {showColumns && columns && onColumns && <ToolButton icon={Columns3} label="Colonnes" buttonRef={columnsRef} onClick={() => setOpen("columns")} />}
      <button
        type="button"
        onClick={() => setFilters({ ...filters, completion: completion === "incomplete" ? "all" : completion === "all" ? "completed" : "incomplete" })}
        className={BTN_GHOST}
        aria-label="Afficher les tâches terminées"
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{completion === "incomplete" ? "Non terminées" : completion === "all" ? "Toutes les tâches" : "Terminées uniquement"}</span>
      </button>
      {scope && savedViews && <ToolButton icon={Save} label="Vues" buttonRef={viewsRef} onClick={() => setOpen("views")} badge={savedViews.length || undefined} />}
      <span className="flex-1" />
      {extra}

      <Popover open={open === "filter"} anchor={filterRef} onClose={() => setOpen(null)} label="Filtres">
        <FilterPanel filters={filters} onChange={setFilters} fields={fields} />
      </Popover>
      <Popover open={open === "sort"} anchor={sortRef} onClose={() => setOpen(null)} label="Tri">
        <div className="w-60 py-1">
          <MenuList
            onClose={() => setOpen(null)}
            items={sortItems.map((s): MenuEntry => ({ label: s.label, checked: config.sort.key === s.key, onSelect: () => onChange({ ...config, sort: { key: s.key, dir: config.sort.key === s.key && config.sort.dir === "asc" && s.key !== "manual" ? "desc" : "asc" } }) }))}
          />
          {config.sort.key !== "manual" && (
            <p className="border-t border-border-subtle px-3 pt-1.5 text-[11px] text-muted">
              Ordre {config.sort.dir === "asc" ? "croissant" : "décroissant"} — recliquez pour inverser. Le glisser-déposer n&apos;est disponible qu&apos;en ordre manuel.
            </p>
          )}
        </div>
      </Popover>
      <Popover open={open === "group"} anchor={groupRef} onClose={() => setOpen(null)} label="Regroupement">
        <MenuList onClose={() => setOpen(null)} items={groupItems.map((g): MenuEntry => ({ label: g.label, checked: config.group === g.key, onSelect: () => onChange({ ...config, group: g.key }) }))} />
      </Popover>
      {columns && onColumns && (
        <Popover open={open === "columns"} anchor={columnsRef} onClose={() => setOpen(null)} label="Colonnes">
          <ColumnsPanel all={allColumns(fields)} value={columns} onChange={onColumns} />
        </Popover>
      )}
      {scope && savedViews && (
        <Popover open={open === "views"} anchor={viewsRef} onClose={() => setOpen(null)} label="Vues enregistrées">
          <SavedViewsPanel scope={scope} views={savedViews} config={config} onApply={(c) => { onChange(c); setOpen(null); }} onChanged={() => onSavedViewsChange?.()} />
        </Popover>
      )}
    </div>
  );
}

function Toggle<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T[] | undefined; onChange: (v: T[]) => void; labels: Record<T, string> }) {
  const current = value ?? [];
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = current.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? current.filter((v) => v !== o) : [...current, o])} className={`rounded-full border px-2 py-0.5 text-[12px] ${on ? "border-accent bg-accent-soft text-accent" : "border-border-subtle text-ink hover:bg-surface-muted"}`}>
            {labels[o]}
          </button>
        );
      })}
    </div>
  );
}

export function FilterPanel({ filters, onChange, fields, showProjects = true }: { filters: TaskFilters; onChange: (f: TaskFilters) => void; fields: CustomFieldDef[]; showProjects?: boolean }) {
  const users = useWork((s) => s.context?.users ?? []);
  const tags = useWork((s) => s.context?.tags ?? []);
  const projects = useWork((s) => s.context?.projects ?? []);
  const label = "mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted";
  const userOptions = ["me", "none", ...users.filter((u) => u.isActive).map((u) => u.id)];
  const userLabels = Object.fromEntries([["me", "Moi"], ["none", "Non affectée"], ...users.map((u) => [u.id, u.name])]) as Record<string, string>;
  const custom = filters.custom ?? [];
  const setCustom = (next: CustomFilter[]) => onChange({ ...filters, custom: next });

  return (
    <div className="w-[min(420px,calc(100vw-24px))] space-y-3 p-3">
      <div>
        <p className={label}>Responsable</p>
        <Toggle options={userOptions} value={filters.assigneeIds} onChange={(assigneeIds) => onChange({ ...filters, assigneeIds })} labels={userLabels} />
      </div>
      <div>
        <p className={label}>Statut</p>
        <Toggle options={TASK_STATUSES} value={filters.statuses} onChange={(statuses) => onChange({ ...filters, statuses: statuses as TaskStatus[] })} labels={STATUS_LABELS} />
      </div>
      <div>
        <p className={label}>Priorité</p>
        <Toggle options={[...TASK_PRIORITIES].reverse()} value={filters.priorities} onChange={(priorities) => onChange({ ...filters, priorities: priorities as TaskPriority[] })} labels={PRIORITY_LABELS} />
      </div>
      {tags.length > 0 && (
        <div>
          <p className={label}>Tags</p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => {
              const on = (filters.tagIds ?? []).includes(tag.id);
              return (
                <button key={tag.id} type="button" aria-pressed={on} onClick={() => onChange({ ...filters, tagIds: on ? (filters.tagIds ?? []).filter((id) => id !== tag.id) : [...(filters.tagIds ?? []), tag.id] })} className={`rounded-full ${on ? "ring-2 ring-accent" : ""}`}>
                  <ColorChip color={tag.color}>{tag.name}</ColorChip>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {showProjects && projects.length > 0 && (
        <div>
          <p className={label}>Projet</p>
          <select
            multiple
            aria-label="Projets"
            value={filters.projectIds ?? []}
            onChange={(e) => onChange({ ...filters, projectIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
            className={`${INPUT} h-24`}
          >
            {projects.filter((p) => !p.isTemplate).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <p className={label}>Échéance</p>
        <div className="flex flex-wrap gap-1">
          {([
            [null, "Toutes"],
            ["overdue", "En retard"],
            ["today", "Aujourd'hui"],
            ["this_week", "Cette semaine"],
            ["next_7", "7 prochains jours"],
            ["no_date", "Sans échéance"],
          ] as const).map(([key, text]) => (
            <button key={text} type="button" aria-pressed={(filters.due ?? null) === key} onClick={() => onChange({ ...filters, due: key })} className={`rounded-full border px-2 py-0.5 text-[12px] ${(filters.due ?? null) === key ? "border-accent bg-accent-soft text-accent" : "border-border-subtle hover:bg-surface-muted"}`}>
              {text}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
          du
          <input type="date" aria-label="Échéance à partir du" value={filters.dueFrom ?? ""} onChange={(e) => onChange({ ...filters, dueFrom: e.target.value || null })} className={`${INPUT} w-auto py-1`} />
          au
          <input type="date" aria-label="Échéance jusqu'au" value={filters.dueTo ?? ""} onChange={(e) => onChange({ ...filters, dueTo: e.target.value || null })} className={`${INPUT} w-auto py-1`} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-[12px]">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={Boolean(filters.blockedOnly)} onChange={(e) => onChange({ ...filters, blockedOnly: e.target.checked })} className="accent-[var(--nod-accent)]" />
          Bloquées uniquement
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={Boolean(filters.milestonesOnly)} onChange={(e) => onChange({ ...filters, milestonesOnly: e.target.checked })} className="accent-[var(--nod-accent)]" />
          Jalons uniquement
        </label>
      </div>
      {fields.length > 0 && (
        <div>
          <p className={label}>Champs personnalisés</p>
          <ul className="space-y-1.5">
            {custom.map((filter, index) => {
              const field = fields.find((f) => f.id === filter.fieldId);
              if (!field) return null;
              const replace = (next: CustomFilter) => setCustom(custom.map((f, i) => (i === index ? next : f)));
              return (
                <li key={index} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="font-medium">{field.name}</span>
                  <select aria-label="Opérateur" value={filter.op} onChange={(e) => replace({ ...filter, op: e.target.value as CustomFilter["op"] })} className={`${INPUT} w-auto py-1`}>
                    {(field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT"
                      ? [["any_of", "est l'un de"], ["set", "est renseigné"], ["unset", "est vide"]]
                      : field.type === "NUMBER" || field.type === "DATE"
                        ? [["eq", "="], ["gt", ">"], ["lt", "<"], ["set", "est renseigné"], ["unset", "est vide"]]
                        : field.type === "CHECKBOX"
                          ? [["eq", "est"]]
                          : [["contains", "contient"], ["set", "est renseigné"], ["unset", "est vide"]]
                    ).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                  {filter.op !== "set" && filter.op !== "unset" && (
                    field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT" ? (
                      <span className="flex flex-wrap gap-1">
                        {field.options.map((o) => {
                          const values = Array.isArray(filter.value) ? filter.value : [];
                          const on = values.includes(o.id);
                          return (
                            <button key={o.id} type="button" aria-pressed={on} onClick={() => replace({ ...filter, value: on ? values.filter((v) => v !== o.id) : [...values, o.id] })} className={`rounded-full ${on ? "ring-2 ring-accent" : ""}`}>
                              <ColorChip color={o.color}>{o.label}</ColorChip>
                            </button>
                          );
                        })}
                      </span>
                    ) : field.type === "CHECKBOX" ? (
                      <select aria-label="Valeur" value={String(filter.value ?? true)} onChange={(e) => replace({ ...filter, value: e.target.value === "true" })} className={`${INPUT} w-auto py-1`}>
                        <option value="true">coché</option>
                        <option value="false">non coché</option>
                      </select>
                    ) : (
                      <input
                        aria-label="Valeur"
                        type={field.type === "DATE" ? "date" : "text"}
                        inputMode={field.type === "NUMBER" ? "decimal" : undefined}
                        value={filter.value === null || filter.value === undefined ? "" : String(filter.value)}
                        onChange={(e) => replace({ ...filter, value: field.type === "NUMBER" ? (e.target.value === "" ? null : Number(e.target.value.replace(",", "."))) : e.target.value })}
                        className={`${INPUT} w-32 py-1`}
                      />
                    )
                  )}
                  <button type="button" aria-label="Retirer ce filtre" onClick={() => setCustom(custom.filter((_, i) => i !== index))} className="text-muted hover:text-ink">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          <select
            aria-label="Ajouter un filtre de champ"
            value=""
            onChange={(e) => {
              const field = fields.find((f) => f.id === e.target.value);
              if (!field) return;
              const op: CustomFilter["op"] = field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT" ? "any_of" : field.type === "TEXT" ? "contains" : "eq";
              setCustom([...custom, { fieldId: field.id, op, value: field.type === "CHECKBOX" ? true : field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT" ? [] : null }]);
            }}
            className={`${INPUT} mt-1.5 w-auto py-1`}
          >
            <option value="">+ Filtrer par un champ…</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {activeFilterCount(filters) > 0 && (
        <button type="button" onClick={() => onChange({ search: filters.search, completion: "incomplete" })} className="text-[12px] font-medium text-accent hover:underline">
          Réinitialiser les filtres
        </button>
      )}
    </div>
  );
}

function ColumnsPanel({ all, value, onChange }: { all: ColumnDef[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="w-64 p-2">
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Colonnes affichées</p>
      <p className="px-1 pb-2 text-[11px] text-muted">Faites glisser le bord d&apos;un en-tête pour le redimensionner.</p>
      <ul className="max-h-72 overflow-y-auto">
        {all.map((column) => {
          const index = value.indexOf(column.id);
          const on = index !== -1;
          return (
            <li key={column.id} className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-surface-muted">
              <input id={`col-${column.id}`} type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((id) => id !== column.id) : [...value, column.id])} className="accent-[var(--nod-accent)]" />
              <label htmlFor={`col-${column.id}`} className="flex-1 truncate text-[13px]">
                {column.label}
              </label>
              {on && (
                <span className="flex">
                  <button type="button" aria-label={`Monter ${column.label}`} disabled={index === 0} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }} className="px-1 text-muted hover:text-ink disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" aria-label={`Descendre ${column.label}`} disabled={index === value.length - 1} onClick={() => { const next = [...value]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }} className="px-1 text-muted hover:text-ink disabled:opacity-30">
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SavedViewsPanel({ scope, views, config, onApply, onChanged }: { scope: string; views: SavedViewItem[]; config: ViewConfig; onApply: (c: ViewConfig) => void; onChanged: () => void }) {
  const { run } = useWorkApi();
  const [name, setName] = useState("");
  return (
    <div className="w-72 p-2">
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Mes vues enregistrées</p>
      {views.length === 0 && <p className="px-1 py-2 text-[12px] text-muted">Aucune vue. Enregistrez les filtres, le tri et le regroupement actuels.</p>}
      <ul>
        {views.map((view) => (
          <li key={view.id} className="group flex items-center gap-1 rounded hover:bg-surface-muted">
            <button type="button" onClick={() => onApply(view.config)} className="flex-1 truncate px-2 py-1.5 text-left text-[13px]">
              {view.name}
            </button>
            <button type="button" aria-label={`Mettre à jour ${view.name}`} title="Remplacer par la configuration actuelle" onClick={async () => { if (await run(() => saveViewAction(view.id, { name: view.name, scope, config }), "Vue mise à jour.")) onChanged(); }} className="px-1 text-[11px] text-muted opacity-0 hover:text-ink group-hover:opacity-100">
              Mettre à jour
            </button>
            <button type="button" aria-label={`Supprimer ${view.name}`} onClick={async () => { if ((await run(() => deleteViewAction(view.id))) !== null) onChanged(); }} className="px-1 text-muted opacity-0 hover:text-critical-fg group-hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-1 border-t border-border-subtle pt-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (await run(() => saveViewAction(null, { name: name.trim(), scope, config }), "Vue enregistrée.")) {
            setName("");
            onChanged();
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la vue" aria-label="Nom de la nouvelle vue" maxLength={80} className={`${INPUT} py-1`} />
        <button type="submit" className={BTN_PRIMARY}>
          Enregistrer
        </button>
      </form>
    </div>
  );
}
