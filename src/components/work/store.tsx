"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  ActionResult,
  ProjectDetail,
  ProjectSummary,
  SectionItem,
  StatusUpdateItem,
  TaskItem,
  TaskPatch,
  WorkContext,
} from "@/lib/tasks/types";

/**
 * Store client unique du module de gestion de travail.
 *
 * Toutes les vues (Liste, Tableau, Calendrier, Chronologie, Tableau de bord,
 * Mes tâches, panneau de détail, fiches CRM) lisent **les mêmes objets** :
 * une tâche modifiée dans le panneau est la même instance que celle affichée
 * dans le Kanban. Il n'y a donc rien à « synchroniser » entre vues — il n'y a
 * qu'une donnée.
 *
 * Écritures : optimistes. L'interface applique le changement tout de suite,
 * appelle la Server Action, puis remplace par la version du serveur. En cas
 * d'échec, l'état précédent est restauré et l'erreur affichée ; en cas de
 * conflit (quelqu'un d'autre a modifié le même champ), la version serveur est
 * appliquée et l'utilisateur en est averti — jamais d'écrasement silencieux.
 *
 * Temps réel : un flux SSE (`/api/tasks/stream`) signale les changements des
 * autres utilisateurs ; les vues concernées se rechargent (en épargnant les
 * tâches en cours d'édition locale).
 */

export interface Toast {
  id: number;
  kind: "error" | "success" | "info";
  message: string;
  action?: { label: string; run: () => void };
}

export interface WorkState {
  context: WorkContext | null;
  contextError: string | null;
  tasks: Record<string, TaskItem>;
  sections: Record<string, SectionItem[]>;
  projects: Record<string, ProjectDetail>;
  statusUpdates: Record<string, StatusUpdateItem[]>;
  toasts: Toast[];
  /** Incrémenté à chaque changement extérieur : le panneau relit son détail. */
  remoteTick: number;
  remoteTaskIds: string[];
}

type Reloader = { scope: (msg: ChangeEvent) => boolean; reload: () => Promise<void> };

export interface ChangeEvent {
  kind: string;
  actorId: string | null;
  taskIds: string[];
  projectIds: string[];
  forMe: boolean;
}

export class WorkStore {
  state: WorkState = {
    context: null,
    contextError: null,
    tasks: {},
    sections: {},
    projects: {},
    statusUpdates: {},
    toasts: [],
    remoteTick: 0,
    remoteTaskIds: [],
  };

  private listeners = new Set<() => void>();
  readonly pending = new Map<string, number>();
  readonly reloaders = new Map<number, Reloader>();
  private nextId = 1;
  private toastId = 1;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  set(update: Partial<WorkState> | ((state: WorkState) => Partial<WorkState>), silent = false) {
    const patch = typeof update === "function" ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    if (!silent) for (const listener of this.listeners) listener();
  }

  // ── Tâches ──
  upsertTasks(items: TaskItem[], options: { skipPending?: boolean; silent?: boolean } = {}) {
    if (items.length === 0) return;
    this.set((s) => {
      const tasks = { ...s.tasks };
      for (const item of items) {
        if (options.skipPending && this.pending.has(item.id)) continue;
        tasks[item.id] = item;
      }
      return { tasks };
    }, options.silent);
  }

  /** Remplace l'ensemble des tâches d'une portée (projet…) : retire celles qui en sont sorties. */
  replaceScope(belongs: (task: TaskItem) => boolean, items: TaskItem[], options: { silent?: boolean } = {}) {
    this.set((s) => {
      const tasks = { ...s.tasks };
      const incoming = new Set(items.map((i) => i.id));
      for (const [id, task] of Object.entries(tasks)) {
        if (!incoming.has(id) && belongs(task) && !this.pending.has(id)) delete tasks[id];
      }
      for (const item of items) {
        if (!this.pending.has(item.id)) tasks[item.id] = item;
      }
      return { tasks };
    }, options.silent);
  }

  patchTask(id: string, patch: Partial<TaskItem>) {
    const current = this.state.tasks[id];
    if (!current) return;
    this.set((s) => ({ tasks: { ...s.tasks, [id]: { ...current, ...patch } } }));
  }

  removeTasks(ids: string[]) {
    this.set((s) => {
      const tasks = { ...s.tasks };
      for (const id of ids) delete tasks[id];
      // Les sous-tâches d'une tâche supprimée disparaissent avec elle.
      for (const [id, task] of Object.entries(tasks)) if (task.parentId && ids.includes(task.parentId)) delete tasks[id];
      return { tasks };
    });
  }

  beginPending(id: string) {
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
  }

  endPending(id: string) {
    const n = (this.pending.get(id) ?? 1) - 1;
    if (n <= 0) this.pending.delete(id);
    else this.pending.set(id, n);
  }

  // ── Projets ──
  hydrateProject(
    bundle: { project: ProjectDetail; sections: SectionItem[]; tasks: TaskItem[]; statusUpdates: StatusUpdateItem[] },
    silent = false,
  ) {
    const projectId = bundle.project.id;
    const subtaskParents = new Set(bundle.tasks.filter((t) => !t.parentId).map((t) => t.id));
    this.replaceScope(
      (t) => t.memberships.some((m) => m.projectId === projectId) || (t.parentId !== null && subtaskParents.has(t.parentId)),
      bundle.tasks,
      { silent: true },
    );
    this.set(
      (s) => ({
        projects: { ...s.projects, [projectId]: bundle.project },
        sections: { ...s.sections, [projectId]: bundle.sections },
        statusUpdates: { ...s.statusUpdates, [projectId]: bundle.statusUpdates },
        context: s.context ? { ...s.context, projects: mergeSummary(s.context.projects, bundle.project) } : s.context,
      }),
      silent,
    );
  }

  setSections(projectId: string, sections: SectionItem[]) {
    this.set((s) => ({ sections: { ...s.sections, [projectId]: sections } }));
  }

  setProject(project: ProjectDetail) {
    this.set((s) => ({
      projects: { ...s.projects, [project.id]: project },
      context: s.context ? { ...s.context, projects: mergeSummary(s.context.projects, project) } : s.context,
    }));
  }

  // ── Contexte ──
  setContext(context: WorkContext, silent = false) {
    this.set({ context, contextError: null }, silent);
  }

  // ── Notifications visuelles ──
  toast(kind: Toast["kind"], message: string, action?: Toast["action"]) {
    const id = this.toastId++;
    this.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, action }] }));
    setTimeout(() => this.dismiss(id), kind === "error" ? 7000 : 4000);
    return id;
  }

  dismiss(id: number) {
    this.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  // ── Rechargements ──
  register(reloader: Reloader): () => void {
    const id = this.nextId++;
    this.reloaders.set(id, reloader);
    return () => this.reloaders.delete(id);
  }
}

function mergeSummary(list: ProjectSummary[], project: ProjectSummary): ProjectSummary[] {
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    color: project.color,
    icon: project.icon,
    status: project.status,
    visibility: project.visibility,
    archived: project.archived,
    isTemplate: project.isTemplate,
    isFavorite: project.isFavorite,
    ownerId: project.ownerId,
    role: project.role,
    canEdit: project.canEdit,
    canManage: project.canManage,
  };
  const index = list.findIndex((p) => p.id === project.id);
  if (index === -1) return [...list, summary].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const next = [...list];
  next[index] = summary;
  return next;
}

// ─── Contexte React ───────────────────────────────────────────────────────────

interface WorkApi {
  store: WorkStore;
  /** Ouvre le panneau de détail d'une tâche (paramètre d'URL `task`). */
  openTask: (id: string) => void;
  closeTask: () => void;
  /** Mutation optimiste d'une tâche, avec retour arrière et gestion des conflits. */
  mutateTask: (
    id: string,
    optimistic: Partial<TaskItem>,
    call: () => Promise<ActionResult<TaskItem>>,
  ) => Promise<TaskItem | null>;
  /** Appelle une action et affiche son erreur éventuelle. */
  run: <T>(call: () => Promise<ActionResult<T>>, success?: string) => Promise<T | null>;
  ensureContext: () => void;
  reloadContext: () => Promise<void>;
  /** Après une mutation hors du module (/today, fiches CRM) : rafraîchit la page serveur. */
  afterMutation: () => void;
}

const WorkContextReact = createContext<WorkApi | null>(null);

export function useWorkApi(): WorkApi {
  const api = useContext(WorkContextReact);
  if (!api) throw new Error("WorkProvider manquant.");
  return api;
}

export function useWork<T>(selector: (state: WorkState) => T): T {
  const { store } = useWorkApi();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.state),
    () => selector(store.state),
  );
}

export function useWorkContext(): WorkContext | null {
  return useWork((s) => s.context);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) {
    let message = response.status === 404 ? "Élément introuvable ou accès refusé." : "Le chargement a échoué.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corps non JSON
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Valeurs « de base » d'un patch : ce que l'utilisateur avait sous les yeux. */
export function baseOf(task: TaskItem | undefined, patch: TaskPatch): Partial<Record<keyof TaskPatch, unknown>> {
  if (!task) return {};
  const base: Partial<Record<keyof TaskPatch, unknown>> = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    if (key === "description") continue;
    if (key in task) base[key] = (task as unknown as Record<string, unknown>)[key];
  }
  return base;
}

export function WorkProvider({
  children,
  meId,
}: {
  children: ReactNode;
  meId: string;
}) {
  const [store] = useState(() => new WorkStore());
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const contextLoading = useRef<Promise<void> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadContext = useCallback(async () => {
    try {
      const context = await fetchJson<WorkContext>("/api/tasks/context");
      store.setContext(context);
    } catch (error) {
      store.set({ contextError: error instanceof Error ? error.message : "Chargement impossible." });
    }
  }, [store]);

  const ensureContext = useCallback(() => {
    if (store.state.context || contextLoading.current) return;
    contextLoading.current = reloadContext().finally(() => {
      contextLoading.current = null;
    });
  }, [reloadContext, store]);

  const afterMutation = useCallback(() => {
    if (pathRef.current.startsWith("/tasks")) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 600);
  }, [router]);

  const setTaskParam = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("task", id);
    else url.searchParams.delete("task");
    const method = id && !new URL(window.location.href).searchParams.get("task") ? "pushState" : "replaceState";
    window.history[method](null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const mutateTask = useCallback<WorkApi["mutateTask"]>(
    async (id, optimistic, call) => {
      const previous = store.state.tasks[id];
      store.beginPending(id);
      if (previous) store.patchTask(id, optimistic);
      let result: ActionResult<TaskItem>;
      try {
        result = await call();
      } catch {
        result = { ok: false, error: "Connexion au serveur impossible. Vos modifications n'ont pas été enregistrées." };
      } finally {
        store.endPending(id);
      }
      if (result.ok) {
        store.upsertTasks([result.data]);
        afterMutation();
        return result.data;
      }
      if (result.code === "CONFLICT" && result.current) {
        store.upsertTasks([result.current]);
        store.toast("info", "Cette tâche a été modifiée par quelqu'un d'autre : les valeurs ont été actualisées. Refaites votre modification si besoin.");
        return null;
      }
      if (previous) store.upsertTasks([previous]);
      store.toast("error", result.error);
      return null;
    },
    [afterMutation, store],
  );

  const run = useCallback<WorkApi["run"]>(
    async (call, success) => {
      try {
        const result = await call();
        if (!result.ok) {
          store.toast("error", result.error);
          return null;
        }
        if (success) store.toast("success", success);
        afterMutation();
        return result.data;
      } catch {
        store.toast("error", "Connexion au serveur impossible. Réessayez.");
        return null;
      }
    },
    [afterMutation, store],
  );

  // ── Temps réel ──
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let queue: ChangeEvent[] = [];
    let contextTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const events = queue;
      queue = [];
      const reloads = new Set<Reloader>();
      for (const event of events) {
        for (const reloader of store.reloaders.values()) if (reloader.scope(event)) reloads.add(reloader);
      }
      for (const reloader of reloads) void reloader.reload().catch(() => {});
      const taskIds = [...new Set(events.flatMap((e) => e.taskIds))];
      if (taskIds.length) store.set((s) => ({ remoteTick: s.remoteTick + 1, remoteTaskIds: taskIds }));
    };

    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/tasks/stream");
      source.addEventListener("change", (event) => {
        let data: ChangeEvent;
        try {
          data = JSON.parse((event as MessageEvent).data) as ChangeEvent;
        } catch {
          return;
        }
        if (data.kind === "notification" || data.kind === "context" || data.kind.startsWith("project")) {
          if (data.kind !== "notification" || data.forMe) {
            if (contextTimer) clearTimeout(contextTimer);
            contextTimer = setTimeout(() => {
              if (store.state.context) void reloadContext();
            }, 500);
          }
          if (data.kind === "notification") return;
        }
        queue.push(data);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 350);
      });
      source.onerror = () => {
        source?.close();
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const reloader of store.reloaders.values()) void reloader.reload().catch(() => {});
      if (store.state.context) void reloadContext();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (timer) clearTimeout(timer);
      if (contextTimer) clearTimeout(contextTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadContext, store]);

  const api = useMemo<WorkApi>(
    () => ({
      store,
      openTask: (id) => setTaskParam(id),
      closeTask: () => setTaskParam(null),
      mutateTask,
      run,
      ensureContext,
      reloadContext,
      afterMutation,
    }),
    [afterMutation, ensureContext, mutateTask, reloadContext, run, setTaskParam, store],
  );

  void meId;
  return <WorkContextReact.Provider value={api}>{children}</WorkContextReact.Provider>;
}

/**
 * Hydrate le store avec des données rendues par le serveur, une fois, pendant
 * le premier rendu (pour que le HTML serveur et le client affichent la même
 * chose), puis à chaque nouvelle version des props.
 */
export function useHydrate<T>(data: T, apply: (store: WorkStore, data: T, silent: boolean) => void) {
  const { store } = useWorkApi();
  const [first] = useState(() => {
    apply(store, data, true);
    return data;
  });
  useEffect(() => {
    if (data !== first) apply(store, data, false);
    // `apply` est stable par construction chez les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}
