"use client";

import { CircleCheck, Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { addDays } from "@/lib/tasks/recurrence";
import { runQuery, type GroupKey, type TaskGroup, type ViewConfig } from "@/lib/tasks/query-engine";
import type { TaskItem } from "@/lib/tasks/types";

import { allColumns, DEFAULT_MY_COLUMNS, readLocal, writeLocal } from "./columns";
import { NewTaskModal } from "./project-dialogs";
import { fetchJson, useHydrate, useWork, useWorkApi } from "./store";
import { TaskTable } from "./task-table";
import { useTaskOps } from "./task-ops";
import { Toolbar, type SavedViewItem } from "./toolbar";
import { BTN_GHOST, EmptyBlock, ErrorBlock } from "./ui";

const MY_DEFAULT: ViewConfig = { filters: { completion: "incomplete" }, sort: { key: "due", dir: "asc" }, group: "due" };
const MY_GROUPS: GroupKey[] = ["due", "project", "status", "priority", "none"];

const hydrateMine = (store: Parameters<Parameters<typeof useHydrate>[1]>[0], tasks: TaskItem[], silent: boolean) => store.upsertTasks(tasks, { silent });

export function MyTasksView({ initial, savedViews }: { initial: TaskItem[]; savedViews: SavedViewItem[] }) {
  useHydrate(initial, hydrateMine);
  const { store, ensureContext } = useWorkApi();
  const ops = useTaskOps();
  const context = useWork((s) => s.context);
  const allTasks = useWork((s) => s.tasks);
  const [config, setConfig] = useState<ViewConfig>(MY_DEFAULT);
  const [columns, setColumns] = useState<string[]>(DEFAULT_MY_COLUMNS);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [views, setViews] = useState(savedViews);
  const [ready, setReady] = useState(false);
  const me = context?.me.id;

  useEffect(() => ensureContext(), [ensureContext]);
  useEffect(() => {
    // Préférences locales (localStorage) : lues après l'hydratation pour que
    // le rendu serveur et le premier rendu client restent identiques.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfig(readLocal("nod:view:my", MY_DEFAULT));
    setColumns(readLocal("nod:columns:my", DEFAULT_MY_COLUMNS));
    setWidths(readLocal("nod:widths:my", {}));
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) writeLocal("nod:view:my", config);
  }, [config, ready]);

  const includeCompleted = (config.filters.completion ?? "incomplete") !== "incomplete";
  const reload = useCallback(async () => {
    try {
      const data = await fetchJson<{ tasks: TaskItem[] }>(`/api/tasks/my${includeCompleted ? "?completed=1" : ""}`);
      store.replaceScope((t) => t.assigneeId === me, data.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [includeCompleted, me, store]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (includeCompleted) void reload();
  }, [includeCompleted, reload]);
  useEffect(() => store.register({ scope: () => true, reload }), [reload, store]);

  // Tâches affectées à l'utilisateur, lues dans le store partagé : une tâche
  // réaffectée depuis le panneau disparaît d'ici immédiatement.
  const mine = useMemo(() => Object.values(allTasks).filter((t) => me && t.assigneeId === me && !t.id.startsWith("tmp-x")), [allTasks, me]);
  const queryCtx = useMemo(
    () => ({
      today: context?.today ?? new Date().toISOString().slice(0, 10),
      meId: me ?? "",
      fields: new Map((context?.fields ?? []).map((f) => [f.id, f])),
      users: new Map((context?.users ?? []).map((u) => [u.id, u])),
      projectNames: new Map((context?.projects ?? []).map((p) => [p.id, p.name])),
    }),
    [context, me],
  );
  const groups = useMemo(() => {
    const result = runQuery(mine, config, queryCtx);
    // « Plus tard » n'existe que si nécessaire ; les autres groupes d'échéance restent visibles pour l'ajout rapide.
    return config.group === "due" ? result.filter((g) => g.key !== "later" || g.tasks.length > 0) : result;
  }, [mine, config, queryCtx]);

  const quickAdd = async (group: TaskGroup, title: string) => {
    const today = queryCtx.today;
    const dueDate =
      config.group === "due" ? (group.key === "overdue" || group.key === "today" ? today : group.key === "upcoming" ? addDays(today, 1) : group.key === "later" ? addDays(today, 8) : null) : undefined;
    const projectId = config.group === "project" && group.key !== "none" ? group.key : undefined;
    await ops.create({
      title,
      assigneeId: me ?? null,
      dueDate: dueDate ?? null,
      status: group.patch?.status,
      priority: group.patch?.priority,
      projectId,
    });
  };

  const total = mine.filter((t) => t.status !== "DONE").length;
  const overdue = mine.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate < queryCtx.today).length;

  return (
    <div className="flex h-[85dvh] min-h-0 flex-col md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent">
          <CircleCheck className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-ink">Mes tâches</h1>
          <p className="text-[12px] text-muted">
            {total} à faire{overdue > 0 && <span className="text-critical-fg"> · {overdue} en retard</span>} · tous projets confondus
          </p>
        </div>
        <a href="/api/tasks/export?scope=my" className={BTN_GHOST}>
          <Download className="h-3.5 w-3.5" /> Exporter
        </a>
      </header>
      <Toolbar
        config={config}
        onChange={setConfig}
        onAdd={() => setCreating(true)}
        fields={context?.fields ?? []}
        columns={columns}
        onColumns={(ids) => {
          setColumns(ids);
          writeLocal("nod:columns:my", ids);
        }}
        groupOptions={MY_GROUPS}
        scope="my-tasks"
        savedViews={views}
        onSavedViewsChange={async () => setViews((await fetchJson<{ views: SavedViewItem[] }>("/api/tasks/views?scope=my-tasks").catch(() => ({ views }))).views)}
      />
      {error && <ErrorBlock message={error} onRetry={() => void reload()} />}
      {mine.length === 0 && !error ? (
        <EmptyBlock icon={CircleCheck} title="Aucune tâche ne vous est affectée" description="Les tâches dont vous êtes responsable, dans tous les projets, apparaîtront ici. Ajoutez une tâche personnelle pour commencer." />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <TaskTable
          groups={groups}
          projectId={null}
          columns={columns.map((id) => allColumns(context?.fields ?? []).find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))}
          widths={widths}
          onResize={(id, w) => setWidths((prev) => { const next = { ...prev, [id]: w }; writeLocal("nod:widths:my", next); return next; })}
          canReorder={false}
          canEditProject
          groupBySection={false}
          onQuickAdd={quickAdd}
          fields={context?.fields ?? []}
        />
      </div>
      {creating && <NewTaskModal onClose={() => setCreating(false)} defaults={{ assigneeId: me ?? null }} />}
    </div>
  );
}
