import { connection } from "next/server";

import { ContactPagination } from "@/components/contacts/contact-pagination";
import { ContactRow } from "@/components/contacts/contact-row";
import { ContactToolbar } from "@/components/contacts/contact-toolbar";
import { NewContactButton } from "@/components/contacts/new-contact-button";
import {
  DEFAULT_CONTACT_LIST_PARAMS,
  parseContactListParams,
} from "@/lib/contacts/filters";
import { listContactsPage, listOrganizationOptions } from "@/lib/contacts/queries";

export const metadata = {
  title: "Contacts — NOD CRM",
};

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  // La page dépend de la base et de paramètres d'URL : elle est rendue à
  // chaque requête, comme le tableau Follow-up.
  await connection();

  const params = parseContactListParams(await searchParams);

  const [page, organizations] = await Promise.all([
    listContactsPage(params),
    listOrganizationOptions(),
  ]);

  // Un filtre actif change le message quand il n'y a rien à afficher : « aucun
  // contact » et « aucun résultat » n'appellent pas la même réaction.
  const isFiltered =
    params.search !== DEFAULT_CONTACT_LIST_PARAMS.search ||
    params.organization !== DEFAULT_CONTACT_LIST_PARAMS.organization ||
    params.followUp !== DEFAULT_CONTACT_LIST_PARAMS.followUp;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Contacts</h1>
          <p className="mt-1 text-sm text-muted">
            Les personnes que tu suis, avec ou sans suivi en cours.
          </p>
        </div>
        <NewContactButton />
      </header>

      <section aria-label="Recherche et filtres" className="mt-6">
        <ContactToolbar params={params} organizations={organizations} />
      </section>

      <section aria-label="Contacts" className="mt-6 space-y-4">
        {page.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
            <p aria-hidden className="text-3xl">
              {isFiltered ? "🔍" : "◍"}
            </p>
            <p className="mt-3 font-semibold text-ink">
              {isFiltered ? "Aucun contact ne correspond" : "Aucun contact"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {isFiltered
                ? "Essaie un autre mot, ou relâche un filtre."
                : "Crée ton premier contact : un nom suffit pour démarrer."}
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-2.5">
              {page.items.map((contact) => (
                <li key={contact.id}>
                  <ContactRow contact={contact} />
                </li>
              ))}
            </ul>

            <ContactPagination
              params={params}
              page={page.page}
              pageCount={page.pageCount}
              total={page.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
