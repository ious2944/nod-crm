"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { FIELD } from "@/components/ui/form";
import {
  buildContactListHref,
  CONTACT_FOLLOW_UP_FILTERS,
  CONTACT_SORTS,
  MAX_SEARCH_LENGTH,
  NO_ORGANIZATION,
  type ContactListParams,
} from "@/lib/contacts/filters";

/**
 * Recherche et filtres de la liste Contacts.
 *
 * La recherche est **exécutée par PostgreSQL**, pas par le navigateur : la
 * saisie ne fait que réécrire l'URL, et c'est le rendu serveur qui interroge la
 * base. Aucun contact n'est chargé « au cas où ».
 *
 * D'où le délai de saisie : sans lui, taper « Doussot » déclencherait sept
 * rendus serveur. On attend une courte pause avant de partir, et la valeur
 * affichée reste locale pendant ce temps — le champ ne clignote pas et ne perd
 * pas le curseur.
 */

const DEBOUNCE_MS = 300;

const SELECT =
  "rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink";

export function ContactToolbar({
  params,
  organizations,
}: {
  params: ContactListParams;
  organizations: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(params.search);
  const searchId = useId();

  // La dernière valeur *venue de l'URL*. Elle sert à ne pas renaviguer quand
  // c'est l'URL qui vient de changer (retour arrière, effacement du filtre).
  const lastPushed = useRef(params.search);

  useEffect(() => {
    if (params.search !== lastPushed.current) {
      lastPushed.current = params.search;
      setSearch(params.search);
    }
  }, [params.search]);

  useEffect(() => {
    if (search === lastPushed.current) return;

    const timer = setTimeout(() => {
      lastPushed.current = search;
      startTransition(() => {
        // `replace` et non `push` : chaque frappe ne doit pas créer une entrée
        // dans l'historique du navigateur.
        router.replace(buildContactListHref({ ...params, search, page: 1 }));
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, params, router]);

  const go = (next: Partial<ContactListParams>) => {
    startTransition(() => {
      // Tout changement de filtre repart de la première page : rester en page 4
      // d'un résultat qui n'en a plus que deux affiche une liste vide.
      router.replace(buildContactListHref({ ...params, search, page: 1, ...next }));
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="sr-only" htmlFor={searchId}>
          Rechercher un contact
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher un contact..."
          className={FIELD}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Organisation"
          className={SELECT}
          value={params.organization}
          onChange={(event) => go({ organization: event.target.value })}
        >
          <option value="">Toutes les organisations</option>
          <option value={NO_ORGANIZATION}>Sans organisation</option>
          {organizations.map((organization) => (
            <option key={organization} value={organization}>
              {organization}
            </option>
          ))}
        </select>

        <select
          aria-label="Suivi"
          className={SELECT}
          value={params.followUp}
          onChange={(event) =>
            go({ followUp: event.target.value as ContactListParams["followUp"] })
          }
        >
          {CONTACT_FOLLOW_UP_FILTERS.map((filter) => (
            <option key={filter.key} value={filter.key}>
              {filter.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Trier"
          className={SELECT}
          value={params.sort}
          onChange={(event) => go({ sort: event.target.value as ContactListParams["sort"] })}
        >
          {CONTACT_SORTS.map((sort) => (
            <option key={sort.key} value={sort.key}>
              {sort.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
