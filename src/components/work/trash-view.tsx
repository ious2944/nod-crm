"use client";

import { RotateCcw, Trash, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { purgeProjectAction, purgeTaskAction, restoreProjectAction, restoreTaskAction } from "@/app/(app)/tasks/work-actions";
import type { ProjectTrashItem } from "@/lib/tasks/project-service";
import { relativeTime } from "@/lib/tasks/format";
import type { TrashItem } from "@/lib/tasks/service";

import { fetchJson, useWorkApi } from "./store";
import { BTN_GHOST, ConfirmModal, EmptyBlock, ErrorBlock, LoadingRows, ProjectIcon } from "./ui";

/**
 * Corbeille : tâches et projets supprimés. Les tâches supprimées restent en base avec leurs commentaires,
 * pièces jointes et historique. Restaurer demande les droits d'édition d'un
 * projet de la tâche ; la suppression définitive est réservée au propriétaire
 * de tous ses projets (tâche libre : son créateur ou la personne qui l'a
 * supprimée). Les droits sont vérifiés par le serveur.
 */
export function TrashView() {
  const { run, store, reloadContext } = useWorkApi();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [projects, setProjects] = useState<ProjectTrashItem[]>([]);
  const [purgingProject, setPurgingProject] = useState<ProjectTrashItem | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ items: TrashItem[]; projects: ProjectTrashItem[] }>("/api/tasks/trash");
      setItems(data.items);
      setProjects(data.projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, []);
  useEffect(() => {
    // Chargement des données : l'état n'est mis à jour qu'au retour du réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(
    () => store.register({ scope: (e) => e.kind === "task_deleted" || e.kind === "task_created" || e.kind === "project_deleted" || e.kind === "project", reload: load }),
    [load, store],
  );

  const restoreProject = async (item: ProjectTrashItem) => {
    const done = await run(() => restoreProjectAction(item.id), `Projet « ${item.name} » restauré.`);
    if (done) {
      setProjects((list) => list.filter((p) => p.id !== item.id));
      await reloadContext();
      void load();
    }
  };

  const restore = async (item: TrashItem) => {
    const task = await run(() => restoreTaskAction(item.id), "Tâche restaurée.");
    if (task) {
      store.upsertTasks([task]);
      setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
    }
  };

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="flex-1 text-[18px] font-semibold text-ink">Corbeille</h1>
        <p className="text-[12px] text-muted">Les tâches et projets supprimés sont conservés ici jusqu&apos;à leur suppression définitive.</p>
      </header>
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {!error && items === null && <LoadingRows />}
      {projects.length > 0 && (
        <section aria-label="Projets dans la corbeille" className="border-b border-border-subtle">
          <h2 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">Projets</h2>
          <ul className="divide-y divide-border-subtle">
            {projects.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <ProjectIcon icon={item.icon} color={item.color} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{item.name}</p>
                  <p className="truncate text-[12px] text-muted">
                    Supprimé {relativeTime(item.deletedAt)}
                    {item.deletedBy && ` par ${item.deletedBy}`} · {item.taskCount} tâche(s) avec lui
                    {item.visibility === "PRIVATE" && " · privé"}
                  </p>
                </div>
                {item.canRestore && (
                  <button type="button" className={BTN_GHOST} onClick={() => void restoreProject(item)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restaurer le projet
                  </button>
                )}
                {item.canPurge && (
                  <button type="button" className={`${BTN_GHOST} text-critical-fg`} onClick={() => setPurgingProject(item)}>
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer définitivement
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {items && items.length > 0 && projects.length > 0 && <h2 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">Tâches</h2>}
      {items && items.length === 0 && projects.length === 0 && <EmptyBlock icon={Trash} title="La corbeille est vide" description="Les tâches et projets que vous pouvez restaurer apparaîtront ici." />}
      {items && items.length > 0 && (
        <ul className="divide-y divide-border-subtle" aria-label="Tâches dans la corbeille">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="truncate text-[12px] text-muted">
                  Supprimée {relativeTime(item.deletedAt)}
                  {item.deletedBy && ` par ${item.deletedBy}`}
                  {item.parentTitle && ` · sous-tâche de « ${item.parentTitle} »`}
                  {item.projects.length > 0 && ` · ${item.projects.join(", ")}`}
                  {item.subtaskCount > 0 && ` · ${item.subtaskCount} sous-tâche(s)`}
                </p>
              </div>
              {item.canRestore && (
                <button type="button" className={BTN_GHOST} onClick={() => void restore(item)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurer
                </button>
              )}
              {item.canPurge && (
                <button type="button" className={`${BTN_GHOST} text-critical-fg`} onClick={() => setPurging(item)}>
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer définitivement
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={purgingProject !== null}
        title="Supprimer définitivement le projet ?"
        description={
          purgingProject
            ? `« ${purgingProject.name} » sera effacé avec ses sections et les tâches qui n'appartiennent à aucun autre projet (sous-tâches, commentaires, pièces jointes, historique). Les tâches encore liées à un autre projet sont conservées. Cette action est irréversible.`
            : null
        }
        confirmLabel="Supprimer définitivement"
        onClose={() => setPurgingProject(null)}
        onConfirm={async () => {
          if (!purgingProject) return;
          const done = await run(() => purgeProjectAction(purgingProject.id), "Projet supprimé définitivement.");
          if (done) setProjects((list) => list.filter((p) => p.id !== purgingProject.id));
          setPurgingProject(null);
        }}
      />
      <ConfirmModal
        open={purging !== null}
        title="Supprimer définitivement ?"
        description={purging ? `« ${purging.title} » sera effacée avec ses sous-tâches, commentaires, pièces jointes et historique. Cette action est irréversible.` : null}
        confirmLabel="Supprimer définitivement"
        onClose={() => setPurging(null)}
        onConfirm={async () => {
          if (!purging) return;
          const done = await run(() => purgeTaskAction(purging.id), "Tâche supprimée définitivement.");
          if (done !== null) setItems((list) => list?.filter((i) => i.id !== purging.id) ?? null);
          setPurging(null);
        }}
      />
    </div>
  );
}
