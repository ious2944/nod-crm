import Link from "next/link";

import { DueBadge } from "@/components/ui/due-badge";
import type { TaskView } from "@/lib/tasks/view";
import { TaskAction, TaskActions, TaskSnoozeMenu } from "./task-actions";

/**
 * Une tâche, sur une ligne — V0.7 Lumina Enterprise.
 *
 * Volontairement pas une carte imposante : une tâche porte un titre, une
 * échéance et au plus deux liens de contexte.
 */
export function TaskRow({ item }: { item: TaskView }) {
  return (
    <article
      className={`flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-surface p-3.5 shadow-card transition-all hover:shadow-card-hover hover:border-border-strong sm:flex-row sm:items-center sm:gap-3 ${
        item.completed ? "opacity-70" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 shrink-0 text-sm ${item.completed ? "text-done-fg" : "text-muted"}`}
        >
          ✓
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              title={item.title}
              className={`min-w-0 truncate text-[15px] font-semibold leading-snug text-ink ${
                item.completed ? "line-through decoration-1" : ""
              }`}
            >
              {item.title}
            </h3>
            {item.isDemo && (
              <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
                démo
              </span>
            )}
          </div>

          <TaskMeta item={item} />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <DueBadge level={item.level} label={item.dueLabel} />

        <TaskActions className="flex flex-wrap items-center gap-2">
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
    </article>
  );
}

function TaskMeta({ item }: { item: TaskView }) {
  if (!item.contactName && !item.followUpLabel && !item.notes) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
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
