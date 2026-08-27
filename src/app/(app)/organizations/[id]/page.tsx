import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { OrganizationActions } from "@/components/organizations/organization-actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { getOrganizationDetail } from "@/lib/organizations/queries";
import { organizationContactLabel, websiteDisplayLabel } from "@/lib/organizations/view";

export const metadata = {
  title: "Organisation — NOD CRM",
};

/** Couleurs sémantiques par niveau d'urgence — même palette que la fiche Contact. */
const TIER_CLASS: Record<string, string> = {
  calm: "text-muted",
  soon: "text-muted",
  today: "text-warning-fg",
  late: "text-critical-fg",
  critical: "font-semibold text-critical-fg",
};

export default async function OrganizationPage({ params }: PageProps<"/organizations/[id]">) {
  await connection();

  const { id } = await params;
  const org = await getOrganizationDetail(id);

  // Fail-closed : on ne distingue pas « inexistant » de « autre workspace ».
  if (!org) {
    notFound();
  }

  const websiteLabel = websiteDisplayLabel(org.website);
  const createdDate = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(org.createdAt));

  const formValues = {
    id: org.id,
    name: org.name,
    website: org.website,
    phone: org.phone,
    email: org.email,
    notes: org.notes,
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/organizations"
        className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← Organisations
      </Link>

      {org.archived && (
        <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
          Cette organisation est archivée : elle n&apos;apparaît plus dans la liste ni dans le
          sélecteur de contact. Tu peux la restaurer depuis cette page.
        </p>
      )}

      <header className="mt-4 flex flex-wrap items-start gap-4">
        <div
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-xl"
        >
          ▤
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          {websiteLabel && (
            <p className="mt-0.5 text-sm text-muted">
              {org.website ? (
                <a
                  href={org.website.startsWith("http") ? org.website : `https://${org.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:text-ink hover:underline"
                >
                  {websiteLabel}
                </a>
              ) : (
                websiteLabel
              )}
            </p>
          )}

          <dl className="mt-3 space-y-1 text-sm">
            {org.email && (
              <div className="flex gap-2">
                <dt className="sr-only">Email</dt>
                <dd>
                  <a
                    href={`mailto:${org.email}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {org.email}
                  </a>
                </dd>
              </div>
            )}
            {org.phone && (
              <div className="flex gap-2">
                <dt className="sr-only">Téléphone</dt>
                <dd>
                  <a
                    href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {org.phone}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <OrganizationActions
          organization={formValues}
          archived={org.archived}
          variant="inline"
          redirectTo={org.archived ? undefined : "/organizations"}
        />
      </header>

      {org.notes && (
        <section aria-label="Notes" className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</h2>
          <p className="mt-2 whitespace-pre-line rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-relaxed text-ink">
            {org.notes}
          </p>
        </section>
      )}

      {/* ── Contacts ──────────────────────────────────────────────────────── */}
      <section aria-label="Contacts" className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">
          Contacts{" "}
          <span className="text-base font-normal text-muted">
            ({organizationContactLabel(org.contacts.filter((c) => !c.archived).length)})
          </span>
        </h2>

        {org.contacts.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Aucun contact rattaché à cette organisation pour l&apos;instant.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {org.contacts.map((contact) => (
              <li key={contact.id}>
                <Link
                  href={`/contacts/${contact.id}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface px-4 py-3 transition-colors hover:bg-surface-muted ${
                    contact.archived
                      ? "border-border-subtle opacity-60"
                      : "border-border-subtle"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {contact.displayName}
                      {contact.archived && (
                        <span className="ml-2 text-xs text-muted">(archivé)</span>
                      )}
                    </p>
                    {contact.jobTitle && (
                      <p className="truncate text-sm text-muted">{contact.jobTitle}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    {contact.email && <p>{contact.email}</p>}
                    {contact.phone && <p>{contact.phone}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Suivis ouverts ────────────────────────────────────────────────── */}
      {org.openFollowUps.length > 0 && (
        <section aria-label="Suivis ouverts" className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">
            Suivis ouverts{" "}
            <span className="text-base font-normal text-muted">({org.openFollowUps.length})</span>
          </h2>

          <ul className="mt-3 space-y-2">
            {org.openFollowUps.map((followUp) => (
              <li key={followUp.id}>
                <Link
                  href={`/contacts/${followUp.contactId}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{followUp.title}</p>
                    {followUp.contactName && (
                      <p className="text-sm text-muted">{followUp.contactName}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xs ${TIER_CLASS[followUp.ageTier] ?? "text-muted"}`}>
                      {followUp.ageLabel}
                    </p>
                    <p className="text-xs text-muted">
                      {followUp.ballOwner === "ME" ? "Balle chez moi" : "Balle chez eux"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Tâches ouvertes ───────────────────────────────────────────────── */}
      {org.openTasks.length > 0 && (
        <section aria-label="Tâches ouvertes" className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">
            Tâches ouvertes{" "}
            <span className="text-base font-normal text-muted">({org.openTasks.length})</span>
          </h2>

          <ul className="mt-3 space-y-2">
            {org.openTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/contacts/${task.contactId}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{task.title}</p>
                    {task.contactName && (
                      <p className="text-sm text-muted">{task.contactName}</p>
                    )}
                  </div>
                  <p className={`shrink-0 text-xs ${TIER_CLASS[task.ageTier] ?? "text-muted"}`}>
                    {task.ageLabel}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-muted">Créé le {createdDate}</p>
    </div>
  );
}
