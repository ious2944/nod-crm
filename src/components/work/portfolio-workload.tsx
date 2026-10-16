"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from "@/lib/tasks/constants";
import { minutesLabel, shortDate, startOfWeekKey } from "@/lib/tasks/format";
import { setWeeklyCapacityAction } from "@/app/(app)/tasks/work-actions";
import { addDays } from "@/lib/tasks/recurrence";
import { computeWorkload, DEFAULT_WEEKLY_CAPACITY_MINUTES, loadLevel, remainingMinutes } from "@/lib/tasks/workload";
import type { ProjectStatus, ProjectSummary, TaskItem } from "@/lib/tasks/types";

import { useToday } from "./pickers";
import { useHydrate, useWork, useWorkApi } from "./store";
import { Avatar, BTN_GHOST, DueText, EmptyBlock, INPUT, ProjectIcon, ProjectStatusBadge } from "./ui";

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
const WEEK_OPTIONS = [2, 4, 6, 8, 12];

export function WorkloadView({ initial, from, weeks, capacities }: { initial: TaskItem[]; from: string; weeks: number; capacities: Record<string, number | null> }) {
  useHydrate(initial, hydrateTasks);
  const { openTask, run } = useWorkApi();
  const router = useRouter();
  const users = useWork((s) => s.context?.users ?? []);
  const me = useWork((s) => s.context?.me.id ?? null);
  const allTasks = useWork((s) => s.tasks);
  const today = useToday();
  const [ownCapacity, setOwnCapacity] = useState<Record<string, number | null>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const ids = useMemo(() => new Set(initial.map((t) => t.id)), [initial]);
  // Les tâches de la page + celles modifiées depuis (temps réel), toujours à jour.
  const tasks = useMemo(() => Object.values(allTasks).filter((t) => ids.has(t.id) || t.assigneeId), [allTasks, ids]);
  const weekStarts = useMemo(() => Array.from({ length: weeks }, (_, i) => addDays(startOfWeekKey(from), i * 7)), [from, weeks]);
  const end = addDays(weekStarts[weekStarts.length - 1], 6);
  const caps = useMemo(() => ({ ...capacities, ...ownCapacity }), [capacities, ownCapacity]);

  const rows = useMemo(
    () =>
      computeWorkload({ tasks, weekStarts, capacities: caps })
        .map((row) => ({ ...row, user: users.find((u) => u.id === row.userId) }))
        .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "", "fr")),
    [tasks, weekStarts, caps, users],
  );
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const cell = (minutes: number, capacity: number, count: number) => {
    const level = loadLevel(minutes, capacity);
    const tone = level === "empty" ? "text-muted/50" : level === "over" ? "bg-critical-bg font-semibold text-critical-fg" : level === "high" ? "bg-today-bg text-today-fg" : "bg-surface-muted text-ink";
    return (
      <span className={`block rounded px-1.5 py-1 text-[12px] tabular-nums ${tone}`} title={`${minutesLabel(minutes)} sur ${minutesLabel(capacity)} de capacité · ${count} tâche(s)`}>
        {level === "empty" ? "—" : `${minutesLabel(minutes)} · ${Math.round((minutes / capacity) * 100)} %`}
      </span>
    );
  };
  const href = (nextFrom: string, nextWeeks: number) => `/tasks/workload?from=${nextFrom}&weeks=${nextWeeks}`;

  const saveCapacity = async (hours: number | null) => {
    if (!me) return;
    const minutes = hours === null ? null : Math.round(hours * 60);
    setOwnCapacity({ [me]: minutes });
    await run(() => setWeeklyCapacityAction(minutes), "Capacité enregistrée.");
  };
  const myCapacity = me ? (caps[me] ?? DEFAULT_WEEKLY_CAPACITY_MINUTES) : DEFAULT_WEEKLY_CAPACITY_MINUTES;

  const taskList = (list: string[], empty: string) =>
    list.length === 0 ? (
      <p className="text-[12px] text-muted">{empty}</p>
    ) : (
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((id) => byId.get(id)).filter((t): t is TaskItem => Boolean(t)).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-surface-muted">
              <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
              <span className="text-muted">{t.estimatedMinutes ? minutesLabel(remainingMinutes(t)) : "?"}</span>
              {t.dueDate && <DueText due={t.dueDate} done={false} today={today} className="text-[11px]" />}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-ink">Charge de travail</h1>
          <p className="text-[12px] text-muted">
            Estimation restante des tâches ouvertes, répartie sur les jours ouvrés entre début et échéance, comparée à la capacité de chaque personne. Les tâches sans date ou sans estimation sont listées à part, non comptées.
          </p>
        </div>
        <nav aria-label="Période" className="flex items-center gap-1 text-[12px]">
          <NextLink className={BTN_GHOST} href={href(addDays(weekStarts[0], -7 * weeks), weeks)} aria-label="Période précédente">
            <ChevronLeft className="h-3.5 w-3.5" />
          </NextLink>
          <span className="tabular-nums text-ink">
            {shortDate(weekStarts[0], today)} – {shortDate(end, today)}
          </span>
          <NextLink className={BTN_GHOST} href={href(addDays(weekStarts[0], 7 * weeks), weeks)} aria-label="Période suivante">
            <ChevronRight className="h-3.5 w-3.5" />
          </NextLink>
          <NextLink className={BTN_GHOST} href={href(startOfWeekKey(today), weeks)}>
            Cette semaine
          </NextLink>
          <label className="flex items-center gap-1 text-muted">
            <span className="sr-only">Nombre de semaines</span>
            <select aria-label="Nombre de semaines" value={weeks} onChange={(e) => router.push(href(weekStarts[0], Number(e.target.value)))} className={`${INPUT} w-auto py-1`}>
              {WEEK_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} semaines
                </option>
              ))}
            </select>
          </label>
        </nav>
        {me && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Ma capacité
            <input
              key={myCapacity}
              type="number"
              min={1}
              max={80}
              step={0.5}
              defaultValue={myCapacity / 60}
              onBlur={(e) => {
                const hours = Number(e.target.value);
                if (hours >= 1 && hours <= 80 && Math.round(hours * 60) !== myCapacity) void saveCapacity(hours);
              }}
              className={`${INPUT} w-16 py-1`}
              aria-label="Ma capacité hebdomadaire en heures"
            />
            h / sem.
          </label>
        )}
      </header>
      <div className="p-4">
        {rows.length === 0 ? (
          <EmptyBlock title="Aucune tâche affectée" description="Les tâches ouvertes et affectées de la période apparaîtront ici." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-border-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Responsable</th>
                  <th className="px-2 py-2">Capacité</th>
                  <th className="px-2 py-2 text-critical-fg">En retard</th>
                  {weekStarts.map((w) => (
                    <th key={w} className="px-2 py-2">
                      Sem. du {shortDate(w, today)}
                    </th>
                  ))}
                  <th className="px-2 py-2">Sans estimation</th>
                  <th className="px-2 py-2">Sans date</th>
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
                      <td className="px-2 py-2 text-[12px] tabular-nums text-muted">{minutesLabel(row.capacityMinutes)}</td>
                      <td className="px-2 py-2 text-[12px] tabular-nums">
                        {row.overdueTasks.length ? <span className="text-critical-fg">{minutesLabel(row.overdueMinutes)} · {row.overdueTasks.length}</span> : <span className="text-muted/50">—</span>}
                      </td>
                      {row.weeks.map((minutes, i) => (
                        <td key={i} className="px-2 py-2">
                          {cell(minutes, row.capacityMinutes, row.weekTasks[i].length)}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-[12px] tabular-nums text-muted">{row.unestimated.length || "—"}</td>
                      <td className="px-2 py-2 text-[12px] tabular-nums text-muted">{row.undated.length || "—"}</td>
                    </tr>
                    {expanded === row.userId && (
                      <tr className="border-b border-border-subtle/60 bg-bg/50">
                        <td colSpan={weeks + 5} className="space-y-3 px-3 py-2">
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Comptées dans la période</p>
                            {taskList([...new Set([...row.overdueTasks, ...row.weekTasks.flat()])].filter((id) => byId.get(id)?.estimatedMinutes), "Aucune.")}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Sans estimation (non comptées)</p>
                            {taskList([...row.unestimated, ...row.overdueTasks.filter((id) => !byId.get(id)?.estimatedMinutes)], "Aucune.")}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Sans date (non comptées)</p>
                            {taskList(row.undated, "Aucune.")}
                          </div>
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
