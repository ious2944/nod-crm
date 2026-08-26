import { connection } from "next/server";

import { FollowUpCard } from "@/components/follow-ups/follow-up-card";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { TodayEmptyState } from "@/components/tasks/empty-state";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { TaskRow } from "@/components/tasks/task-row";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { cockpitHeadline } from "@/lib/today/feed";
import { getTodayFeed } from "@/lib/today/queries";

export const metadata = {
  title: "Aujourd'hui — NOD CRM",
};

/** Échéance proposée par défaut pour un nouveau suivi : dans 3 jours. */
const DEFAULT_FOLLOW_UP_DUE_IN_DAYS = 3;

/**
 * Cockpit « Aujourd'hui ».
 *
 * Une seule question : **qu'est-ce qui demande une action maintenant ?** Le feed
 * réunit donc les deux natures d'objet — les suivis dont l'échéance est atteinte
 * et les tâches dues aujourd'hui ou en retard — sans les confondre : un suivi
 * garde sa carte, ses relances et sa balle ; une tâche garde sa ligne et ses
 * deux boutons.
 *
 * Ce n'est pas un tableau de bord des tâches : les compteurs de suivis
 * (« Ouverts », « Chez moi », « Chez eux », « À relancer ») restent sur la page
 * Suivis, où ils gardent exactement le sens qu'ils avaient en V0.3.
 */
export default async function TodayPage() {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const feed = await getTodayFeed();
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Aujourd&apos;hui
          </h1>
          <p className={`text-sm ${feed.length === 0 ? "text-done-fg" : "text-muted"}`}>
            {feed.length === 0 && <span aria-hidden>✓ </span>}
            {cockpitHeadline(feed.length)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewTaskDialog defaultDueDate={today} />
          <NewFollowUpDialog
            defaultDueDate={addDaysToKey(today, DEFAULT_FOLLOW_UP_DUE_IN_DAYS)}
            triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
          />
        </div>
      </header>

      <section aria-label="À traiter" className="mt-6 space-y-2.5">
        <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          À traiter
        </h2>

        {feed.length === 0 ? (
          <TodayEmptyState />
        ) : (
          <ul className="space-y-2.5">
            {feed.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                {item.kind === "follow-up" ? (
                  <FollowUpCard item={item.followUp} />
                ) : (
                  <TaskRow item={item.task} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
