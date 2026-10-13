"use client";

import { ChevronLeft, ChevronRight, Plus, Repeat, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createTagAction } from "@/app/(app)/tasks/work-actions";
import {
  COLOR_KEYS,
  COLOR_SWATCH,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  colorKey,
} from "@/lib/tasks/constants";
import { MONTHS_LONG, dayDiff, longDate, monthGrid, parts, startOfWeekKey } from "@/lib/tasks/format";
import { addDays, describeRecurrence } from "@/lib/tasks/recurrence";
import type {
  CrmRef,
  CustomFieldDef,
  CustomFieldValue,
  RecurrenceRule,
  TaskPriority,
  TaskRef,
  TaskStatus,
  UserRef,
} from "@/lib/tasks/types";

import { fetchJson, useWork, useWorkApi } from "./store";
import {
  Avatar,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  ColorChip,
  INPUT,
  MenuList,
  Popover,
  PriorityBadge,
  ProjectIcon,
  StatusBadge,
  type Anchor,
} from "./ui";

function normalize(text: string) {
  return text.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/* ─── Utilisateur ─────────────────────────────────────────────────────────── */

export function UserPickerPanel({
  value,
  onSelect,
  allowNone = true,
  multiple = false,
  selected = [],
}: {
  value?: string | null;
  onSelect: (id: string | null) => void;
  allowNone?: boolean;
  multiple?: boolean;
  selected?: string[];
}) {
  const users = useWork((s) => s.context?.users ?? []);
  const me = useWork((s) => s.context?.me.id);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useMemo(() => {
    const q = normalize(query);
    const filtered = users.filter((u) => u.isActive && (!q || normalize(`${u.name} ${u.email}`).includes(q)));
    return filtered.sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name, "fr")));
  }, [users, query, me]);
  const options: (UserRef | null)[] = allowNone && !multiple ? [null, ...list] : list;

  return (
    <div className="w-64 p-1.5">
      <div className="relative mb-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && options[active] !== undefined) {
              e.preventDefault();
              onSelect(options[active]?.id ?? null);
            }
          }}
          placeholder="Nom ou e-mail"
          aria-label="Rechercher une personne"
          className={`${INPUT} pl-7`}
        />
      </div>
      <ul role="listbox" aria-label="Personnes" className="max-h-64 overflow-y-auto">
        {options.map((user, index) => {
          const isSelected = multiple ? Boolean(user && selected.includes(user.id)) : (user?.id ?? null) === (value ?? null);
          return (
            <li key={user?.id ?? "none"}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onClick={() => onSelect(user?.id ?? null)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] ${index === active ? "bg-surface-muted" : ""}`}
              >
                <Avatar user={user} size={20} />
                <span className="min-w-0 flex-1 truncate">
                  {user ? (
                    <>
                      {user.name}
                      {user.id === me && <span className="text-muted"> (moi)</span>}
                    </>
                  ) : (
                    <span className="text-muted">Personne</span>
                  )}
                </span>
                {isSelected && <span className="text-accent">✓</span>}
              </button>
            </li>
          );
        })}
        {options.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted">Aucun résultat</li>}
      </ul>
    </div>
  );
}

export function UserPicker({
  value,
  onChange,
  disabled,
  children,
  label = "Responsable",
  className = "",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={className}
      >
        {children}
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label={label}>
        <UserPickerPanel
          value={value}
          onSelect={(id) => {
            setOpen(false);
            if (id !== value) onChange(id);
          }}
        />
      </Popover>
    </>
  );
}

/* ─── Statut / priorité ───────────────────────────────────────────────────── */

export function StatusPicker({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={`Statut : ${STATUS_LABELS[value]}`} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className={className}>
        <StatusBadge status={value} />
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Statut">
        <MenuList
          onClose={() => setOpen(false)}
          items={TASK_STATUSES.map((s) => ({ label: STATUS_LABELS[s], checked: s === value, onSelect: () => s !== value && onChange(s) }))}
        />
      </Popover>
    </>
  );
}

export function PriorityPicker({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={`Priorité : ${PRIORITY_LABELS[value]}`} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className={className}>
        <PriorityBadge priority={value} />
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Priorité">
        <MenuList
          onClose={() => setOpen(false)}
          items={[...TASK_PRIORITIES].reverse().map((p) => ({ label: PRIORITY_LABELS[p], checked: p === value, onSelect: () => p !== value && onChange(p) }))}
        />
      </Popover>
    </>
  );
}

/* ─── Calendrier ──────────────────────────────────────────────────────────── */

export function MiniCalendar({
  value,
  rangeStart,
  onPick,
  today,
}: {
  value: string | null;
  rangeStart?: string | null;
  onPick: (key: string) => void;
  today: string;
}) {
  const initial = parts(value ?? today);
  const [cursor, setCursor] = useState({ y: initial.y, m: initial.m });
  const days = monthGrid(cursor.y, cursor.m);
  const shift = (delta: number) =>
    setCursor((c) => {
      const total = c.y * 12 + (c.m - 1) + delta;
      return { y: Math.floor(total / 12), m: (total % 12) + 1 };
    });

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" aria-label="Mois précédent" onClick={() => shift(-1)} className="rounded p-1 text-muted hover:bg-surface-muted">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-semibold capitalize">
          {MONTHS_LONG[cursor.m - 1]} {cursor.y}
        </span>
        <button type="button" aria-label="Mois suivant" onClick={() => shift(1)} className="rounded p-1 text-muted hover:bg-surface-muted">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-muted">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div role="grid" aria-label="Calendrier" className="grid grid-cols-7 gap-px">
        {days.map((key) => {
          const inMonth = parts(key).m === cursor.m;
          const selected = key === value;
          const inRange = rangeStart && value && key >= rangeStart && key <= value;
          return (
            <button
              key={key}
              type="button"
              aria-label={longDate(key)}
              aria-pressed={selected}
              onClick={() => onPick(key)}
              className={`h-8 rounded text-[12px] tabular-nums transition-colors ${
                selected
                  ? "bg-accent font-semibold text-accent-contrast"
                  : inRange
                    ? "bg-accent-soft text-accent"
                    : key === today
                      ? "font-semibold text-critical-fg hover:bg-surface-muted"
                      : inMonth
                        ? "text-ink hover:bg-surface-muted"
                        : "text-muted/50 hover:bg-surface-muted"
              }`}
            >
              {parts(key).d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DateValue {
  dueDate: string | null;
  startDate: string | null;
  dueTime: string | null;
}

/** Échéance, début facultatif, heure facultative — en un seul panneau. */
export function DatePanel({
  value,
  onChange,
  onClose,
  allowStart = true,
  allowTime = true,
  recurrence,
  onRecurrence,
}: {
  value: DateValue;
  onChange: (next: DateValue) => void;
  onClose: () => void;
  allowStart?: boolean;
  allowTime?: boolean;
  recurrence?: RecurrenceRule | null;
  onRecurrence?: (rule: RecurrenceRule | null) => void;
}) {
  const today = useWork((s) => s.context?.today) ?? new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<DateValue>(value);
  const [editingStart, setEditingStart] = useState(false);
  const [showStart, setShowStart] = useState(Boolean(value.startDate));
  const [showRecurrence, setShowRecurrence] = useState(false);
  const nextMonday = addDays(startOfWeekKey(today), 7);

  const apply = (next: DateValue) => {
    if (next.startDate && next.dueDate && next.startDate > next.dueDate) {
      next = { ...next, startDate: next.dueDate };
    }
    setDraft(next);
  };

  const pick = (key: string) => {
    if (editingStart) {
      apply({ ...draft, startDate: key, dueDate: draft.dueDate && draft.dueDate < key ? key : draft.dueDate });
      setEditingStart(false);
    } else {
      apply({ ...draft, dueDate: key });
    }
  };

  return (
    <div className="w-72 p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {[
          { label: "Aujourd'hui", key: today },
          { label: "Demain", key: addDays(today, 1) },
          { label: "Lundi prochain", key: nextMonday },
        ].map((q) => (
          <button key={q.label} type="button" onClick={() => apply({ ...draft, dueDate: q.key })} className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-ink hover:bg-surface-muted">
            {q.label}
          </button>
        ))}
      </div>

      {allowStart && (
        <div className="mb-2 grid grid-cols-2 gap-2 text-[12px]">
          {showStart ? (
            <button
              type="button"
              onClick={() => setEditingStart(true)}
              className={`rounded-md border px-2 py-1 text-left ${editingStart ? "border-accent ring-2 ring-accent/20" : "border-border-strong"}`}
            >
              <span className="block text-[10px] uppercase text-muted">Début</span>
              {draft.startDate ? draft.startDate.split("-").reverse().join("/") : "—"}
            </button>
          ) : (
            <button type="button" onClick={() => { setShowStart(true); setEditingStart(true); }} className="rounded-md border border-dashed border-border-strong px-2 py-1 text-left text-muted hover:text-ink">
              + Date de début
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditingStart(false)}
            className={`rounded-md border px-2 py-1 text-left ${!editingStart ? "border-accent ring-2 ring-accent/20" : "border-border-strong"}`}
          >
            <span className="block text-[10px] uppercase text-muted">Échéance</span>
            {draft.dueDate ? draft.dueDate.split("-").reverse().join("/") : "—"}
          </button>
        </div>
      )}

      <MiniCalendar value={editingStart ? draft.startDate : draft.dueDate} rangeStart={editingStart ? null : draft.startDate} onPick={pick} today={today} />

      {allowTime && (
        <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
          Heure
          <input
            type="time"
            value={draft.dueTime ?? ""}
            disabled={!draft.dueDate}
            onChange={(e) => apply({ ...draft, dueTime: e.target.value || null })}
            className={`${INPUT} w-28`}
          />
          {draft.dueTime && (
            <button type="button" aria-label="Retirer l'heure" onClick={() => apply({ ...draft, dueTime: null })} className="text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      )}

      {onRecurrence && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          <button type="button" onClick={() => setShowRecurrence((v) => !v)} className="flex w-full items-center gap-2 text-left text-[12px] text-ink hover:text-accent">
            <Repeat className="h-3.5 w-3.5 text-muted" />
            {describeRecurrence(recurrence ?? null)}
          </button>
          {showRecurrence && <RecurrenceEditor value={recurrence ?? null} onChange={onRecurrence} dueDate={draft.dueDate} />}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className={BTN_GHOST} onClick={() => apply({ dueDate: null, startDate: null, dueTime: null })}>
          Effacer
        </button>
        <div className="flex gap-1.5">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  disabled,
  children,
  className = "",
  label = "Dates",
  recurrence,
  onRecurrence,
  allowStart = true,
  allowTime = true,
}: {
  value: DateValue;
  onChange: (next: DateValue) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  label?: string;
  recurrence?: RecurrenceRule | null;
  onRecurrence?: (rule: RecurrenceRule | null) => void;
  allowStart?: boolean;
  allowTime?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className={className}>
        {children}
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label={label}>
        <DatePanel value={value} onChange={onChange} onClose={() => setOpen(false)} recurrence={recurrence} onRecurrence={onRecurrence} allowStart={allowStart} allowTime={allowTime} />
      </Popover>
    </>
  );
}

const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

export function RecurrenceEditor({
  value,
  onChange,
  dueDate,
}: {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  dueDate: string | null;
}) {
  const rule = value ?? { freq: "WEEKLY" as const, interval: 1, weekdays: [] };
  return (
    <div className="mt-2 space-y-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label="Fréquence"
          value={value ? value.freq : "NONE"}
          onChange={(e) => {
            const freq = e.target.value;
            if (freq === "NONE") onChange(null);
            else onChange({ freq: freq as RecurrenceRule["freq"], interval: value?.interval ?? 1, weekdays: freq === "WEEKLY" ? (value?.weekdays ?? []) : undefined, monthDay: freq === "MONTHLY" ? (dueDate ? parts(dueDate).d : null) : null });
          }}
          className={`${INPUT} w-auto`}
        >
          <option value="NONE">Ne se répète pas</option>
          <option value="DAILY">Quotidienne</option>
          <option value="WEEKLY">Hebdomadaire</option>
          <option value="MONTHLY">Mensuelle</option>
          <option value="YEARLY">Annuelle</option>
        </select>
        {value && (
          <label className="flex items-center gap-1 text-muted">
            tous les
            <input
              type="number"
              min={1}
              max={365}
              value={rule.interval}
              onChange={(e) => onChange({ ...rule, interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              className={`${INPUT} w-14`}
              aria-label="Intervalle"
            />
            {rule.freq === "DAILY" ? "jour(s)" : rule.freq === "WEEKLY" ? "semaine(s)" : rule.freq === "MONTHLY" ? "mois" : "an(s)"}
          </label>
        )}
      </div>
      {value?.freq === "WEEKLY" && (
        <div role="group" aria-label="Jours de la semaine" className="flex gap-1">
          {WEEKDAY_LETTERS.map((letter, i) => {
            const day = i + 1;
            const on = (rule.weekdays ?? []).includes(day);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                aria-label={["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][i]}
                onClick={() => onChange({ ...rule, weekdays: on ? (rule.weekdays ?? []).filter((d) => d !== day) : [...(rule.weekdays ?? []), day].sort() })}
                className={`h-6 w-6 rounded-full text-[11px] font-semibold ${on ? "bg-accent text-accent-contrast" : "bg-surface-muted text-muted"}`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}
      {value?.freq === "MONTHLY" && (
        <label className="flex items-center gap-1 text-muted">
          le
          <input
            type="number"
            min={1}
            max={31}
            value={rule.monthDay ?? ""}
            onChange={(e) => onChange({ ...rule, monthDay: e.target.value ? Math.max(1, Math.min(31, Number(e.target.value))) : null })}
            className={`${INPUT} w-14`}
            aria-label="Jour du mois"
          />
          du mois
        </label>
      )}
      {value && <p className="text-muted">L&apos;occurrence suivante est créée quand la tâche est terminée.</p>}
    </div>
  );
}

/* ─── Tags ────────────────────────────────────────────────────────────────── */

export function TagPickerPanel({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useWork((s) => s.context?.tags ?? []);
  const { store, run } = useWorkApi();
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string>("slate");
  const filtered = tags.filter((t) => !query || normalize(t.name).includes(normalize(query)));
  const exact = tags.some((t) => normalize(t.name) === normalize(query.trim()));

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    const tag = await run(() => createTagAction({ name, color }));
    if (tag && store.state.context) {
      store.setContext({ ...store.state.context, tags: [...store.state.context.tags.filter((t) => t.id !== tag.id), tag].sort((a, b) => a.name.localeCompare(b.name, "fr")) });
      onChange([...value, tag.id]);
      setQuery("");
    }
  };

  return (
    <div className="w-64 p-1.5">
      <input
        data-autofocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[0] && query) {
              const id = filtered[0].id;
              onChange(value.includes(id) ? value : [...value, id]);
              setQuery("");
            } else void create();
          }
        }}
        placeholder="Rechercher ou créer un tag"
        aria-label="Tag"
        className={INPUT}
      />
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {filtered.map((tag) => {
          const on = value.includes(tag.id);
          return (
            <li key={tag.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((id) => id !== tag.id) : [...value, tag.id])}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-muted"
              >
                <ColorChip color={tag.color}>{tag.name}</ColorChip>
                <span className="flex-1" />
                {on && <span className="text-accent">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.trim() && !exact && (
        <div className="mt-1 border-t border-border-subtle pt-1.5">
          <div className="mb-1 flex flex-wrap gap-1 px-1">
            {COLOR_KEYS.map((key) => (
              <button key={key} type="button" aria-label={`Couleur ${key}`} aria-pressed={color === key} onClick={() => setColor(key)} className={`h-4 w-4 rounded-full ${COLOR_SWATCH[key]} ${color === key ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""}`} />
            ))}
          </div>
          <button type="button" onClick={create} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-accent hover:bg-surface-muted">
            <Plus className="h-3.5 w-3.5" /> Créer « {query.trim()} »
          </button>
        </div>
      )}
    </div>
  );
}

export function TagList({ ids, max = 3 }: { ids: string[]; max?: number }) {
  const tags = useWork((s) => s.context?.tags ?? []);
  const shown = ids.map((id) => tags.find((t) => t.id === id)).filter(Boolean).slice(0, max);
  if (!shown.length) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {shown.map((tag) => (
        <ColorChip key={tag!.id} color={tag!.color}>
          {tag!.name}
        </ColorChip>
      ))}
      {ids.length > max && <span className="text-[11px] text-muted">+{ids.length - max}</span>}
    </span>
  );
}

/* ─── Projet et section ───────────────────────────────────────────────────── */

export function ProjectSectionPanel({
  onPick,
  excludeProjectIds = [],
  title = "Choisir un projet",
}: {
  onPick: (projectId: string, sectionId: string | null) => void;
  excludeProjectIds?: string[];
  title?: string;
}) {
  const projects = useWork((s) => s.context?.projects ?? []);
  const sectionsCache = useWork((s) => s.sections);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [fetched, setSections] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = chosen ? (sectionsCache[chosen] ?? fetched) : null;
  const list = projects.filter((p) => p.canEdit && !p.archived && !p.isTemplate && !excludeProjectIds.includes(p.id) && (!query || normalize(p.name).includes(normalize(query))));

  useEffect(() => {
    if (!chosen || sectionsCache[chosen]) return;
    let cancelled = false;
    fetchJson<{ sections: { id: string; name: string }[] }>(`/api/tasks/projects/${chosen}`)
      .then((data) => !cancelled && setSections(data.sections))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Erreur"));
    return () => {
      cancelled = true;
    };
  }, [chosen, sectionsCache]);

  if (chosen) {
    const project = projects.find((p) => p.id === chosen);
    return (
      <div className="w-64 p-1.5">
        <button type="button" onClick={() => { setChosen(null); setSections(null); }} className="mb-1 flex items-center gap-1 px-1 text-[12px] text-muted hover:text-ink">
          <ChevronLeft className="h-3.5 w-3.5" /> {project?.name}
        </button>
        {error && <p className="px-2 py-2 text-[12px] text-critical-fg">{error}</p>}
        {!sections && !error && <p className="px-2 py-2 text-[12px] text-muted">Chargement…</p>}
        <ul>
          {sections?.map((s, i) => (
            <li key={s.id}>
              <button type="button" data-autofocus={i === 0 ? "" : undefined} onClick={() => onPick(chosen, s.id)} className="w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted">
                {s.name}
              </button>
            </li>
          ))}
          {sections && (
            <li>
              <button type="button" onClick={() => onPick(chosen, null)} className="w-full rounded px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface-muted">
                Sans section
              </button>
            </li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="w-64 p-1.5">
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un projet" aria-label="Projet" className={INPUT} />
      <ul className="mt-1 max-h-60 overflow-y-auto">
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setChosen(p.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted">
              <ProjectIcon icon={p.icon} color={p.color} size={18} />
              <span className="flex-1 truncate">{p.name}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted">Aucun projet modifiable</li>}
      </ul>
    </div>
  );
}

/* ─── Fiches CRM ──────────────────────────────────────────────────────────── */

export const CRM_LABELS = { contact: "Contact", organization: "Organisation", opportunity: "Opportunité" } as const;

export function CrmPickerPanel({ kind, onPick }: { kind: keyof typeof CRM_LABELS; onPick: (ref: CrmRef) => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CrmRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchJson<{ items: CrmRef[] }>(`/api/tasks/crm?kind=${kind}&q=${encodeURIComponent(query)}`)
        .then((data) => !cancelled && setItems(data.items))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Erreur"));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);
  return (
    <div className="w-64 p-1.5">
      <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Rechercher : ${CRM_LABELS[kind].toLowerCase()}`} aria-label={CRM_LABELS[kind]} className={INPUT} />
      {error && <p className="px-2 py-2 text-[12px] text-critical-fg">{error}</p>}
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {items?.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onPick(item)} className="w-full truncate rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted">
              {item.label}
            </button>
          </li>
        ))}
        {items && items.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted">Aucun résultat</li>}
      </ul>
    </div>
  );
}

/* ─── Tâches (dépendances, parente) ───────────────────────────────────────── */

export function TaskFinderPanel({ onPick, excludeId, placeholder = "Rechercher une tâche" }: { onPick: (task: TaskRef) => void; excludeId?: string; placeholder?: string }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<TaskRef[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchJson<{ tasks: TaskRef[] }>(`/api/tasks/find?q=${encodeURIComponent(query)}${excludeId ? `&exclude=${excludeId}` : ""}`)
        .then((data) => !cancelled && setItems(data.tasks))
        .catch(() => !cancelled && setItems([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, excludeId]);
  return (
    <div className="w-72 p-1.5">
      <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={INPUT} />
      <ul className="mt-1 max-h-60 overflow-y-auto">
        {items?.map((task) => (
          <li key={task.id}>
            <button type="button" onClick={() => onPick(task)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted">
              <span className={`min-w-0 flex-1 truncate ${task.status === "DONE" ? "text-muted line-through" : ""}`}>{task.title}</span>
              {task.dueDate && <span className="text-[11px] text-muted">{task.dueDate.split("-").reverse().slice(0, 2).join("/")}</span>}
            </button>
          </li>
        ))}
        {items && items.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted">Aucune tâche</li>}
      </ul>
    </div>
  );
}

/* ─── Champs personnalisés ────────────────────────────────────────────────── */

export function CustomFieldDisplay({ field, value }: { field: CustomFieldDef; value: CustomFieldValue | undefined }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted/50">—</span>;
  }
  switch (field.type) {
    case "CHECKBOX":
      return <span>{value ? "✓" : "—"}</span>;
    case "DATE":
      return <span className="tabular-nums">{String(value).split("-").reverse().join("/")}</span>;
    case "NUMBER":
      return <span className="tabular-nums">{Number(value).toLocaleString("fr-FR")}</span>;
    case "SINGLE_SELECT": {
      const option = field.options.find((o) => o.id === value);
      return option ? <ColorChip color={option.color}>{option.label}</ColorChip> : null;
    }
    case "MULTI_SELECT":
      return (
        <span className="inline-flex flex-wrap gap-1">
          {(value as string[]).map((id) => {
            const option = field.options.find((o) => o.id === id);
            return option ? <ColorChip key={id} color={option.color}>{option.label}</ColorChip> : null;
          })}
        </span>
      );
    default:
      return <span className="truncate">{String(value)}</span>;
  }
}

/** Éditeur compact d'une valeur de champ personnalisé (liste et panneau). */
export function CustomFieldEditor({
  field,
  value,
  onChange,
  disabled,
  anchorClassName = "",
}: {
  field: CustomFieldDef;
  value: CustomFieldValue | undefined;
  onChange: (value: CustomFieldValue) => void;
  disabled?: boolean;
  anchorClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const text = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState<string>(text);
  const [seen, setSeen] = useState(text);
  if (seen !== text && !open) {
    setSeen(text);
    setDraft(text);
  }

  if (field.type === "CHECKBOX") {
    return (
      <input
        type="checkbox"
        aria-label={field.name}
        disabled={disabled}
        checked={Boolean(value)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--nod-accent)]"
      />
    );
  }

  const commitText = () => {
    setOpen(false);
    if (field.type === "NUMBER") {
      const n = draft.trim() === "" ? null : Number(draft.replace(",", "."));
      if (n !== null && !Number.isFinite(n)) return;
      if (n !== value) onChange(n);
    } else if (draft !== (value ?? "")) {
      onChange(draft.trim() || null);
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={field.name}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`min-w-0 text-left ${anchorClassName}`}
      >
        <CustomFieldDisplay field={field} value={value} />
      </button>
      <Popover open={open} anchor={ref as Anchor} onClose={() => (field.type === "TEXT" || field.type === "NUMBER" ? commitText() : setOpen(false))} label={field.name}>
        {field.type === "DATE" ? (
          <div className="w-64 p-3">
            <MiniCalendar
              value={typeof value === "string" ? value : null}
              onPick={(key) => {
                setOpen(false);
                onChange(key);
              }}
              today={new Date().toISOString().slice(0, 10)}
            />
            <button type="button" className={`${BTN_GHOST} mt-2`} onClick={() => { setOpen(false); onChange(null); }}>
              Effacer
            </button>
          </div>
        ) : field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT" ? (
          <div className="w-56 p-1">
            {field.options.map((option, i) => {
              const selected = Array.isArray(value) ? value.includes(option.id) : value === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-autofocus={i === 0 ? "" : undefined}
                  onClick={() => {
                    if (field.type === "SINGLE_SELECT") {
                      setOpen(false);
                      onChange(selected ? null : option.id);
                    } else {
                      const current = Array.isArray(value) ? value : [];
                      onChange(selected ? current.filter((id) => id !== option.id) : [...current, option.id]);
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-muted"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${COLOR_SWATCH[colorKey(option.color)]}`} />
                  <span className="flex-1 truncate text-[13px]">{option.label}</span>
                  {selected && <span className="text-accent">✓</span>}
                </button>
              );
            })}
            <button type="button" onClick={() => { setOpen(false); onChange(null); }} className="w-full rounded px-2 py-1.5 text-left text-[12px] text-muted hover:bg-surface-muted">
              Effacer
            </button>
          </div>
        ) : (
          <div className="w-60 p-2">
            <input
              data-autofocus
              type={field.type === "NUMBER" ? "text" : "text"}
              inputMode={field.type === "NUMBER" ? "decimal" : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitText();
                }
              }}
              aria-label={field.name}
              className={INPUT}
            />
          </div>
        )}
      </Popover>
    </>
  );
}

export function useToday(): string {
  return useWork((s) => s.context?.today) ?? new Date().toISOString().slice(0, 10);
}

export function isOverdue(task: { dueDate: string | null; status: TaskStatus }, today: string) {
  return Boolean(task.dueDate && task.status !== "DONE" && dayDiff(today, task.dueDate) < 0);
}
