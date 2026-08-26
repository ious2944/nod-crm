import { connection } from "next/server";

import { AttentionSummary } from "@/components/cockpit/attention-summary";
import { CockpitHeader } from "@/components/cockpit/cockpit-header";
import { PriorityFeed } from "@/components/cockpit/priority-feed";
import { UpcomingFollowUps } from "@/components/cockpit/upcoming-follow-ups";
import { WaitingFollowUps } from "@/components/cockpit/waiting-follow-ups";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { requireUser } from "@/lib/auth/dal";
import { greetingName } from "@/lib/cockpit/domain";
import { parseCockpitFilter } from "@/lib/cockpit/filters";
import { getCockpit } from "@/lib/cockpit/queries";
import { todayLabel } from "@/lib/cockpit/view";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";

export const metadata = {
  title: "Aujourd'hui — NOD CRM",
};

/** Même valeur que le tableau Follow-up : une échéance à trois jours. */
const DEFAULT_DUE_IN_DAYS = 3;

/**
 * Cockpit « Aujourd'hui ».
 *
 * L'écran répond à une seule question : *qu'est-ce que je dois faire
 * maintenant, avec qui, et qu'est-ce qui risque de m'échapper ?* Il n'agrège
 * rien, ne calcule aucun indicateur commercial et n'affiche aucun graphique —
 * c'est un plan de travail, pas un tableau de bord.
 *
 * Composition volontairement plate : chaque zone est un composant autonome,
 * nourri par `getCockpit()`. En ajouter une (notes rapides, rappels, bloc
 * Mirai) revient à insérer un composant dans cette grille et une projection
 * dans la requête — pas à refondre la page.
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const filter = parseCockpitFilter(params.f);
  const cockpit = await getCockpit(filter);

  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <CockpitHeader
        name={greetingName(user.displayName, user.email)}
        dateLabel={todayLabel(new Date(), APP_TIME_ZONE)}
        // Emplacement `search` volontairement vide tant que la recherche
        // globale n'existe pas : pas de champ décoratif qui ne cherche rien.
        actions={<NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />}
      />

      <section aria-label="Indicateurs d'attention">
        <AttentionSummary counters={cockpit.counters} filter={filter} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-7">
        <PriorityFeed section={cockpit.feed} filter={filter} />

        <div className="space-y-6">
          <UpcomingFollowUps section={cockpit.upcoming} />
          <WaitingFollowUps section={cockpit.waiting} />
        </div>
      </div>
    </div>
  );
}
