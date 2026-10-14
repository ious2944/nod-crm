"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChartGantt,
  Copy,
  Download,
  FileText,
  LayoutDashboard,
  LayoutList,
  Lock,
  PanelsTopLeft,
  Pencil,
  Settings,
  SquareKanban,
  Star,
  Trash,
  Upload,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  archiveProjectAction,
  createSectionAction,
  deleteProjectAction,
  deleteSectionAction,
  duplicateProjectAction,
  moveSectionAction,
  renameSectionAction,
  setFavoriteAction,
} from "@/app/(app)/tasks/work-actions";
import { runQuery, DEFAULT_VIEW, type TaskGroup, type ViewConfig } from "@/lib/tasks/query-engine";
import type { ProjectBundle, SectionItem, TaskItem } from "@/lib/tasks/types";

import { BoardView } from "./board-view";
import { CalendarView } from "./calendar-view";
import { allColumns, DEFAULT_PROJECT_COLUMNS, readLocal, writeLocal } from "./columns";
import { CustomizeDrawer } from "./customize";
import { DashboardView } from "./dashboard-view";
import { OverviewView } from "./overview-view";
import { DeleteSectionModal, MembersModal, NewTaskModal, ProjectFormModal, StatusUpdateModal } from "./project-dialogs";
import { fetchJson, useHydrate, useWork, useWorkApi, type ChangeEvent } from "./store";
import { useSearchMatches } from "./use-search-matches";
import { TaskTable } from "./task-table";
import { useTaskOps } from "./task-ops";
import { TimelineView } from "./timeline-view";
import { Toolbar, type SavedViewItem } from "./toolbar";
import {
  AvatarStack,
  BTN_GHOST,
  BTN_SECONDARY,
  ConfirmModal,
  ErrorBlock,
  ICON_BTN,
  MenuButton,
  ProjectIcon,
  ProjectStatusBadge,
} from "./ui";

export const TABS = [
  { key: "overview", label: "Vue d'ensemble", icon: PanelsTopLeft },
  { key: "list", label: "Liste", icon: LayoutList },
  { key: "board", label: "Tableau", icon: SquareKanban },
  { key: "calendar", label: "Calendrier", icon: CalendarDays },
  { key: "timeline", label: "Chronologie", icon: ChartGantt },
  { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

const hydrate = (store: Parameters<Parameters<typeof useHydrate>[1]>[0], bundle: ProjectBundle, silent: boolean) => store.hydrateProject(bundle, silent);

export function ProjectView({ initial, initialTab, savedViews: initialViews }: { initial: ProjectBundle; initialTab: TabKey; savedViews: SavedViewItem[] }) {
  useHydrate(initial, hydrate);
  const projectId = initial.project.id;
  const router = useRouter();
  const { store, run, ensureContext } = useWorkApi();
  const ops = useTaskOps();
  const context = useWork((s) => s.context);
  const project = useWork((s) => s.projects[projectId]) ?? initial.project;
  const sections = useWork((s) => s.sections[projectId]) ?? initial.sections;
  const allTasks = useWork((s) => s.tasks);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_VIEW);
  const [columns, setColumns] = useState<string[]>(DEFAULT_PROJECT_COLUMNS);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [boardMode, setBoardMode] = useState<"section" | "status">("section");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "edit" | "members" | "status" | "newTask" | "delete" | "duplicate" | "customize">(null);
  const [sectionToDelete, setSectionToDelete] = useState<SectionItem | null>(null);
  const [views, setViews] = useState(initialViews);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => ensureContext(), [ensureContext]);

  // Préférences d'affichage propres à l'appareil.
  useEffect(() => {
    // Préférences locales (localStorage) : lues après l'hydratation pour que
    // le rendu serveur et le premier rendu client restent identiques.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfig(readLocal(`nod:view:${projectId}`, DEFAULT_VIEW));
    setColumns(readLocal(`nod:columns:${projectId}`, DEFAULT_PROJECT_COLUMNS));
    setWidths(readLocal(`nod:widths:${projectId}`, {}));
    setBoardMode(readLocal(`nod:board:${projectId}`, "section"));
    setPrefsLoaded(true);
  }, [projectId]);
  useEffect(() => {
    if (prefsLoaded) writeLocal(`nod:view:${projectId}`, config);
  }, [config, projectId, prefsLoaded]);

  const reload = useCallback(async () => {
    try {
      const bundle = await fetchJson<ProjectBundle>(`/api/tasks/projects/${projectId}`);
      store.hydrateProject(bundle);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [projectId, store]);

  useEffect(
    () =>
      store.register({
        scope: (event: ChangeEvent) =>
          event.projectIds.includes(projectId) ||
          event.taskIds.some((id) => store.state.tasks[id]?.memberships.some((m) => m.projectId === projectId)),
        reload,
      }),
    [projectId, reload, store],
  );

  const switchTab = (next: TabKey) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  const projectTasks = useMemo(
    () => Object.values(allTasks).filter((t) => !t.parentId && t.memberships.some((m) => m.projectId === projectId)),
    [allTasks, projectId],
  );
  const projectAndSubtasks = useMemo(() => {
    const ids = new Set(projectTasks.map((t) => t.id));
    return Object.values(allTasks).filter((t) => ids.has(t.id) || (t.parentId && ids.has(t.parentId)));
  }, [allTasks, projectTasks]);

  const fields = useMemo(() => (context?.fields ?? []).filter((f) => project.customFieldIds.includes(f.id)), [context, project.customFieldIds]);
  const searchMatches = useSearchMatches(config.filters.search, { projectId });
  const queryCtx = useMemo(
    () => ({
      today: context?.today ?? new Date().toISOString().slice(0, 10),
      meId: context?.me.id ?? "",
      fields: new Map((context?.fields ?? []).map((f) => [f.id, f])),
      users: new Map((context?.users ?? []).map((u) => [u.id, u])),
      projectId,
      sections,
      projectNames: new Map((context?.projects ?? []).map((p) => [p.id, p.name])),
      searchMatches,
    }),
    [context, projectId, sections, searchMatches],
  );

  const listGroups = useMemo(() => runQuery(projectTasks, config, queryCtx), [projectTasks, config, queryCtx]);
  const boardGroups = useMemo(
    () => runQuery(projectTasks, { ...config, group: boardMode === "status" ? "status" : "section" }, queryCtx),
    [projectTasks, config, boardMode, queryCtx],
  );
  const flatFiltered = useMemo(() => runQuery(projectTasks, { ...config, group: "none" }, queryCtx)[0]?.tasks ?? [], [projectTasks, config, queryCtx]);
  const timelineGroups = useMemo(() => runQuery(projectTasks, { ...config, group: config.group === "none" ? "none" : "section", sort: config.sort.key === "manual" ? { key: "start", dir: "asc" } : config.sort }, queryCtx), [projectTasks, config, queryCtx]);

  const canEdit = project.canEdit;
  const canReorder = canEdit && config.sort.key === "manual" && config.group === "section";

  // ── Sections ──
  const sectionHandlers = {
    rename: async (section: SectionItem, name: string) => {
      const previous = store.state.sections[projectId] ?? [];
      store.setSections(projectId, previous.map((s) => (s.id === section.id ? { ...s, name } : s)));
      if ((await run(() => renameSectionAction(section.id, name))) === null) store.setSections(projectId, previous);
    },
    remove: (section: SectionItem) => setSectionToDelete(section),
    addAfter: async (section: SectionItem | null) => {
      const name = "Nouvelle section";
      const created = await run(() => createSectionAction(projectId, name, section?.id ?? null));
      if (created) store.setSections(projectId, [...(store.state.sections[projectId] ?? []), { id: created.id, projectId, name, position: created.position }]);
    },
    move: async (sectionId: string, beforeId: string | null, afterId: string | null) => {
      const previous = store.state.sections[projectId] ?? [];
      const pos = (id: string | null) => previous.find((s) => s.id === id)?.position ?? null;
      const a = pos(beforeId);
      const b = pos(afterId);
      const position = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1024 : b !== null ? b - 1024 : 1024;
      store.setSections(projectId, previous.map((s) => (s.id === sectionId ? { ...s, position } : s)));
      const result = await run(() => moveSectionAction(sectionId, beforeId, afterId));
      if (result === null) store.setSections(projectId, previous);
      else store.setSections(projectId, previous.map((s) => ({ ...s, position: result.find((r) => r.id === s.id)?.position ?? s.position })));
    },
  };

  const quickAdd = async (group: TaskGroup, title: string) => {
    const patch = group.patch ?? {};
    const sectionId = config.group === "section" || boardMode === "section" ? (group.sectionId ?? (config.group === "section" ? null : sections[0]?.id ?? null)) : (sections[0]?.id ?? null);
    await ops.create(
      {
        title,
        projectId,
        sectionId: group.sectionId !== undefined ? group.sectionId : sectionId,
        status: patch.status,
        priority: patch.priority,
        assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : undefined,
        custom: patch.custom ? { [patch.custom.fieldId]: patch.custom.value as string } : undefined,
      },
      {},
    );
  };

  const toggleFavorite = async () => {
    const next = !project.isFavorite;
    store.setProject({ ...project, isFavorite: next });
    if ((await run(() => setFavoriteAction(projectId, next))) === null) store.setProject({ ...project, isFavorite: !next });
  };

  const members = (context?.users ?? []).filter((u) => project.members.some((m) => m.userId === u.id));

  const menuItems = [
    { label: "Modifier le projet", icon: Pencil, disabled: !project.canManage, onSelect: () => setModal("edit") },
    { label: "Membres et partage", icon: UserPlus, onSelect: () => setModal("members") },
    { label: "Personnaliser (champs, règles, formulaires)", icon: Settings, onSelect: () => setModal("customize") },
    { separator: true as const },
    { label: "Dupliquer le projet", icon: Copy, onSelect: () => setModal("duplicate") },
    {
      label: "Enregistrer comme modèle",
      icon: FileText,
      onSelect: async () => {
        const id = await run(() => duplicateProjectAction(projectId, { name: `Modèle — ${project.name}`, asTemplate: true }), "Modèle de projet créé.");
        if (id) router.push(`/tasks/projects?scope=templates`);
      },
    },
    { label: "Exporter en CSV", icon: Download, onSelect: () => window.open(`/api/tasks/export?projectId=${projectId}`, "_blank") },
    { label: "Importer un CSV…", icon: Upload, disabled: !canEdit, onSelect: () => setModal("customize") },
    { separator: true as const },
    project.archived
      ? { label: "Désarchiver", icon: ArchiveRestore, disabled: !project.canManage, onSelect: async () => { if ((await run(() => archiveProjectAction(projectId, false), "Projet désarchivé.")) !== null) void reload(); } }
      : { label: "Archiver", icon: Archive, disabled: !project.canManage, onSelect: async () => { if ((await run(() => archiveProjectAction(projectId, true), "Projet archivé.")) !== null) void reload(); } },
    { label: "Supprimer le projet", icon: Trash, danger: true, disabled: !project.canManage, onSelect: () => setModal("delete") },
  ];

  return (
    <div className="flex h-[85dvh] min-h-0 flex-col md:h-dvh">
      {/* En-tête */}
      <header className="border-b border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4">
          <button type="button" disabled={!project.canManage} onClick={() => setModal("edit")} aria-label="Modifier la couleur et l'icône" className="rounded-md">
            <ProjectIcon icon={project.icon} color={project.color} size={32} />
          </button>
          <div className="min-w-[55%] flex-1 sm:min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[18px] font-semibold text-ink">{project.name}</h1>
              {project.visibility === "PRIVATE" && <Lock aria-label="Projet privé" className="h-3.5 w-3.5 text-muted" />}
              <button type="button" onClick={toggleFavorite} aria-pressed={project.isFavorite} aria-label={project.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"} className={ICON_BTN}>
                <Star className={`h-4 w-4 ${project.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
              <MenuButton label="Actions du projet" items={menuItems} align="start">
                <span className="text-lg leading-none">⋯</span>
              </MenuButton>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
              <button type="button" onClick={() => setModal("status")} disabled={!canEdit} className="rounded px-1 hover:bg-surface-muted">
                <ProjectStatusBadge status={project.status} />
              </button>
              {project.archived && <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium">Archivé — lecture seule</span>}
              {project.isTemplate && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">Modèle</span>}
            </div>
          </div>
          <button type="button" onClick={() => setModal("members")} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-muted" aria-label="Membres du projet">
            <AvatarStack users={members} max={5} size={26} />
          </button>
          <span className="hidden gap-2 sm:flex">
            <button type="button" onClick={() => setModal("members")} className={BTN_SECONDARY}>
              <UserPlus className="h-3.5 w-3.5" /> Partager
            </button>
            <button type="button" onClick={() => setModal("customize")} className={BTN_GHOST}>
              <Settings className="h-3.5 w-3.5" /> Personnaliser
            </button>
          </span>
        </div>
        <nav role="tablist" aria-label="Vues du projet" className="mt-1 flex gap-0.5 overflow-x-auto px-2 sm:px-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => switchTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors ${tab === t.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {loadError && <ErrorBlock message={loadError} onRetry={() => void reload()} />}

      {tab !== "overview" && tab !== "dashboard" && (
        <Toolbar
          config={config}
          onChange={setConfig}
          onAdd={canEdit ? () => setModal("newTask") : undefined}
          fields={fields}
          columns={tab === "list" ? columns : undefined}
          onColumns={(ids) => {
            setColumns(ids);
            writeLocal(`nod:columns:${projectId}`, ids);
          }}
          showColumns={tab === "list"}
          showGroup={tab === "list" || tab === "timeline"}
          scope={`project:${projectId}`}
          savedViews={views}
          onSavedViewsChange={async () => setViews((await fetchJson<{ views: SavedViewItem[] }>(`/api/tasks/views?scope=project:${projectId}`).catch(() => ({ views }))).views)}
          extra={
            tab === "board" ? (
              <div role="radiogroup" aria-label="Colonnes du tableau" className="flex rounded-md border border-border-strong p-0.5 text-[12px]">
                {(["section", "status"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={boardMode === m} onClick={() => { setBoardMode(m); writeLocal(`nod:board:${projectId}`, m); }} className={`rounded px-2 py-0.5 font-medium ${boardMode === m ? "bg-accent text-accent-contrast" : "text-muted hover:text-ink"}`}>
                    {m === "section" ? "Par section" : "Par statut"}
                  </button>
                ))}
              </div>
            ) : null
          }
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        {tab === "overview" && <OverviewView projectId={projectId} onEdit={() => setModal("edit")} onMembers={() => setModal("members")} onStatus={() => setModal("status")} tasks={projectTasks} />}
        {tab === "list" && (
          <TaskTable
            groups={listGroups}
            projectId={projectId}
            columns={columns.map((id) => allColumns(fields).find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))}
            widths={widths}
            onResize={(id, w) => setWidths((prev) => { const next = { ...prev, [id]: w }; writeLocal(`nod:widths:${projectId}`, next); return next; })}
            canReorder={canReorder}
            canEditProject={canEdit}
            groupBySection={config.group === "section"}
            sections={sections}
            sectionHandlers={sectionHandlers}
            onQuickAdd={quickAdd}
            fields={fields}
            emptyLabel="Aucune tâche ne correspond aux filtres."
          />
        )}
        {tab === "board" && <BoardView groups={boardGroups} projectId={projectId} mode={boardMode} sections={sections} sectionHandlers={sectionHandlers} canEdit={canEdit} onQuickAdd={quickAdd} />}
        {tab === "calendar" && (
          <CalendarView
            tasks={flatFiltered}
            canCreate={canEdit}
            onCreate={async (title, dueDate) => {
              await ops.create({ title, projectId, sectionId: sections[0]?.id ?? null, dueDate });
            }}
          />
        )}
        {tab === "timeline" && <TimelineView groups={timelineGroups} color={project.color} />}
        {tab === "dashboard" && <DashboardView tasks={projectAndSubtasks} />}
      </div>

      {modal === "newTask" && <NewTaskModal onClose={() => setModal(null)} projectId={projectId} sections={sections} />}
      {modal === "edit" && <ProjectFormModal project={project} onClose={() => setModal(null)} onSaved={() => void reload()} />}
      {modal === "members" && <MembersModal project={project} onClose={() => setModal(null)} onChanged={() => void reload()} />}
      {modal === "status" && <StatusUpdateModal project={project} onClose={() => setModal(null)} onPosted={() => void reload()} />}
      {modal === "customize" && <CustomizeDrawer project={project} sections={sections} onClose={() => setModal(null)} onChanged={() => void reload()} />}
      {modal === "duplicate" && (
        <ConfirmModal
          open
          danger={false}
          title="Dupliquer le projet"
          description="Une copie du projet est créée avec ses sections, ses tâches non terminées (et leurs sous-tâches), ses champs, ses règles et ses modèles. Vous en serez le propriétaire."
          confirmLabel="Dupliquer"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            const id = await run(() => duplicateProjectAction(projectId, { includeTasks: true }), "Projet dupliqué.");
            setModal(null);
            if (id) router.push(`/tasks/projects/${id}`);
          }}
        />
      )}
      {modal === "delete" && (
        <ConfirmModal
          open
          title="Supprimer le projet ?"
          description={
            <>
              « {project.name} » sera supprimé définitivement. Les tâches qui n&apos;appartiennent qu&apos;à ce projet seront supprimées avec lui ; celles qui appartiennent aussi à d&apos;autres projets seront conservées. Pour garder l&apos;historique, préférez l&apos;archivage.
            </>
          }
          confirmLabel="Supprimer définitivement"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            const result = await run(() => deleteProjectAction(projectId));
            if (result) {
              store.toast("success", `Projet supprimé (${result.deletedTasks} tâche(s) supprimée(s), ${result.keptTasks} conservée(s) dans d'autres projets).`);
              router.push("/tasks/projects");
            }
          }}
        />
      )}
      {sectionToDelete && (
        <DeleteSectionModal
          section={sectionToDelete}
          sections={sections}
          taskCount={projectTasks.filter((t: TaskItem) => t.memberships.some((m) => m.projectId === projectId && m.sectionId === sectionToDelete.id)).length}
          onClose={() => setSectionToDelete(null)}
          onConfirm={async (target) => {
            const ok = await run(() => deleteSectionAction(sectionToDelete.id, target));
            setSectionToDelete(null);
            if (ok !== null) await reload();
          }}
        />
      )}
    </div>
  );
}
