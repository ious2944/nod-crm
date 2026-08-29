import Link from "next/link";
import { connection } from "next/server";

import { NewOpportunityDialog } from "@/components/commerce/new-opportunity-dialog";
import { StatusBadge } from "@/components/commerce/status-badge";
import { commerceHeadline } from "@/lib/commerce/domain";
import {
  parseStatusFilter,
  STATUS_FILTER_LABELS,
  type StatusFilter,
} from "@/lib/commerce/filters";
import { getCommerceStats, listOpportunities } from "@/lib/commerce/queries";

export const metadata = {
  title: "Commerce — NOD CRM",
};

const FILTERS: StatusFilter[] = ["open", "closed", "all"];

/**
 * Liste des opportunités commerciales.
 *
 * Trois filtres d'URL (`?f=open|closed|all`), défaut « open ».
 * Aucune pagination pour l'instant : un pipeline de quelques dizaines d'affaires
 * ne justifie pas la complexité. On ajoutera une limite et un curseur si besoin.
 */
export default async function CommercePage({ searchParams }: PageProps<"/commerce">) {
  await connection();

  const filter = parseStatusFilter((await searchParams).f);
  const [items, stats] = await Promise.all([
    listOpportunities(filter),
    getCommerceStats(),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      {/* En-tête sticky */}
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Commerce
              </h1>
              <p className="text-sm text-muted">{commerceHeadline(stats.openCount)}</p>
            </div>
            <NewOpportunityDialog />
          </div>
        </div>
      </header>

      {/* Contenu */}
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Filtres */}
        <nav aria-label="Filtres" className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {FILTERS.map((key) => {
            const active = filter === key;
            const count =
              key === "open" ? stats.openCount : key === "closed" ? stats.closedCount : stats.openCount + stats.closedCount;

            return (
              <Link
                key={key}
                href={`/commerce?f=${key}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-accent text-accent-contrast shadow-sm"
                    : "bg-surface text-muted hover:bg-surface-muted hover:text-ink border border-border-subtle"
                }`}
              >
                {STATUS_FILTER_LABELS[key]}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </nav>

        {/* Liste */}
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            {filter === "open"
              ? "Aucune affaire ouverte. Crée ta première opportunité."
              : filter === "closed"
                ? "Aucune affaire clôturée."
                : "Aucune opportunité."}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/commerce/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-card transition-all hover:border-border-strong hover:shadow-card-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-ink">{item.name}</p>
                      <StatusBadge
                        label={item.statusLabel}
                        variant={item.statusVariant}
                      />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {item.organizationName}
                      {item.contactName && ` — ${item.contactName}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right text-xs text-muted">
                    {item.estimatedAmount && (
                      <p className="font-semibold text-ink">{item.estimatedAmount}</p>
                    )}
                    {item.expectedCloseDate && (
                      <p>Prévu le {item.expectedCloseDate}</p>
                    )}
                    {!item.isOpen && item.closedDate && (
                      <p>Clos le {item.closedDate}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
