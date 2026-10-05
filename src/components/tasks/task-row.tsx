import Link from "next/link";

import { DueBadge } from "@/components/ui/due-badge";
import type { TaskView } from "@/lib/tasks/view";
import { EditTaskDialog } from "./edit-task-dialog";
import { TaskAction, TaskActions, TaskSnoozeMenu } from "./task-actions";

/**
 * Une tâche, sur une ligne — V0.7 Lumina Enterprise.
 *
 * Volontairement pas une carte imposante : une tâche porte un titre, une
 * échéance et au plus deux liens de contexte.
 */
export function TaskRow({ item }: { item: TaskView }) {
  return (
    // Deux lignes plutôt qu'une : sur une seule ligne, l'échéance et les trois
    // actions (`shrink-0`) prenaient la largeur en priorité et le titre, seul
    // élément compressible, finissait tronqué à quelques mots. Le titre a
    // désormais sa ligne, partagée avec la seule échéance ; contexte et
    // actions passent dessous.
    <article
      className={`flex items-start gap-3 rounded-xl border border-border-subtle bg-surface p-3.5 shadow-card transition-all hover:shadow-card-hover hover:border-border-strong ${
        item.completed ? "opacity-70" : ""
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 text-sm ${item.completed ? "text-done-fg" : "text-muted"}`}
      >
        ✓
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {/* Deux lignes au plus dès qu'il y a de la largeur, le titre complet
                restant au survol ; sur mobile, les badges partagent déjà la
                ligne : le titre s'affiche en entier. */}
            <h3
              title={item.title}
              className={`min-w-0 break-words sm:line-clamp-2 text-[15px] font-semibold leading-snug text-ink ${
                item.completed ? "line-through decoration-1" : ""
              }`}
            >
              {item.title}
            </h3>
            {item.isDemo && (
              <span className="mt-0.5 shrink-0 rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
                démo
              </span>
            )}
          </div>

          <DueBadge level={item.level} label={item.dueLabel} />
        </div>

        {/* `flex-wrap` : le message d'erreur des actions (`basis-full`) doit
            pouvoir passer sur sa propre ligne. */}
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4">
          <TaskMeta item={item} />

          <TaskActions className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
            <EditTaskDialog item={item} />
            {item.completed ? (
              <TaskAction id={item.id} intent="reopen" label="Rouvrir" />
            ) : (
              <>
                <TaskAction id={item.id} intent="complete" label="Terminer" variant="primary" />
                <TaskSnoozeMenu id={item.id} />
              </>
            )}
          </TaskActions>
        </div>
      </div>
    </article>
  );
}

function TaskMeta({ item }: { item: TaskView }) {
  if (!item.contactName && !item.followUpLabel && !item.notes) return null;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      {item.contactName && item.contactId && (
        <Link
          href={`/contacts/${item.contactId}`}
          className="max-w-full truncate text-ink underline-offset-2 hover:underline"
        >
          {item.contactName}
          {item.contactArchived && <span className="text-muted"> · archivé</span>}
        </Link>
      )}

      {item.followUpLabel && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span aria-hidden className="shrink-0 opacity-70">
            🏓
          </span>
          <span className="truncate" title={item.followUpLabel}>
            Lié à {item.followUpLabel}
          </span>
        </span>
      )}

      {item.notes && (
        <span className="min-w-0 max-w-full truncate italic" title={item.notes}>
          {item.notes}
        </span>
      )}
    </div>
  );
}
