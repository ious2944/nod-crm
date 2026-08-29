import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ChangeStatusForm } from "@/components/commerce/change-status-form";
import { StatusBadge } from "@/components/commerce/status-badge";
import { APP_TIME_ZONE } from "@/lib/config";
import { getOpportunityDetail } from "@/lib/commerce/queries";

export const metadata = {
  title: "Opportunité — NOD CRM",
};

/**
 * Fiche opportunité.
 *
 * Affiche : contexte de l'affaire, pipeline de statut, tâches et suivis liés
 * (en lecture seule — actions depuis leurs pages respectives).
 * Aucune logique de rappel ni d'échéance opérationnelle n'est recréée ici.
 */
export default async function OpportunityPage({ params }: PageProps<"/commerce/[id]">) {
  await connection();

  const { id } = await params;
  const opportunity = await getOpportunityDetail(id);

  if (!opportunity) {
    notFound();
  }

  const createdDate = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(opportunity.createdAt));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/commerce"
        className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← Commerce
      </Link>

      {/* En-tête */}
      <header className="mt-4 flex flex-wrap items-start gap-4">
        <div
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-xl"
        >
          ◇
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{opportunity.name}</h1>
            <StatusBadge
              label={opportunity.statusLabel}
              variant={opportunity.statusVariant}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <Link
              href={`/organizations/${opportunity.organizationId}`}
              className="underline-offset-2 hover:text-ink hover:underline"
            >
              {opportunity.organizationName}
            </Link>
            {opportunity.contactName && (
              <Link
                href={`/contacts/${opportunity.contactId}`}
                className="underline-offset-2 hover:text-ink hover:underline"
              >
                {opportunity.contactName}
              </Link>
            )}
          </div>

          {/* Montant et date */}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {opportunity.estimatedAmount && (
              <div>
                <dt className="inline text-muted">Montant estimé : </dt>
                <dd className="inline font-semibold text-ink">{opportunity.estimatedAmount}</dd>
              </div>
            )}
            {opportunity.expectedCloseDate && (
              <div>
                <dt className="inline text-muted">Date prévisionnelle : </dt>
                <dd className="inline text-ink">{opportunity.expectedCloseDate}</dd>
              </div>
            )}
            {!opportunity.isOpen && opportunity.closedDate && (
              <div>
                <dt className="inline text-muted">Clôturée le : </dt>
                <dd className="inline text-ink">{opportunity.closedDate}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      {/* Pipeline de statut */}
      <section aria-label="Statut du pipeline" className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Pipeline
        </h2>
        <div className="mt-2">
          <ChangeStatusForm
            opportunityId={opportunity.id}
            currentStatus={opportunity.status}
          />
        </div>
      </section>

      {/* Notes */}
      {opportunity.notes && (
        <section aria-label="Notes" className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</h2>
          <p className="mt-2 whitespace-pre-line rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-relaxed text-ink">
            {opportunity.notes}
          </p>
        </section>
      )}

      {/* Tâches liées */}
      <section aria-label="Tâches liées" className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">
          Tâches{" "}
          {opportunity.openTasks.length > 0 && (
            <span className="text-base font-normal text-muted">
              ({opportunity.openTasks.length})
            </span>
          )}
        </h2>

        {opportunity.openTasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Aucune tâche ouverte liée à cette affaire.{" "}
            <Link
              href="/tasks"
              className="underline-offset-2 hover:text-ink hover:underline"
            >
              Créer une tâche
            </Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {opportunity.openTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href="/tasks"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-card transition-all hover:border-border-strong hover:shadow-card-hover"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{task.title}</p>
                    {task.contactName && (
                      <p className="text-sm text-muted">{task.contactName}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs text-muted">{task.dueAt}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Suivis liés */}
      <section aria-label="Suivis liés" className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">
          Suivis{" "}
          {opportunity.openFollowUps.length > 0 && (
            <span className="text-base font-normal text-muted">
              ({opportunity.openFollowUps.length})
            </span>
          )}
        </h2>

        {opportunity.openFollowUps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Aucun suivi ouvert lié à cette affaire.{" "}
            <Link
              href="/follow-ups"
              className="underline-offset-2 hover:text-ink hover:underline"
            >
              Créer un suivi
            </Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {opportunity.openFollowUps.map((followUp) => (
              <li key={followUp.id}>
                <Link
                  href="/follow-ups"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-card transition-all hover:border-border-strong hover:shadow-card-hover"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{followUp.title}</p>
                    {followUp.contactName && (
                      <p className="text-sm text-muted">{followUp.contactName}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    <p>{followUp.dueAt}</p>
                    <p>{followUp.ballOwner === "ME" ? "Balle chez moi" : "Balle chez eux"}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">Créée le {createdDate}</p>
    </div>
  );
}
