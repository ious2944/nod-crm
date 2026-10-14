"use client";

import { RotateCcw, Trash, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { purgeTaskAction, restoreTaskAction } from "@/app/(app)/tasks/work-actions";
import { relativeTime } from "@/lib/tasks/format";
import type { TrashItem } from "@/lib/tasks/service";

import { fetchJson, useWorkApi } from "./store";
import { BTN_GHOST, ConfirmModal, EmptyBlock, ErrorBlock, LoadingRows } from "./ui";

/**
 * Corbeille : les tâches supprimées restent en base avec leurs commentaires,
 * pièces jointes et historique. Restaurer demande les droits d'édition d'un
 * projet de la tâche ; la suppression définitive est réservée au propriétaire
 * de tous ses projets (tâche libre : son créateur ou la personne qui l'a
 * supprimée). Les droits sont vérifiés par le serveur.
 */
export function TrashView() {
  const { run, store } = useWorkApi();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashItem | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ items: TrashItem[] }>("/api/tasks/trash");
      setItems(data.items);
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
  useEffect(() => store.register({ scope: (e) => e.kind === "task_deleted" || e.kind === "task_created", reload: load }), [load, store]);

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
        <p className="text-[12px] text-muted">Les tâches supprimées sont conservées ici jusqu&apos;à leur suppression définitive.</p>
      </header>
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {!error && items === null && <LoadingRows />}
      {items && items.length === 0 && <EmptyBlock icon={Trash} title="La corbeille est vide" description="Les tâches que vous pouvez restaurer apparaîtront ici." />}
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
