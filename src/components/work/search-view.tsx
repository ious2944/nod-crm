"use client";

import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { runQuery, type GroupKey, type ViewConfig } from "@/lib/tasks/query-engine";
import type { TaskItem } from "@/lib/tasks/types";

import { allColumns } from "./columns";
import { fetchJson, useWork, useWorkApi } from "./store";
import { TaskTable } from "./task-table";
import { Toolbar, type SavedViewItem } from "./toolbar";
import { BTN_GHOST, EmptyBlock, ErrorBlock, LoadingRows } from "./ui";

const SEARCH_DEFAULT: ViewConfig = { filters: { completion: "incomplete" }, sort: { key: "due", dir: "asc" }, group: "project" };
const GROUPS: GroupKey[] = ["project", "assignee", "status", "priority", "due", "none"];

/**
 * Recherche transverse : le texte est cherché **côté serveur** dans le titre
 * et la description complète, avec les filtres combinés ; le serveur ne
 * renvoie que les tâches que l'utilisateur a le droit de voir.
 */
export function SearchView({ savedViews }: { savedViews: SavedViewItem[] }) {
  const { store, ensureContext } = useWorkApi();
  const context = useWork((s) => s.context);
  const allTasks = useWork((s) => s.tasks);
  const [config, setConfig] = useState<ViewConfig>(SEARCH_DEFAULT);
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState(savedViews);
  const seq = useRef(0);
  useEffect(() => ensureContext(), [ensureContext]);

  const filtersKey = JSON.stringify(config.filters);
  useEffect(() => {
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchJson<{ tasks: TaskItem[] }>(`/api/tasks/search?filters=${encodeURIComponent(filtersKey)}`);
        if (id !== seq.current) return;
        store.upsertTasks(data.tasks, { skipPending: true });
        setIds(data.tasks.map((t) => t.id));
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Recherche impossible.");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [filtersKey, store]);

  const results = useMemo(() => (ids ?? []).map((id) => allTasks[id]).filter((t): t is TaskItem => Boolean(t)), [ids, allTasks]);
  const groups = useMemo(
    () =>
      runQuery(results, { ...config, filters: { ...config.filters, search: "", completion: "all" } }, {
        today: context?.today ?? "",
        meId: context?.me.id ?? "",
        fields: new Map((context?.fields ?? []).map((f) => [f.id, f])),
        users: new Map((context?.users ?? []).map((u) => [u.id, u])),
        projectNames: new Map((context?.projects ?? []).map((p) => [p.id, p.name])),
      }),
    [results, config, context],
  );

  const columns = ["assignee", "due", "projects", "status", "priority", "tags"].map((id) => allColumns(context?.fields ?? []).find((c) => c.id === id)!);

  return (
    <div className="flex h-[85dvh] min-h-0 flex-col md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="flex-1 text-[18px] font-semibold text-ink">Recherche</h1>
        <a href={`/api/tasks/export?scope=search&filters=${encodeURIComponent(filtersKey)}`} className={BTN_GHOST}>
          <Download className="h-3.5 w-3.5" /> Exporter les résultats
        </a>
      </header>
      <Toolbar
        config={config}
        onChange={setConfig}
        fields={context?.fields ?? []}
        groupOptions={GROUPS}
        showColumns={false}
        scope="search"
        savedViews={views}
        onSavedViewsChange={async () => setViews((await fetchJson<{ views: SavedViewItem[] }>("/api/tasks/views?scope=search").catch(() => ({ views }))).views)}
        extra={ids && <span className="text-[12px] text-muted">{results.length} résultat(s){results.length >= 300 ? " (300 premiers)" : ""}</span>}
      />
      {error && <ErrorBlock message={error} />}
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        {!ids ? (
          <LoadingRows rows={6} />
        ) : results.length === 0 ? (
          <EmptyBlock icon={Search} title="Aucune tâche trouvée" description="Modifiez la recherche ou les filtres. Seules les tâches auxquelles vous avez accès sont recherchées." />
        ) : (
          <TaskTable groups={groups} projectId={null} columns={columns} widths={{}} onResize={() => {}} canReorder={false} canEditProject={false} groupBySection={false} onQuickAdd={async () => {}} allowQuickAdd={false} fields={context?.fields ?? []} />
        )}
      </div>
    </div>
  );
}
