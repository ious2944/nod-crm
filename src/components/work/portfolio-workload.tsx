"use client";

import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import NextLink from "next/link";
import { Fragment, useMemo, useState } from "react";

import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from "@/lib/tasks/constants";
import { minutesLabel, shortDate, startOfWeekKey } from "@/lib/tasks/format";
import { addDays } from "@/lib/tasks/recurrence";
import type { ProjectStatus, ProjectSummary, TaskItem } from "@/lib/tasks/types";

import { useToday } from "./pickers";
import { useHydrate, useWork, useWorkApi } from "./store";
import { Avatar, DueText, EmptyBlock, INPUT, ProjectIcon, ProjectStatusBadge } from "./ui";

type PortfolioRow = ProjectSummary & { taskCount: number; doneCount: number; overdueCount: number; dueDate: string | null; startDate: string | null; memberIds: string[] };

/* ─── Synthèse multi-projets ──────────────────────────────────────────────── */

export function PortfolioView({ projects }: { projects: PortfolioRow[] }) {
  const users = useWork((s) => s.context?.users ?? []);
  const today = useToday();
  const [status, setStatus] = useState<ProjectStatus | "ALL">("ALL");
  const [sort, setSort] = useState<"name" | "due" | "progress" | "overdue">("due");
  const rows = useMemo(() => {
    const list = projects.filter((p) => status === "ALL" || p.status === status);
    const progress = (p: PortfolioRow) => (p.taskCount ? p.doneCount / p.taskCount : 0);
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name, "fr") : sort === "progress" ? progress(a) - progress(b) : sort === "overdue" ? b.overdueCount - a.overdueCount : (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"),
    );
  }, [projects, status, sort]);
  const totals = projects.reduce((acc, p) => ({ tasks: acc.tasks + p.taskCount, done: acc.done + p.doneCount, overdue: acc.overdue + p.overdueCount }), { tasks: 0, done: 0, overdue: 0 });

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="text-[18px] font-semibold text-ink">Synthèse des projets</h1>
        <p className="text-[12px] text-muted">
          {projects.length} projet(s) actif(s) · {totals.done}/{totals.tasks} tâches terminées
          {totals.overdue > 0 && <span className="text-critical-fg"> · {totals.overdue} en retard</span>}
        </p>
      </header>
      <div className="mx-auto max-w-6xl space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["ALL", ...PROJECT_STATUSES] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${status === s ? "border-accent bg-accent-soft text-accent" : "border-border-subtle text-ink hover:bg-surface-muted"}`}>
              {s === "ALL" ? "Tous" : PROJECT_STATUS_LABELS[s]} ({s === "ALL" ? projects.length : projects.filter((p) => p.status === s).length})
            </button>
          ))}
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Trier par
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${INPUT} w-auto py-1`}>
              <option value="due">Échéance</option>
              <option value="name">Nom</option>
              <option value="progress">Avancement</option>
              <option value="overdue">Tâches en retard</option>
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyBlock title="Aucun projet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-border-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Projet</th>
                  <th className="px-3 py-2">État</th>
                  <th className="px-3 py-2">Responsable</th>
                  <th className="px-3 py-2">Avancement</th>
                  <th className="px-3 py-2 text-right">En retard</th>
                  <th className="px-3 py-2">Échéance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const owner = users.find((u) => u.id === p.ownerId);
                  const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
                  return (
                    <tr key={p.id} className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-muted/50">
                      <td className="px-3 py-2">
                        <NextLink href={`/tasks/projects/${p.id}?view=overview`} className="flex items-center gap-2 font-medium text-ink hover:text-accent">
                          <ProjectIcon icon={p.icon} color={p.color} size={22} />
                          {p.name}
                          {p.visibility === "PRIVATE" && <Lock aria-label="Privé" className="h-3 w-3 text-muted" />}
                        </NextLink>
                      </td>
                      <td className="px-3 py-2">
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <Avatar user={owner} size={20} />
                          {owner?.name ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-24 rounded-full bg-surface-muted">
                            <span className="block h-1.5 rounded-full bg-done-fg" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="tabular-nums text-muted">
                            {pct} % ({p.doneCount}/{p.taskCount})
                          </span>
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.overdueCount ? "font-semibold text-critical-fg" : "text-muted"}`}>{p.overdueCount}</td>
                      <td className="px-3 py-2 text-muted">{p.dueDate ? shortDate(p.dueDate, today) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Charge par responsable ──────────────────────────────────────────────── */

const hydrateTasks = (store: Parameters<Parameters<typeof useHydrate>[1]>[0], tasks: TaskItem[], silent: boolean) => store.upsertTasks(tasks, { silent });

/**
 * Charge de travail : pour chaque responsable et chaque semaine, la somme des
 * estimations des tâches ouvertes dont l'échéance tombe dans la semaine (les
 * tâches en retard sont regroupées à part). Les tâches sans estimation sont
 * comptées, pour ne pas sous-estimer la charge sans le dire.
 */
export function WorkloadView({ initial, from, weeks }: { initial: TaskItem[]; from: string; weeks: number }) {
  useHydrate(initial, hydrateTasks);
  const { openTask } = useWorkApi();
  const users = useWork((s) => s.context?.users ?? []);
  const allTasks = useWork((s) => s.tasks);
  const today = useToday();
  const [capacity, setCapacity] = useState(35);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ids = useMemo(() => new Set(initial.map((t) => t.id)), [initial]);
  const tasks = useMemo(() => Object.values(allTasks).filter((t) => (ids.has(t.id) || t.assigneeId) && t.status !== "DONE" && t.assigneeId && t.dueDate), [allTasks, ids]);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(startOfWeekKey(from), i * 7));
  const end = addDays(weekStarts[weekStarts.length - 1], 6);

  const rows = useMemo(() => {
    const map = new Map<string, { overdue: TaskItem[]; weeks: TaskItem[][] }>();
    for (const task of tasks) {
      if (task.dueDate! > end) continue;
      const entry = map.get(task.assigneeId!) ?? { overdue: [], weeks: weekStarts.map(() => []) };
      if (task.dueDate! < weekStarts[0]) entry.overdue.push(task);
      else {
        const index = weekStarts.findIndex((w) => task.dueDate! >= w && task.dueDate! <= addDays(w, 6));
        if (index >= 0) entry.weeks[index].push(task);
      }
      map.set(task.assigneeId!, entry);
    }
    return [...map.entries()].map(([userId, data]) => ({ user: users.find((u) => u.id === userId), userId, ...data })).sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "", "fr"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, users, from, weeks]);

  const sum = (list: TaskItem[]) => list.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const cell = (list: TaskItem[]) => {
    const minutes = sum(list);
    const missing = list.filter((t) => !t.estimatedMinutes).length;
    const over = minutes > capacity * 60;
    return (
      <span className={`block rounded px-1.5 py-1 text-[12px] tabular-nums ${list.length === 0 ? "text-muted/50" : over ? "bg-critical-bg font-semibold text-critical-fg" : minutes > capacity * 48 ? "bg-today-bg text-today-fg" : "bg-surface-muted text-ink"}`} title={`${list.length} tâche(s), ${minutesLabel(minutes)} estimées${missing ? `, ${missing} sans estimation` : ""}`}>
        {list.length ? `${minutesLabel(minutes)} · ${list.length}` : "—"}
        {missing > 0 && <span className="ml-1 text-[10px] font-normal text-muted">({missing} ?)</span>}
      </span>
    );
  };

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-ink">Charge de travail</h1>
          <p className="text-[12px] text-muted">Somme des estimations des tâches ouvertes, par semaine d&apos;échéance. « ? » : tâches sans estimation.</p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Capacité hebdomadaire
          <input type="number" min={1} max={80} value={capacity} onChange={(e) => setCapacity(Math.max(1, Math.min(80, Number(e.target.value) || 35)))} className={`${INPUT} w-16 py-1`} aria-label="Capacité hebdomadaire en heures" />
          h
        </label>
      </header>
      <div className="p-4">
        {rows.length === 0 ? (
          <EmptyBlock title="Aucune tâche planifiée" description="Les tâches affectées et datées des 6 prochaines semaines apparaîtront ici." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-border-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Responsable</th>
                  <th className="px-2 py-2 text-critical-fg">En retard</th>
                  {weekStarts.map((w) => (
                    <th key={w} className="px-2 py-2">
                      Sem. du {shortDate(w, today)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.userId}>
                    <tr className="border-b border-border-subtle/60">
                      <td className="px-3 py-2">
                        <button type="button" aria-expanded={expanded === row.userId} onClick={() => setExpanded(expanded === row.userId ? null : row.userId)} className="flex items-center gap-1.5 font-medium text-ink">
                          {expanded === row.userId ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          <Avatar user={row.user} size={22} />
                          {row.user?.name ?? "Utilisateur"}
                        </button>
                      </td>
                      <td className="px-2 py-2">{cell(row.overdue)}</td>
                      {row.weeks.map((list, i) => (
                        <td key={i} className="px-2 py-2">
                          {cell(list)}
                        </td>
                      ))}
                    </tr>
                    {expanded === row.userId && (
                      <tr className="border-b border-border-subtle/60 bg-bg/50">
                        <td colSpan={weeks + 2} className="px-3 py-2">
                          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            {[...row.overdue, ...row.weeks.flat()].map((t) => (
                              <li key={t.id}>
                                <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-surface-muted">
                                  <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                                  <span className="text-muted">{t.estimatedMinutes ? minutesLabel(t.estimatedMinutes) : "?"}</span>
                                  <DueText due={t.dueDate} done={false} today={today} className="text-[11px]" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
