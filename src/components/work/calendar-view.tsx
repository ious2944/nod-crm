"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { MONTHS_LONG, WEEKDAYS_SHORT, dayDiff, monthGrid, parts, startOfWeekKey } from "@/lib/tasks/format";
import { addDays } from "@/lib/tasks/recurrence";
import type { TaskItem } from "@/lib/tasks/types";

import { dropIndicator, useDragAndDrop } from "./drag";
import { useToday } from "./pickers";
import { useWorkApi } from "./store";
import { useTaskOps } from "./task-ops";
import { BTN_SECONDARY, CompleteToggle, ICON_BTN } from "./ui";

/**
 * Vue Calendrier (mois / semaine). Une tâche s'affiche sur son échéance —
 * et, en vue semaine, sur toute sa période début → échéance. La déposer sur
 * un autre jour change son échéance (et décale son début du même écart pour
 * conserver la durée). Les tâches sans date sont dans le bac de droite, d'où
 * on peut les glisser sur le calendrier.
 */
export function CalendarView({
  tasks,
  canCreate,
  onCreate,
}: {
  tasks: TaskItem[];
  canCreate: boolean;
  onCreate: (title: string, dueDate: string) => Promise<void>;
}) {
  const today = useToday();
  const ops = useTaskOps();
  const { openTask } = useWorkApi();
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(today);
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const days = useMemo(() => {
    if (mode === "week") {
      const start = startOfWeekKey(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const { y, m } = parts(cursor);
    return monthGrid(y, m);
  }, [cursor, mode]);
  const month = parts(cursor).m;

  const byDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      if (mode === "week" && task.startDate && task.startDate < task.dueDate) {
        for (let key = task.startDate; key <= task.dueDate; key = addDays(key, 1)) {
          map.set(key, [...(map.get(key) ?? []), task]);
          if (dayDiff(task.startDate, key) > 60) break;
        }
      } else {
        map.set(task.dueDate, [...(map.get(task.dueDate) ?? []), task]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.title.localeCompare(b.title, "fr"));
    return map;
  }, [tasks, mode]);
  const undated = tasks.filter((t) => !t.dueDate && t.status !== "DONE");

  const dnd = useDragAndDrop({
    accepts: (_item, target) => target.type === "day" || target.type === "undated",
    onDrop: (item, target) => {
      const task = tasks.find((t) => t.id === item.id);
      if (!task || !task.canEdit) return;
      if (target.type === "undated") {
        if (task.dueDate) void ops.update(task, { dueDate: null, startDate: null });
        return;
      }
      const key = target.id;
      if (task.dueDate === key) return;
      const shift = task.dueDate ? dayDiff(task.dueDate, key) : 0;
      const startDate = task.startDate && task.dueDate ? addDays(task.startDate, shift) : task.startDate && task.startDate > key ? key : task.startDate;
      void ops.update(task, { dueDate: key, startDate });
    },
  });

  const shift = (delta: number) => {
    if (mode === "week") setCursor(addDays(cursor, delta * 7));
    else {
      const { y, m } = parts(cursor);
      const total = y * 12 + (m - 1) + delta;
      setCursor(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`);
    }
  };

  const title_ =
    mode === "month"
      ? `${MONTHS_LONG[month - 1]} ${parts(cursor).y}`
      : `Semaine du ${parts(days[0]).d} ${MONTHS_LONG[parts(days[0]).m - 1]}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2">
        <button type="button" className={BTN_SECONDARY} onClick={() => setCursor(today)}>
          Aujourd&apos;hui
        </button>
        <button type="button" className={ICON_BTN} aria-label="Précédent" onClick={() => shift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className={ICON_BTN} aria-label="Suivant" onClick={() => shift(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <h3 className="text-[15px] font-semibold capitalize text-ink">{title_}</h3>
        <span className="flex-1" />
        <div role="radiogroup" aria-label="Affichage" className="flex rounded-md border border-border-strong p-0.5 text-[12px]">
          {(["month", "week"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded px-2.5 py-1 font-medium ${mode === m ? "bg-accent text-accent-contrast" : "text-muted hover:text-ink"}`}>
              {m === "month" ? "Mois" : "Semaine"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div data-scroll className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-[700px] grid-cols-7 border-l border-border-subtle">
            {WEEKDAYS_SHORT.map((d) => (
              <div key={d} className="sticky top-0 z-[2] border-b border-r border-border-subtle bg-surface px-2 py-1.5 text-[11px] font-semibold uppercase text-muted">
                {d}
              </div>
            ))}
            {days.map((key) => {
              const list = byDay.get(key) ?? [];
              const outside = mode === "month" && parts(key).m !== month;
              return (
                <div
                  key={key}
                  data-drop="day"
                  data-drop-id={key}
                  data-drop-mode="zone"
                  className={`group/day relative flex flex-col border-b border-r border-border-subtle p-1 ${mode === "week" ? "min-h-[60vh]" : "min-h-28"} ${outside ? "bg-surface-muted/40" : "bg-surface"} ${dropIndicator(dnd.over, "day", key)}`}
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className={`grid h-6 min-w-6 place-items-center rounded-full text-[12px] tabular-nums ${key === today ? "bg-critical-fg font-semibold text-white" : outside ? "text-muted/60" : "text-ink"}`}>{parts(key).d}</span>
                    {canCreate && (
                      <button type="button" aria-label={`Ajouter une tâche le ${key}`} onClick={() => { setAdding(key); setTitle(""); }} className={`${ICON_BTN} h-5 w-5 opacity-0 group-hover/day:opacity-100 focus:opacity-100`}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {list.slice(0, mode === "month" ? 4 : 50).map((task) => (
                      <li key={`${task.id}-${key}`}>
                        <CalendarChip task={task} onOpen={() => openTask(task.id)} onToggle={() => void ops.toggleComplete(task)} dnd={dnd} />
                      </li>
                    ))}
                    {mode === "month" && list.length > 4 && (
                      <li>
                        <button type="button" onClick={() => { setMode("week"); setCursor(key); }} className="px-1 text-[11px] font-medium text-accent hover:underline">
                          + {list.length - 4} autre(s)
                        </button>
                      </li>
                    )}
                  </ul>
                  {adding === key && (
                    <input
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={() => setAdding(null)}
                      onKeyDown={async (e) => {
                        if (e.key === "Escape") setAdding(null);
                        if (e.key === "Enter" && title.trim()) {
                          const value = title.trim();
                          setTitle("");
                          setAdding(null);
                          await onCreate(value, key);
                        }
                      }}
                      placeholder="Nom, puis Entrée"
                      aria-label="Nouvelle tâche"
                      className="mt-1 w-full rounded border border-accent bg-surface px-1.5 py-1 text-[12px] outline-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <aside data-drop="undated" data-drop-id="undated" data-drop-mode="zone" aria-label="Tâches sans échéance" className={`hidden w-56 shrink-0 overflow-y-auto border-l border-border-subtle bg-surface p-2 lg:block ${dropIndicator(dnd.over, "undated", "undated")}`}>
          <h4 className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Sans échéance ({undated.length})</h4>
          <p className="px-1 pb-2 text-[11px] text-muted">Glissez une tâche sur un jour pour la planifier.</p>
          <ul className="space-y-0.5">
            {undated.map((task) => (
              <li key={task.id}>
                <CalendarChip task={task} onOpen={() => openTask(task.id)} onToggle={() => void ops.toggleComplete(task)} dnd={dnd} />
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {dnd.overlay}
    </div>
  );
}

function CalendarChip({ task, onOpen, onToggle, dnd }: { task: TaskItem; onOpen: () => void; onToggle: () => void; dnd: ReturnType<typeof useDragAndDrop> }) {
  const done = task.status === "DONE";
  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={(e) => task.canEdit && dnd.start(e, { type: "chip", id: task.id, label: task.title })}
      onClick={(e) => {
        if (dnd.wasDragged() || (e.target as HTMLElement).closest("[role='checkbox']")) return;
        onOpen();
      }}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[12px] leading-tight hover:bg-surface-muted ${
        task.priority === "URGENT" && !done ? "bg-critical-bg/60" : ""
      } ${dnd.dragging?.id === task.id ? "opacity-40" : ""}`}
      title={task.title}
    >
      <CompleteToggle done={done} disabled={!task.canEdit} onToggle={onToggle} label={task.title} size={12} milestone={task.isMilestone} />
      {task.dueTime && <span className="tabular-nums text-muted">{task.dueTime}</span>}
      <span className={`truncate ${done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
    </div>
  );
}
