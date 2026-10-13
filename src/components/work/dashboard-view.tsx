"use client";

import { useMemo } from "react";

import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/constants";
import { minutesLabel, startOfWeekKey, shortDate } from "@/lib/tasks/format";
import { addDays } from "@/lib/tasks/recurrence";
import type { TaskItem } from "@/lib/tasks/types";

import { useToday } from "./pickers";
import { useWork } from "./store";

/**
 * Tableau de bord : tous les indicateurs sont calculés à partir des tâches
 * réellement chargées (les mêmes que la liste), jamais d'une valeur stockée à
 * part. Les barres portent toujours leur valeur en texte : la couleur n'est
 * jamais le seul porteur d'information.
 */

const STATUS_BAR: Record<string, string> = {
  TODO: "bg-calm-fg",
  IN_PROGRESS: "bg-soon-fg",
  WAITING: "bg-today-fg",
  DONE: "bg-done-fg",
};
const PRIORITY_BAR: Record<string, string> = {
  LOW: "bg-calm-fg",
  NORMAL: "bg-soon-fg",
  HIGH: "bg-late-fg",
  URGENT: "bg-critical-fg",
};

export function computeStats(tasks: TaskItem[], today: string) {
  const top = tasks.filter((t) => !t.parentId);
  const done = top.filter((t) => t.status === "DONE");
  const open = top.filter((t) => t.status !== "DONE");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const blocked = open.filter((t) => t.openBlockerCount > 0);
  const estimated = tasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const spent = tasks.reduce((s, t) => s + t.spentMinutes, 0);
  return { top, done, open, overdue, blocked, estimated, spent, progress: top.length ? done.length / top.length : 0 };
}

function Tile({ label, value, tone = "text-ink", hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Bars({ title, rows, max }: { title: string; rows: { label: string; value: number; color: string; detail?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted">Aucune donnée.</p>
      ) : (
        <table className="w-full text-[12px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} title={`${row.label} : ${row.detail ?? row.value}`}>
                <th scope="row" className="w-32 max-w-32 truncate py-1 pr-2 text-left font-normal text-muted">
                  {row.label}
                </th>
                <td className="py-1">
                  <div className="h-3 w-full rounded-sm bg-surface-muted">
                    <div className={`h-3 rounded-r ${row.color}`} style={{ width: `${(row.value / top) * 100}%`, minWidth: row.value ? 3 : 0 }} />
                  </div>
                </td>
                <td className="w-16 py-1 pl-2 text-right tabular-nums text-ink">{row.detail ?? row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function DashboardView({ tasks }: { tasks: TaskItem[] }) {
  const today = useToday();
  const users = useWork((s) => s.context?.users ?? []);
  const stats = useMemo(() => computeStats(tasks, today), [tasks, today]);

  const byAssignee = useMemo(() => {
    const map = new Map<string, { open: number; done: number; estimate: number; spent: number }>();
    for (const t of stats.top) {
      const key = t.assigneeId ?? "none";
      const entry = map.get(key) ?? { open: 0, done: 0, estimate: 0, spent: 0 };
      if (t.status === "DONE") entry.done += 1;
      else {
        entry.open += 1;
        entry.estimate += t.estimatedMinutes ?? 0;
      }
      entry.spent += t.spentMinutes;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, name: id === "none" ? "Non affectées" : (users.find((u) => u.id === id)?.name ?? "Utilisateur"), ...v }))
      .sort((a, b) => b.open - a.open);
  }, [stats.top, users]);

  const weeks = useMemo(() => {
    const start = startOfWeekKey(today);
    return Array.from({ length: 8 }, (_, i) => {
      const from = addDays(start, (i - 7) * 7);
      const to = addDays(from, 6);
      const count = stats.done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= from && t.completedAt.slice(0, 10) <= to).length;
      return { label: `Sem. du ${shortDate(from, today)}`, value: count, color: "bg-accent" };
    });
  }, [stats.done, today]);

  return (
    <div data-scroll className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Terminées" value={stats.done.length} tone="text-done-fg" />
          <Tile label="Restantes" value={stats.open.length} />
          <Tile label="En retard" value={stats.overdue.length} tone={stats.overdue.length ? "text-critical-fg" : "text-ink"} />
          <Tile label="Bloquées" value={stats.blocked.length} tone={stats.blocked.length ? "text-late-fg" : "text-ink"} />
        </div>

        <section className="rounded-lg border border-border-subtle bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Progression du projet</h3>
            <span className="text-[13px] font-semibold tabular-nums text-ink">{Math.round(stats.progress * 100)} %</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-muted" role="progressbar" aria-valuenow={Math.round(stats.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progression">
            <div className="h-2.5 rounded-full bg-done-fg" style={{ width: `${stats.progress * 100}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {stats.done.length} terminée(s) sur {stats.top.length} tâche(s) (hors sous-tâches).
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Bars
            title="Par statut"
            rows={TASK_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: stats.top.filter((t) => t.status === s).length, color: STATUS_BAR[s] }))}
          />
          <Bars
            title="Tâches ouvertes par priorité"
            rows={[...TASK_PRIORITIES].reverse().map((p) => ({ label: PRIORITY_LABELS[p], value: stats.open.filter((t) => t.priority === p).length, color: PRIORITY_BAR[p] }))}
          />
          <Bars title="Tâches ouvertes par responsable" rows={byAssignee.map((a) => ({ label: a.name, value: a.open, color: "bg-accent" }))} />
          <Bars title="Tâches terminées par semaine" rows={weeks} />
        </div>

        <section className="rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-ink">Suivi du temps</h3>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label="Temps estimé (total)" value={minutesLabel(stats.estimated)} />
            <Tile label="Temps passé (total)" value={minutesLabel(stats.spent)} />
            <Tile
              label="Écart"
              value={stats.estimated ? `${Math.round((stats.spent / stats.estimated) * 100)} %` : "—"}
              hint={stats.estimated ? "du temps estimé déjà consommé" : "Aucune estimation saisie"}
            />
          </div>
          <table className="w-full text-[12px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-medium">Responsable</th>
                <th className="py-1 text-right font-medium">Ouvertes</th>
                <th className="py-1 text-right font-medium">Terminées</th>
                <th className="py-1 text-right font-medium">Reste estimé</th>
                <th className="py-1 text-right font-medium">Passé</th>
              </tr>
            </thead>
            <tbody>
              {byAssignee.map((a) => (
                <tr key={a.id} className="border-t border-border-subtle">
                  <td className="py-1.5 text-ink">{a.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.open}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.done}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.estimate ? minutesLabel(a.estimate) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.spent ? minutesLabel(a.spent) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
