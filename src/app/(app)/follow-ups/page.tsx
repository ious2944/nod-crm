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
 * Liste des suivis — V0.7 Lumina Enterprise.
 *
 * Un suivi, c'est **quelque chose à faire avancer avec quelqu'un** : il a une
 * balle, des relances et un interlocuteur. Pour « quelque chose à faire » tout
 * court, c'est la page Tâches.
 */
export default async function FollowUpsPage({ searchParams }: PageProps<"/follow-ups">) {
  await connection();

  const resolvedParams = await searchParams;
  const filter = parseFilter(resolvedParams.f);
  const query = parseSearchQuery(resolvedParams.q);

  const board = await getFollowUpBoard(filter, query);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="flex min-h-full flex-col">
      {/* En-tête sticky de la page */}
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Suivis
              </h1>
              <AttentionHeadline count={board.stats.needsAttention} />
            </div>
            <NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />
          </div>
        </div>
      </header>

      {/* Contenu scrollable */}
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Métriques */}
        <section aria-label="Indicateurs">
          <StatTiles stats={board.stats} filter={filter} query={query} />
        </section>

        {/* Recherche + filtres */}
        <section aria-label="Filtres et recherche" className="space-y-3">
          <FollowUpSearchBar filter={filter} query={query} />
          <FilterTabs filter={filter} query={query} />
        </section>

        {/* Liste des suivis */}
        <section aria-label="Suivis">
          {board.items.length === 0 ? (
            <EmptyState filter={filter} hasQuery={query !== ""} />
          ) : (
            <ul className="space-y-3">
              {board.items.map((item) => (
                <li key={item.id}>
                  <FollowUpCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
