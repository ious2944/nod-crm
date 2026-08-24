import { connection } from "next/server";

import {
  AttentionHeadline,
  FilterTabs,
  StatTiles,
} from "@/components/follow-ups/board-header";
import { EmptyState } from "@/components/follow-ups/empty-state";
import { FollowUpCard } from "@/components/follow-ups/follow-up-card";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { parseFilter } from "@/lib/follow-ups/filters";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";

export const metadata = {
  title: "Follow-up — NOD CRM",
};

/** Échéance proposée par défaut : dans 3 jours. */
const DEFAULT_DUE_IN_DAYS = 3;

export default async function FollowUpsPage({ searchParams }: PageProps<"/follow-ups">) {
  // La page dépend de l'heure et de la base : elle est rendue à chaque requête.
  await connection();

  const filter = parseFilter((await searchParams).f);
  // Les contacts ne sont plus chargés ici : le sélecteur du formulaire les
  // cherche côté serveur à la demande (`ContactPicker`).
  const board = await getFollowUpBoard(filter);
  const today = dayKey(new Date(), APP_TIME_ZONE);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Aujourd&apos;hui</h1>
          <AttentionHeadline count={board.stats.needsAttention} />
        </div>
        <NewFollowUpDialog defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)} />
      </header>

      <section aria-label="Indicateurs" className="mt-6">
        <StatTiles stats={board.stats} filter={filter} />
      </section>

      <section aria-label="Suivis" className="mt-6 space-y-4">
        <FilterTabs filter={filter} />

        {board.items.length === 0 ? (
          <EmptyState filter={filter} />
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
