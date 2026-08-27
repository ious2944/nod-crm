import Link from "next/link";

import { contactSubtitle, type ContactListItem } from "@/lib/contacts/view";
import { ContactActions } from "./contact-actions";
import { ContactAvatar } from "./contact-avatar";

/**
 * Une ligne de la liste Contacts — V0.7 Lumina Enterprise.
 *
 * Card-style : avatar, nom, informations contextuelles, menu ⋮ en dehors du lien.
 */
export function ContactRow({ contact }: { contact: ContactListItem }) {
  const subtitle = contactSubtitle(contact.organizationName, contact.jobTitle);

  return (
    <article className="flex items-start gap-4 rounded-xl border border-border-subtle bg-surface p-4 shadow-card transition-all hover:shadow-card-hover hover:border-border-strong sm:p-5">
      <ContactAvatar initials={contact.initials} photoUrl={contact.photoUrl} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/contacts/${contact.id}`}
          className="text-[15px] font-semibold leading-snug text-ink hover:underline underline-offset-2"
        >
          {contact.displayName}
        </Link>

        {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}

        <div className="mt-1 space-y-0.5 text-[13px] text-muted">
          {contact.email && <p className="truncate">{contact.email}</p>}
          {contact.phone && <p className="truncate">{contact.phone}</p>}
        </div>

        <p
          className={`mt-2 text-xs font-semibold ${
            contact.openFollowUps > 0 ? "text-accent" : "text-muted"
          }`}
        >
          {contact.followUpLabel}
        </p>
      </div>

      <ContactActions
        contact={contact.form}
        openFollowUps={contact.openFollowUps}
        archived={contact.archived}
        variant="menu"
      />
    </article>
  );
}
