"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buildOrganizationListHref, type OrganizationListParams } from "@/lib/organizations/filters";

/**
 * Barre de recherche et filtre archivées de la liste Organisations.
 *
 * Même pattern que la barre de contacts : paramètres d'URL, pas d'état local.
 */
export function OrganizationToolbar({ params }: { params: OrganizationListParams }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const update = (overrides: Partial<OrganizationListParams>) => {
    startTransition(() => {
      router.push(buildOrganizationListHref({ ...params, ...overrides, page: 1 }));
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1">
        <label className="sr-only" htmlFor="org-search">
          Rechercher une organisation
        </label>
        <input
          id="org-search"
          type="search"
          defaultValue={params.search}
          placeholder="Rechercher…"
          disabled={pending}
          onChange={(event) => update({ search: event.target.value })}
          className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={params.archived}
          onChange={(event) => update({ archived: event.target.checked })}
          className="rounded border-border-strong"
        />
        Afficher archivées
      </label>
    </div>
  );
}
