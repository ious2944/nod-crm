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
 * Liste des tâches — V0.7 Lumina Enterprise.
 *
 * Une tâche, c'est **quelque chose à faire**. Pas de balle, pas de relance.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  await connection();

  const filter = parseTaskFilter((await searchParams).f);
  const list = await getTaskList(filter);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="flex min-h-full flex-col">
      {/* En-tête sticky */}
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Tâches
              </h1>
              <p className="text-sm text-muted">{taskHeadline(list.todoCount)}</p>
            </div>
            <NewTaskDialog defaultDueDate={today} />
          </div>
        </div>
      </header>

      {/* Contenu scrollable */}
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Filtres */}
        <nav aria-label="Filtres" className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {TASK_FILTERS.map((item) => {
            const active = filter === item.key;
            const count = item.key === "todo" ? list.todoCount : list.completedCount;

            return (
              <Link
                key={item.key}
                href={`/tasks?f=${item.key}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-accent text-accent-contrast shadow-sm"
                    : "bg-surface text-muted hover:bg-surface-muted hover:text-ink border border-border-subtle"
                }`}
              >
                {item.label}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </nav>

        {/* Liste */}
        <section aria-label="Tâches">
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
              <section
                key={section.bucket}
                aria-label={section.label}
                className="mb-6 space-y-2"
              >
                <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted">
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
    </div>
  );
}
