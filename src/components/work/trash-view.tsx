"use client";

import { RotateCcw, Trash, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { previewProjectPurgeAction, purgeProjectAction, purgeTaskAction, restoreProjectAction, restoreTaskAction } from "@/app/(app)/tasks/work-actions";
import type { ProjectPurgePreview, ProjectTrashItem } from "@/lib/tasks/project-service";
import { relativeTime } from "@/lib/tasks/format";
import type { TrashItem } from "@/lib/tasks/service";

import { fetchJson, useWorkApi } from "./store";
import { BTN_DANGER, BTN_GHOST, BTN_SECONDARY, ConfirmModal, EmptyBlock, ErrorBlock, LoadingRows, Modal, ProjectIcon } from "./ui";

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
      {purgingProject && (
        <ProjectPurgeDialog
          project={purgingProject}
          onClose={() => setPurgingProject(null)}
          onPurged={() => {
            setProjects((list) => list.filter((p) => p.id !== purgingProject.id));
            setPurgingProject(null);
          }}
        />
      )}
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

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Confirmation de la suppression définitive d'un projet. Le périmètre vient
 * du serveur (`previewProjectPurgeAction`) ; à la confirmation, le serveur le
 * recalcule et refuse s'il a changé : le nouvel aperçu s'affiche alors, à
 * confirmer de nouveau.
 */
function ProjectPurgeDialog({ project, onClose, onPurged }: { project: ProjectTrashItem; onClose: () => void; onPurged: () => void }) {
  const { run, store } = useWorkApi();
  const [preview, setPreview] = useState<ProjectPurgePreview | null>(null);
  const [changed, setChanged] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await run(() => previewProjectPurgeAction(project.id));
      if (cancelled) return;
      if (data) setPreview(data);
      else onClose();
    })();
    return () => {
      cancelled = true;
    };
    // Chargement unique à l'ouverture ; `run` et `onClose` sont stables pour cet usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const confirm = async () => {
    if (!preview) return;
    setPending(true);
    try {
      const result = await run(() => purgeProjectAction(project.id, preview.token));
      if (!result) return;
      if (result.status === "scope_changed") {
        setPreview(result.preview);
        setChanged(true);
        setAcknowledged(false);
        return;
      }
      store.toast("success", `Projet « ${project.name} » supprimé définitivement.`);
      onPurged();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      title="Supprimer définitivement le projet ?"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_DANGER} disabled={!preview || !acknowledged || pending} onClick={() => void confirm()}>
            Supprimer définitivement
          </button>
        </>
      }
    >
      {!preview ? (
        <LoadingRows rows={3} />
      ) : (
        <div className="space-y-3 text-[13px] text-ink" data-testid="purge-preview">
          {changed && (
            <p role="alert" className="rounded-md border border-today-fg/40 bg-today-bg px-3 py-2 text-today-fg">
              Le périmètre a changé depuis l&apos;aperçu (une tâche a été ajoutée, restaurée ou rattachée ailleurs). Vérifiez le nouveau périmètre et confirmez à nouveau.
            </p>
          )}
          <p>
            Projet : <strong>« {preview.projectName} »</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Seront <strong>définitivement effacées</strong> : {plural(preview.purgedTasks, "tâche principale", "tâches principales")} et{" "}
              {plural(preview.purgedSubtasks, "sous-tâche", "sous-tâches")}
              {preview.deletedEarlier > 0 && <>, dont {preview.deletedEarlier} supprimée(s) individuellement auparavant</>}.
            </li>
            <li>
              Seront <strong>conservées</strong> : {plural(preview.keptTasks, "tâche partagée", "tâches partagées")} avec un autre projet conservé (actif ou dans la corbeille).
            </li>
            <li>
              Seront aussi effacés, pour les tâches effacées : {plural(preview.comments, "commentaire", "commentaires")}, {plural(preview.attachments, "pièce jointe", "pièces jointes")} et{" "}
              {plural(preview.historyEntries, "entrée d'historique", "entrées d'historique")} ; ainsi que les sections et rattachements du projet.
            </li>
          </ul>
          <p className="font-semibold text-critical-fg">Cette action est irréversible : rien ne pourra être restauré.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 accent-[var(--nod-accent)]" />
            <span>Je comprends que cette suppression est définitive et irréversible.</span>
          </label>
        </div>
      )}
    </Modal>
  );
}
