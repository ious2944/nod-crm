import { connection } from "next/server";

import {
  AttentionHeadline,
  FilterTabs,
  StatTiles,
} from "@/components/follow-ups/board-header";
import { EmptyState } from "@/components/follow-ups/empty-state";
import { FollowUpCard } from "@/components/follow-ups/follow-up-card";
import { FollowUpSearchBar } from "@/components/follow-ups/follow-up-search-bar";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { parseFilter, parseSearchQuery } from "@/lib/follow-ups/filters";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";

export const metadata = {
  title: "Suivis — NOD CRM",
};

/** Échéance proposée par défaut : dans 3 jours. */
const DEFAULT_DUE_IN_DAYS = 3;

/**
 * Liste des suivis.
 *
 * Un suivi, c'est **quelque chose à faire avancer avec quelqu'un** : il a une
 * balle, des relances et un interlocuteur. Pour « quelque chose à faire » tout
 * court, c'est la page Tâches.
 *
 * V0.6 : barre de recherche (`?q=`) et bouton « Modifier » sur chaque carte.
 * Les filtres existants (`?f=`) sont inchangés et s'appliquent en AND avec la
 * recherche.
 */
export default async function FollowUpsPage({ searchParams }: PageProps<"/follow-ups">) {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const resolvedParams = await searchParams;
  const filter = parseFilter(resolvedParams.f);
  const query = parseSearchQuery(resolvedParams.q);

  // Les contacts ne sont plus chargés ici : le sélecteur les cherche à la demande.
  const board = await getFollowUpBoard(filter, query);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Suivis</h1>
          <AttentionHeadline count={board.stats.needsAttention} />
        </div>
        <NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />
      </header>

      <section aria-label="Indicateurs" className="mt-6">
        <StatTiles stats={board.stats} filter={filter} query={query} />
      </section>

      <section aria-label="Suivis" className="mt-6 space-y-4">
        <div className="space-y-3">
          <FollowUpSearchBar filter={filter} query={query} />
          <FilterTabs filter={filter} query={query} />
        </div>

        {board.items.length === 0 ? (
          <EmptyState filter={filter} hasQuery={query !== ""} />
        ) : (
          <ul className="space-y-2.5">
            {board.items.map((item) => (
              <li key={item.id}>
                <FollowUpCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
