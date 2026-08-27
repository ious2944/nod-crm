import { connection } from "next/server";

import { AttentionSummary } from "@/components/cockpit/attention-summary";
import { CockpitHeader } from "@/components/cockpit/cockpit-header";
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
import { getActionableTasks } from "@/lib/tasks/queries";
import Link from "next/link";

export const metadata = {
  title: "Aujourd'hui — NOD CRM",
};

/** Même valeur que le tableau Follow-up : une échéance à trois jours. */
const DEFAULT_DUE_IN_DAYS = 3;

/**
 * Cockpit « Aujourd'hui » — V0.4.
 *
 * Étend le cockpit V0.3 avec le module Tâches. Règle fondamentale de
 * composition : V0.4 *ajoute* au cockpit V0.3, il ne le remplace pas.
 *
 * - `CockpitHeader` : salutation « Bonjour {prénom} » + date + actions.
 * - `AttentionSummary` : quatre indicateurs de suivi uniquement (late /
 *   today / upcoming / waiting) — inchangés par rapport à V0.3.
 * - Indicateur Tâches séparé : un lien explicitement nommé « Tâches »,
 *   distinct des quatre compteurs follow-up.
 * - Grille principale :
 *     - Colonne gauche  : PriorityFeed (suivis) + section Tâches actionnables.
 *     - Colonne droite  : UpcomingFollowUps + WaitingFollowUps (inchangés).
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const filter = parseCockpitFilter(params.f);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  // Fetch parallèle : suivis (cockpit V0.3) + tâches actionnables (V0.4).
  const [cockpit, actionableTasks] = await Promise.all([
    getCockpit(filter),
    getActionableTasks(endOfDay(today, APP_TIME_ZONE)),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <CockpitHeader
        name={greetingName(user.displayName, user.email)}
        dateLabel={todayLabel(new Date(), APP_TIME_ZONE)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NewTaskDialog defaultDueDate={today} />
            <NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />
          </div>
        }
      />

      {/* Indicateurs d'attention — suivis uniquement, identiques à V0.3. */}
      <section aria-label="Indicateurs d'attention">
        <AttentionSummary counters={cockpit.counters} filter={filter} />

        {/* Indicateur Tâches : explicitement séparé des quatre compteurs follow-up. */}
        {actionableTasks.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            <Link href="/tasks" className="font-medium text-ink hover:underline">
              {actionableTasks.length === 1
                ? "1 tâche à traiter"
                : `${actionableTasks.length} tâches à traiter`}
            </Link>
          </p>
        )}
      </section>

      {/* `grid-cols-1` explicite : sans lui, la colonne unique du mobile est une
          piste `auto`, dimensionnée sur le contenu le plus large — la page
          gagnait 50 px de défilement horizontal. Deux colonnes seulement à
          partir de `xl` : à 1024 px la colonne de droite tombait sous 280 px et
          n'affichait plus que des libellés tronqués. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-7">
        {/* Colonne gauche : suivis prioritaires (V0.3) + tâches actionnables (V0.4). */}
        <div className="min-w-0 space-y-6">
          <PriorityFeed section={cockpit.feed} filter={filter} />

          {/* Section Tâches actionnables — absente si aucune tâche due. */}
          {actionableTasks.length > 0 && (
            <section aria-label="Tâches à traiter">
              <h2 className="mb-3 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Tâches
              </h2>
              <ul className="space-y-2">
                {actionableTasks.map((task) => (
                  <li key={task.id}>
                    <TaskRow item={task} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Colonne droite : à venir + en attente chez eux (V0.3 inchangé). */}
        <div className="min-w-0 space-y-6">
          <UpcomingFollowUps section={cockpit.upcoming} />
          <WaitingFollowUps section={cockpit.waiting} />
        </div>
      </div>
    </div>
  );
}
