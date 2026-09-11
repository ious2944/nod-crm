import { connection } from "next/server";

import { Pagination } from "@/components/ui/pagination";
import { NewOrganizationButton } from "@/components/organizations/new-organization-button";
import { OrganizationRow } from "@/components/organizations/organization-row";
import { OrganizationToolbar } from "@/components/organizations/organization-toolbar";
import {
  buildOrganizationListHref,
  DEFAULT_ORG_LIST_PARAMS,
  parseOrganizationListParams,
} from "@/lib/organizations/filters";
import { listOrganizationsPage } from "@/lib/organizations/queries";

export const metadata = {
  title: "Organisations — NOD CRM",
};

export default async function OrganizationsPage({ searchParams }: PageProps<"/organizations">) {
  await connection();

  const params = parseOrganizationListParams(await searchParams);

  const page = await listOrganizationsPage(params);

  const isFiltered =
    params.search !== DEFAULT_ORG_LIST_PARAMS.search ||
    params.archived !== DEFAULT_ORG_LIST_PARAMS.archived;

  return (
    <div className="flex min-h-full flex-col">
      {/* En-tête sticky */}
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                Organisations
              </h1>
              <p className="text-sm text-muted">
                Les entreprises et structures avec lesquelles tu travailles.
              </p>
            </div>
            <NewOrganizationButton />
          </div>
        </div>
      </header>

      {/* Contenu scrollable */}
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Recherche et filtres */}
        <section aria-label="Recherche et filtres">
          <OrganizationToolbar params={params} />
        </section>

        {/* Liste */}
        <section aria-label="Organisations">
          {page.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-14 text-center shadow-card">
              <p aria-hidden className="text-3xl">
                {isFiltered ? "🔍" : "▤"}
              </p>
              <p className="mt-3 text-base font-semibold text-ink">
                {isFiltered ? "Aucune organisation ne correspond" : "Aucune organisation"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {isFiltered
                  ? "Essaie un autre mot, ou relâche le filtre."
                  : "Crée ta première organisation : un nom suffit pour démarrer."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {page.items.map((organization) => (
                <li key={organization.id}>
                  <OrganizationRow organization={organization} />
                </li>
              ))}
            </ul>
          )}

          {page.pageCount > 1 && (
            <div className="mt-6">
              <Pagination
                page={page.page}
                pageCount={page.pageCount}
                total={page.total}
                itemLabel={{ singular: "organisation", plural: "organisations" }}
                buildHref={(n) => buildOrganizationListHref({ ...params, page: n })}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
