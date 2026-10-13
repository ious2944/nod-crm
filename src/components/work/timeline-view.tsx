"use client";

import { Ban, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { bulkPatchAction } from "@/app/(app)/tasks/work-actions";
import { COLOR_BAR, colorKey } from "@/lib/tasks/constants";
import { MONTHS_LONG, dayDiff, parts, shortDate } from "@/lib/tasks/format";
import { cascadeShift, dateConflicts, type DatedTask } from "@/lib/tasks/graph";
import type { TaskGroup } from "@/lib/tasks/query-engine";
import { addDays, isoWeekday } from "@/lib/tasks/recurrence";
import type { TaskItem } from "@/lib/tasks/types";

import { useToday } from "./pickers";
import { useWorkApi } from "./store";
import { useTaskOps } from "./task-ops";
import { BTN_SECONDARY, EmptyBlock } from "./ui";

const ROW = 34;
const ZOOMS = { day: 34, week: 14, month: 5 } as const;

type Drag = { id: string; mode: "move" | "start" | "end"; startX: number; delta: number };

/**
 * Chronologie (Gantt). Barres début → échéance, jalons en losange, flèches de
 * dépendance (rouges en cas d'incohérence : la tâche bloquée commence avant
 * la fin de son bloqueur). Glisser une barre la déplace ; glisser un bord
 * change le début ou l'échéance.
 *
 * Aucune tâche dépendante n'est décalée automatiquement : le décalage en
 * cascade n'a lieu que si l'option « Décaler les tâches dépendantes » est
 * cochée, et il est alors annoncé.
 */
export function TimelineView({ groups, color }: { groups: TaskGroup[]; color: string }) {
  const today = useToday();
  const ops = useTaskOps();
  const { openTask, store, run } = useWorkApi();
  const [zoom, setZoom] = useState<keyof typeof ZOOMS>("day");
  const [cascade, setCascade] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const width = ZOOMS[zoom];
  const scroller = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: ({ kind: "group"; label: string; key: string } | { kind: "task"; task: TaskItem })[] = [];
    for (const group of groups) {
      out.push({ kind: "group", label: group.label, key: group.key });
      for (const task of group.tasks) out.push({ kind: "task", task });
    }
    return out;
  }, [groups]);
  const tasks = rows.filter((r): r is { kind: "task"; task: TaskItem } => r.kind === "task").map((r) => r.task);

  const range = useMemo(() => {
    let min = addDays(today, -14);
    let max = addDays(today, 60);
    for (const t of tasks) {
      const s = t.startDate ?? t.dueDate;
      if (s && s < min) min = addDays(s, -7);
      if (t.dueDate && t.dueDate > max) max = addDays(t.dueDate, 21);
    }
    // Aligner sur un lundi.
    min = addDays(min, 1 - isoWeekday(min));
    return { start: min, days: Math.min(dayDiff(min, max) + 1, 1500) };
  }, [tasks, today]);

  const x = (key: string) => dayDiff(range.start, key) * width;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => r.kind === "task" && map.set(r.task.id, i));
    return map;
  }, [rows]);

  const shifted = (task: TaskItem): { start: string | null; due: string | null } => {
    if (!drag || drag.id !== task.id || !drag.delta) return { start: task.startDate, due: task.dueDate };
    const d = drag.delta;
    if (drag.mode === "move") return { start: task.startDate ? addDays(task.startDate, d) : null, due: task.dueDate ? addDays(task.dueDate, d) : null };
    if (drag.mode === "start") {
      const base = task.startDate ?? task.dueDate!;
      const next = addDays(base, d);
      return { start: task.dueDate && next > task.dueDate ? task.dueDate : next, due: task.dueDate };
    }
    const next = addDays(task.dueDate!, d);
    const start = task.startDate;
    return { start, due: start && next < start ? start : next };
  };

  const commit = async (task: TaskItem, next: { start: string | null; due: string | null }) => {
    if (next.start === task.startDate && next.due === task.dueDate) return;
    const startDate = next.start && next.start === next.due && !task.startDate ? null : next.start;
    const updated = await ops.update(task, { startDate, dueDate: next.due });
    if (!updated || !cascade) return;
    const datedMap = new Map<string, DatedTask>();
    for (const t of Object.values(store.state.tasks)) datedMap.set(t.id, { id: t.id, startDate: t.startDate, dueDate: t.dueDate });
    const edges = Object.values(store.state.tasks).flatMap((t) => t.blockedByIds.map((b) => ({ blockingId: b, blockedId: t.id })));
    const moves = cascadeShift(datedMap, edges, task.id);
    if (moves.size === 0) return;
    const items = [...moves.entries()].map(([id, dates]) => ({ id, patch: { startDate: dates.startDate, dueDate: dates.dueDate } }));
    const result = await run(() => bulkPatchAction(items));
    if (result) {
      store.upsertTasks(result.updated);
      store.toast("info", `${result.updated.length} tâche(s) dépendante(s) décalée(s).${result.failed.length ? ` ${result.failed.length} non modifiable(s).` : ""}`);
    }
  };

  const startDrag = (event: React.PointerEvent, task: TaskItem, mode: Drag["mode"]) => {
    if (!task.canEdit || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    let current: Drag = { id: task.id, mode, startX, delta: 0 };
    setDrag(current);
    const move = (e: PointerEvent) => {
      const delta = Math.round((e.clientX - startX) / width);
      if (delta !== current.delta) {
        current = { ...current, delta };
        setDrag(current);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = current.delta;
      setDrag(null);
      if (!d) {
        openTask(task.id);
        return;
      }
      current = { ...current, delta: d };
      void commit(task, shiftedWith(task, current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const shiftedWith = (task: TaskItem, d: Drag) => {
    const saved = drag;
    void saved;
    const delta = d.delta;
    if (d.mode === "move") return { start: task.startDate ? addDays(task.startDate, delta) : null, due: task.dueDate ? addDays(task.dueDate, delta) : null };
    if (d.mode === "start") {
      const next = addDays(task.startDate ?? task.dueDate!, delta);
      return { start: task.dueDate && next > task.dueDate ? task.dueDate : next, due: task.dueDate };
    }
    const next = addDays(task.dueDate!, delta);
    return { start: task.startDate, due: task.startDate && next < task.startDate ? task.startDate : next };
  };

  if (tasks.length === 0) {
    return <EmptyBlock title="Aucune tâche à afficher" description="Ajoutez des tâches avec une date de début et une échéance pour construire la chronologie." />;
  }

  const days = Array.from({ length: range.days }, (_, i) => addDays(range.start, i));
  const gridWidth = range.days * width;
  const height = rows.length * ROW;

  // Flèches de dépendance.
  const arrows: { from: TaskItem; to: TaskItem; conflict: boolean }[] = [];
  for (const task of tasks) {
    for (const blockerId of task.blockedByIds) {
      const blocker = byId.get(blockerId);
      if (!blocker || !blocker.dueDate || !(task.startDate ?? task.dueDate)) continue;
      arrows.push({ from: blocker, to: task, conflict: dateConflicts(task, [blocker]).length > 0 });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2 text-[12px]">
        <button type="button" className={BTN_SECONDARY} onClick={() => scroller.current?.scrollTo({ left: x(today) - 200, behavior: "smooth" })}>
          Aujourd&apos;hui
        </button>
        <div role="radiogroup" aria-label="Échelle" className="flex rounded-md border border-border-strong p-0.5">
          {(["day", "week", "month"] as const).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)} className={`rounded px-2.5 py-1 font-medium ${zoom === z ? "bg-accent text-accent-contrast" : "text-muted hover:text-ink"}`}>
              {z === "day" ? "Jours" : z === "week" ? "Semaines" : "Mois"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-ink">
          <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} className="accent-[var(--nod-accent)]" />
          Décaler les tâches dépendantes
        </label>
        <span className="flex-1" />
        <span className="hidden items-center gap-3 text-muted sm:flex">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-critical-fg" /> Dépendance incohérente</span>
          <span className="inline-flex items-center gap-1"><Ban className="h-3 w-3 text-critical-fg" /> Bloquée</span>
        </span>
      </div>
      <div ref={scroller} data-scroll className="min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ width: 260 + gridWidth }}>
          {/* Colonne des noms */}
          <div className="sticky left-0 z-[3] w-[260px] shrink-0 border-r border-border-subtle bg-surface">
            <div className="sticky top-0 z-[1] h-12 border-b border-border-subtle bg-surface" />
            {rows.map((row) =>
              row.kind === "group" ? (
                <div key={`g-${row.key}`} className="flex items-center bg-bg/80 px-3 text-[12px] font-semibold text-ink" style={{ height: ROW }}>
                  {row.label}
                </div>
              ) : (
                <button key={row.task.id} type="button" onClick={() => openTask(row.task.id)} className="flex w-full items-center gap-1.5 border-b border-border-subtle/40 px-3 text-left text-[12px] hover:bg-surface-muted" style={{ height: ROW }}>
                  {row.task.openBlockerCount > 0 && <Ban aria-label="Bloquée" className="h-3 w-3 shrink-0 text-critical-fg" />}
                  <span className={`truncate ${row.task.status === "DONE" ? "text-muted line-through" : "text-ink"}`}>{row.task.title}</span>
                </button>
              ),
            )}
          </div>

          {/* Grille */}
          <div className="relative" style={{ width: gridWidth }}>
            <div className="sticky top-0 z-[2] h-12 border-b border-border-subtle bg-surface">
              <div className="relative h-6 text-[11px] font-semibold text-ink">
                {days.map((d) =>
                  parts(d).d === 1 || d === range.start ? (
                    <span key={`m-${d}`} className="absolute top-1 whitespace-nowrap px-1 capitalize" style={{ left: x(d) }}>
                      {MONTHS_LONG[parts(d).m - 1]} {parts(d).y}
                    </span>
                  ) : null,
                )}
              </div>
              <div className="relative h-6 text-[10px] text-muted">
                {days.map((d) =>
                  zoom === "day" || (zoom === "week" && isoWeekday(d) === 1) || (zoom === "month" && isoWeekday(d) === 1 && parts(d).d <= 7) ? (
                    <span key={`d-${d}`} className={`absolute top-1 px-1 tabular-nums ${d === today ? "font-bold text-critical-fg" : ""}`} style={{ left: x(d) }}>
                      {zoom === "day" ? parts(d).d : shortDate(d, today)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            <div className="relative" style={{ height }}>
              {/* Week-ends et lignes */}
              {zoom !== "month" &&
                days.map((d) =>
                  isoWeekday(d) >= 6 ? <div key={`w-${d}`} className="absolute inset-y-0 bg-surface-muted/50" style={{ left: x(d), width }} /> : null,
                )}
              {rows.map((row, i) => (
                <div key={`r-${i}`} className={`absolute inset-x-0 border-b border-border-subtle/40 ${row.kind === "group" ? "bg-bg/60" : ""}`} style={{ top: i * ROW, height: ROW }} />
              ))}
              <div aria-hidden className="absolute inset-y-0 z-[1] w-px bg-critical-fg" style={{ left: x(today) + width / 2 }} />

              {/* Flèches */}
              <svg className="pointer-events-none absolute inset-0 z-[2]" width={gridWidth} height={height} aria-hidden>
                <defs>
                  <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--nod-text-muted)" />
                  </marker>
                  <marker id="arrow-red" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--nod-critical-fg)" />
                  </marker>
                </defs>
                {arrows.map(({ from, to, conflict }) => {
                  const fromDates = shifted(from);
                  const toDates = shifted(to);
                  const x1 = x(fromDates.due!) + width;
                  const y1 = (rowIndex.get(from.id) ?? 0) * ROW + ROW / 2;
                  const x2 = x(toDates.start ?? toDates.due!);
                  const y2 = (rowIndex.get(to.id) ?? 0) * ROW + ROW / 2;
                  const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 16));
                  return (
                    <path
                      key={`${from.id}-${to.id}`}
                      d={`M${x1},${y1} H${mid} V${y2} H${x2 - 1}`}
                      fill="none"
                      stroke={conflict ? "var(--nod-critical-fg)" : "var(--nod-text-muted)"}
                      strokeWidth={conflict ? 1.8 : 1.2}
                      strokeDasharray={conflict ? "4 3" : undefined}
                      markerEnd={`url(#${conflict ? "arrow-red" : "arrow"})`}
                    />
                  );
                })}
              </svg>

              {/* Barres */}
              {rows.map((row, i) => {
                if (row.kind !== "task") return null;
                const task = row.task;
                const dates = shifted(task);
                const top = i * ROW;
                if (!dates.due && !dates.start) {
                  return (
                    <button
                      key={task.id}
                      type="button"
                      disabled={!task.canEdit}
                      onDoubleClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const day = addDays(range.start, Math.floor((e.clientX - rect.left) / width));
                        void ops.update(task, { dueDate: day });
                      }}
                      className="absolute inset-x-0 z-[1] text-left text-[11px] text-muted/0 hover:text-muted"
                      style={{ top, height: ROW }}
                      title="Double-cliquez sur un jour pour planifier"
                    >
                      <span className="sticky left-[270px] px-2">Double-cliquez pour planifier</span>
                    </button>
                  );
                }
                const start = dates.start ?? dates.due!;
                const due = dates.due ?? dates.start!;
                const left = x(start);
                const barWidth = (dayDiff(start, due) + 1) * width;
                const blocked = task.openBlockerCount > 0;
                const conflict = dateConflicts({ id: task.id, startDate: dates.start, dueDate: dates.due }, task.blockedByIds.map((id) => byId.get(id)).filter((t): t is TaskItem => Boolean(t))).length > 0;
                const done = task.status === "DONE";
                if (task.isMilestone) {
                  return (
                    <div key={task.id} className="absolute z-[3] flex items-center" style={{ top, height: ROW, left: x(due) + width / 2 - 8 }}>
                      <button
                        type="button"
                        aria-label={`Jalon ${task.title}, ${shortDate(due, today)}`}
                        onPointerDown={(e) => startDrag(e, task, "end")}
                        className={`h-4 w-4 rotate-45 rounded-[2px] border-2 ${done ? "border-done-fg bg-done-fg" : "border-accent bg-surface"} ${task.canEdit ? "cursor-grab" : ""}`}
                      />
                      <span className="ml-2 whitespace-nowrap text-[11px] font-medium text-ink">{task.title}</span>
                    </div>
                  );
                }
                return (
                  <div key={task.id} className="absolute z-[3] flex items-center" style={{ top: top + 6, height: ROW - 12, left }}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${task.title} : du ${shortDate(start, today)} au ${shortDate(due, today)}`}
                      onPointerDown={(e) => startDrag(e, task, "move")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openTask(task.id);
                        if (!task.canEdit) return;
                        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                          e.preventDefault();
                          const d = e.key === "ArrowRight" ? 1 : -1;
                          void commit(task, e.shiftKey ? { start: task.startDate, due: task.dueDate ? addDays(task.dueDate, d) : null } : { start: task.startDate ? addDays(task.startDate, d) : null, due: task.dueDate ? addDays(task.dueDate, d) : null });
                        }
                      }}
                      className={`group/bar relative h-full touch-none rounded-md text-[11px] font-medium text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${COLOR_BAR[colorKey(color)]} ${done ? "opacity-50" : ""} ${blocked ? "ring-2 ring-critical-fg ring-offset-1 ring-offset-surface" : ""} ${task.canEdit ? "cursor-grab" : ""}`}
                      style={{ width: Math.max(barWidth, width) }}
                      title={task.title}
                    >
                      {task.canEdit && (
                        <>
                          <span aria-hidden onPointerDown={(e) => startDrag(e, task, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-black/20" />
                          <span aria-hidden onPointerDown={(e) => startDrag(e, task, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-black/20" />
                        </>
                      )}
                      <span className="block truncate px-2 leading-[22px]">{barWidth > 60 ? task.title : ""}</span>
                    </div>
                    {(barWidth <= 60 || conflict) && (
                      <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-ink">
                        {conflict && <TriangleAlert aria-label="Dates incohérentes" className="h-3 w-3 text-critical-fg" />}
                        {barWidth <= 60 && task.title}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
