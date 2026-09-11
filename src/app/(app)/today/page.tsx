import { connection } from "next/server";

import { AttentionSummary } from "@/components/cockpit/attention-summary";
import { PriorityFeed } from "@/components/cockpit/priority-feed";
import { UpcomingFollowUps } from "@/components/cockpit/upcoming-follow-ups";
import { WaitingFollowUps } from "@/components/cockpit/waiting-follow-ups";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskRow } from "@/components/tasks/task-row";
import { requireUser } from "@/lib/auth/dal";
import { greetingName } from "@/lib/cockpit/domain";
import { parseCockpitFilter } from "@/lib/cockpit/filters";
import { getCockpit } from "@/lib/cockpit/queries";
import { todayLabel } from "@/lib/cockpit/view";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey, endOfDay } from "@/lib/date";
import { computeTaskKpiCounts, filterTasksForKpi, mergeAttentionCounters } from "@/lib/today/feed";
import { getTasksForKpi } from "@/lib/tasks/queries";
import { UPCOMING_WINDOW_DAYS } from "@/lib/cockpit/domain";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = {
  title: "Aujourd'hui — NOD CRM",
};

const DEFAULT_DUE_IN_DAYS = 3;

export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  await connection();

  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const filter = parseCockpitFilter(params.f);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  // `endOfKpiWindow` couvre la fenêtre « À venir » (UPCOMING_WINDOW_DAYS jours)
  // pour que le KPI « À venir » intègre les tâches futures proches, exactement
  // comme il le fait pour les suivis.
  const endOfKpiWindow = endOfDay(addDaysToKey(today, UPCOMING_WINDOW_DAYS), APP_TIME_ZONE);

  const [cockpit, tasksInWindow] = await Promise.all([
    getCockpit(filter),
    getTasksForKpi(endOfKpiWindow),
  ]);

  // Compteurs combinés suivis + tâches pour les 4 KPI.
  const counters = mergeAttentionCounters(
    cockpit.counters,
    computeTaskKpiCounts(tasksInWindow),
  );

  // Tâches à afficher selon le filtre actif — cohérence avec le compteur affiché.
  const displayTasks = filterTasksForKpi(tasksInWindow, filter);
  // Nombre de tâches actionnables (en retard + aujourd'hui) pour le lien résumé.
  const actionableTaskCount = tasksInWindow.filter((t) => t.isActionable).length;

  return (
    <div className="flex min-h-full flex-col">
      {/* En-tête sticky */}
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                {todayLabel(new Date(), APP_TIME_ZONE)}
              </p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-ink sm:text-2xl">
                Bonjour {greetingName(user.displayName, user.email)} 👋
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NewTaskDialog defaultDueDate={today} />
              <NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />
            </div>
          </div>
        </div>
      </header>

      {/* Contenu scrollable */}
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {cockpit.openTotal === 0 && tasksInWindow.length === 0 && (
          <EmptyState
            title="Votre espace est prêt"
            description="Commencez par créer un suivi ou une tâche. Tout ce qui requiert votre attention apparaîtra ici au fil du temps."
            action={{ label: "Créer un suivi", href: "/follow-ups" }}
          />
        )}
        {/* Indicateurs d'attention */}
        <section aria-label="Indicateurs d'attention">
          <AttentionSummary counters={counters} filter={filter} />

          {actionableTaskCount > 0 && (
            <p className="mt-3 text-sm text-muted">
              <Link href="/tasks" className="font-semibold text-ink hover:underline">
                {actionableTaskCount === 1
                  ? "1 tâche à traiter"
                  : `${actionableTaskCount} tâches à traiter`}
              </Link>
            </p>
          )}
        </section>

        {/* Grille principale */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-7">
          {/* Colonne gauche : suivis prioritaires + tâches */}
          <div className="min-w-0 space-y-6">
            <PriorityFeed section={cockpit.feed} filter={filter} />

            {displayTasks.length > 0 && (
              <section aria-label="Tâches à traiter">
                <h2 className="mb-3 px-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Tâches
                </h2>
                <ul className="space-y-2">
                  {displayTasks.map((task) => (
                    <li key={task.id}>
                      <TaskRow item={task} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Colonne droite : à venir + en attente */}
          <div className="min-w-0 space-y-6">
            <UpcomingFollowUps section={cockpit.upcoming} />
            <WaitingFollowUps section={cockpit.waiting} />
          </div>
        </div>
      </div>
    </div>
  );
}
