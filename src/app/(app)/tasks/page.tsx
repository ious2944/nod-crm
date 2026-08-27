import Link from "next/link";
import { connection } from "next/server";

import { TasksEmptyState } from "@/components/tasks/empty-state";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskRow } from "@/components/tasks/task-row";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey } from "@/lib/date";
import { taskHeadline } from "@/lib/tasks/domain";
import { TASK_FILTERS, parseTaskFilter } from "@/lib/tasks/filters";
import { getTaskList } from "@/lib/tasks/queries";

export const metadata = {
  title: "Tâches — NOD CRM",
};

/**
 * Liste des tâches.
 *
 * Une tâche, c'est **quelque chose à faire**. Pas de balle, pas de relance :
 * pour « faire avancer quelque chose avec quelqu'un », c'est la page Suivis.
 *
 * L'ordre est celui de l'urgence — en retard, aujourd'hui, à venir — et les
 * tâches terminées ne polluent pas cette liste : elles sont à un onglet de là.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const filter = parseTaskFilter((await searchParams).f);
  const list = await getTaskList(filter);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tâches</h1>
          <p className="text-sm text-muted">{taskHeadline(list.todoCount)}</p>
        </div>
        {/* Échéance par défaut : aujourd'hui. Une tâche qu'on note, c'est le
            plus souvent une tâche du jour. */}
        <NewTaskDialog defaultDueDate={today} />
      </header>

      <section aria-label="Tâches" className="mt-6 space-y-4">
        <nav aria-label="Filtres" className="-mx-1 flex flex-wrap gap-1 px-1 pb-1">
          {TASK_FILTERS.map((item) => {
            const active = filter === item.key;
            const count = item.key === "todo" ? list.todoCount : list.completedCount;

            return (
              <Link
                key={item.key}
                href={`/tasks?f=${item.key}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border-subtle bg-surface text-muted hover:text-ink"
                }`}
              >
                {item.label}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </nav>

        {filter === "done" ? (
          list.completed.length === 0 ? (
            <TasksEmptyState filter="done" />
          ) : (
            <ul className="space-y-2">
              {list.completed.map((item) => (
                <li key={item.id}>
                  <TaskRow item={item} />
                </li>
              ))}
            </ul>
          )
        ) : list.sections.length === 0 ? (
          <TasksEmptyState filter="todo" />
        ) : (
          list.sections.map((section) => (
            <section key={section.bucket} aria-label={section.label} className="space-y-2">
              <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {section.label}
                <span className="ml-1.5 tabular-nums opacity-70">{section.items.length}</span>
              </h2>
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <TaskRow item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </div>
  );
}
