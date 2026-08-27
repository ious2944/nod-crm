import Link from "next/link";

import { organizationContactLabel, websiteDisplayLabel } from "@/lib/organizations/view";
import type { OrganizationListItem } from "@/lib/organizations/view";
import { OrganizationActions } from "./organization-actions";

/**
 * Une ligne de la liste Organisations.
 *
 * Même densité que la liste Contacts : card-style, lien sur la zone
 * d'information, menu ⋮ en dehors du lien.
 */
export function OrganizationRow({ organization }: { organization: OrganizationListItem }) {
  const domainLabel = websiteDisplayLabel(organization.website);

  return (
    <article className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface p-4 transition-shadow hover:shadow-sm sm:gap-4 sm:p-5">
      {/* Icône organisation */}
      <div
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-base"
      >
        ▤
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={`/organizations/${organization.id}`}
          className="text-[15px] font-semibold leading-snug text-ink hover:underline"
        >
          {organization.name}
        </Link>

        {domainLabel && (
          <p className="mt-0.5 truncate text-[13px] text-muted">{domainLabel}</p>
        )}

        <div className="mt-1 space-y-0.5 text-[13px] text-muted">
          {organization.email && (
            <p className="truncate">{organization.email}</p>
          )}
          {organization.phone && (
            <p className="truncate">{organization.phone}</p>
          )}
        </div>

        <p
          className={`mt-2 text-xs font-medium ${
            organization.contactCount > 0 ? "text-accent" : "text-muted"
          }`}
        >
          {organizationContactLabel(organization.contactCount)}
          {organization.archived && (
            <span className="ml-2 rounded-full border border-border-strong px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
              archivée
            </span>
          )}
        </p>
      </div>

      <OrganizationActions
        organization={organization.form}
        archived={organization.archived}
        variant="menu"
      />
    </article>
  );
}
