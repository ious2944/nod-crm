import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ContactActions } from "@/components/contacts/contact-actions";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { ContactFollowUps } from "@/components/contacts/contact-follow-ups";
import { NewFollowUpDialog } from "@/components/follow-ups/new-follow-up-dialog";
import { APP_TIME_ZONE } from "@/lib/config";
import { getContactDetail } from "@/lib/contacts/queries";
import { addDaysToKey, dayKey } from "@/lib/date";

export const metadata = {
  title: "Contact — NOD CRM",
};

/** Même valeur que le tableau Follow-up : une échéance à trois jours. */
const DEFAULT_DUE_IN_DAYS = 3;

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  await connection();

  const { id } = await params;
  const contact = await getContactDetail(id);

  // `notFound()` couvre les deux cas d'un coup : identifiant inexistant, ou
  // appartenant à un autre workspace. Rien ne permet de distinguer les deux,
  // donc rien ne permet d'énumérer les contacts d'autrui.
  if (!contact) {
    notFound();
  }

  const openFollowUps = contact.followUps.filter(
    (followUp) => followUp.status === "OPEN",
  ).length;
  const today = dayKey(new Date(), APP_TIME_ZONE);

  // Ligne secondaire : l'organisation est un lien cliquable si elle est liée.
  const orgPart: { linked: boolean; href: string; label: string } | null = contact.organizationName
    ? contact.organizationId
      ? { linked: true, href: `/organizations/${contact.organizationId}`, label: contact.organizationName }
      : { linked: false, href: "", label: contact.organizationName }
    : null;
  const jobTitlePart = contact.jobTitle ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/contacts"
        className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← Contacts
      </Link>

      {contact.archived && (
        <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
          Ce contact est archivé : il n&apos;apparaît plus dans la liste ni dans les
          sélecteurs. Ses suivis, eux, sont intacts.
        </p>
      )}

      <header className="mt-4 flex flex-wrap items-start gap-4">
        <ContactAvatar initials={contact.initials} photoUrl={contact.photoUrl} size="lg" />

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{contact.displayName}</h1>
          {(orgPart || jobTitlePart) && (
            <p className="mt-1 text-sm text-muted">
              {orgPart && orgPart.linked ? (
                <Link
                  href={orgPart.href}
                  className="underline-offset-2 hover:text-ink hover:underline"
                >
                  {orgPart.label}
                </Link>
              ) : orgPart ? (
                <span>{orgPart.label}</span>
              ) : null}
              {orgPart && jobTitlePart && <span> · </span>}
              {jobTitlePart && <span>{jobTitlePart}</span>}
            </p>
          )}

          <dl className="mt-3 space-y-1 text-sm">
            {contact.email && (
              <div className="flex gap-2">
                <dt className="sr-only">Email</dt>
                <dd>
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {contact.email}
                  </a>
                </dd>
              </div>
            )}
            {contact.phone && (
              <div className="flex gap-2">
                <dt className="sr-only">Téléphone</dt>
                <dd>
                  <a
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {contact.phone}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <ContactActions
          contact={{
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            jobTitle: contact.jobTitle,
            organizationName: contact.organizationName,
            organizationId: contact.organizationId,
            notes: contact.notes,
            photoUrl: contact.photoUrl,
          }}
          openFollowUps={openFollowUps}
          archived={contact.archived}
          variant="inline"
          redirectTo={contact.archived ? undefined : "/contacts"}
        />
      </header>

      {contact.notes && (
        <section aria-label="Commentaire" className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Commentaire
          </h2>
          <p className="mt-2 whitespace-pre-line rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm leading-relaxed text-ink">
            {contact.notes}
          </p>
        </section>
      )}

      <section aria-label="Follow-Ups" className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Follow-Ups</h2>
          {/* Pas de nouveau suivi sur un contact archivé : le serveur le refuse
              (`createFollowUp`), et proposer un bouton qui échoue serait pire
              que ne rien proposer. Les suivis existants restent affichés. */}
          {contact.archived ? (
            <p className="text-xs text-muted">
              Restaure le contact pour lui ouvrir un nouveau suivi.
            </p>
          ) : (
            <NewFollowUpDialog
              defaultDueDate={addDaysToKey(today, DEFAULT_DUE_IN_DAYS)}
              defaultContact={{ id: contact.id, name: contact.displayName }}
              triggerLabel="Nouveau Follow-Up"
              triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
            />
          )}
        </div>

        <ContactFollowUps followUps={contact.followUps} />
      </section>

      <p className="mt-8 text-xs text-muted">
        Créé le{" "}
        {new Intl.DateTimeFormat("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: APP_TIME_ZONE,
        }).format(new Date(contact.createdAt))}
      </p>
    </div>
  );
}
