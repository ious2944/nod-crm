"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { FIELD } from "@/components/ui/form";
import {
  buildFollowUpHref,
  type FollowUpFilter,
} from "@/lib/follow-ups/filters";

/**
 * Barre de recherche de la liste de suivis.
 *
 * La recherche est exécutée côté serveur à chaque changement d'URL : elle
 * ne filtre pas le DOM, elle déclenche un rendu serveur qui interroge la base.
 * Même mécanique que `ContactToolbar` : délai de saisie pour éviter un rendu
 * par lettre, valeur locale pendant la pause.
 */

const DEBOUNCE_MS = 300;

export function FollowUpSearchBar({
  filter,
  query,
}: {
  filter: FollowUpFilter;
  query: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const lastPushed = useRef(query);
  const searchId = useId();

  // Synchroniser l'état local quand l'URL change (retour arrière, effacement
  // d'un filtre depuis les onglets).
  useEffect(() => {
    if (query !== lastPushed.current) {
      lastPushed.current = query;
      setSearch(query);
    }
  }, [query]);

  useEffect(() => {
    if (search === lastPushed.current) return;

    const timer = setTimeout(() => {
      lastPushed.current = search;
      startTransition(() => {
        router.push(buildFollowUpHref({ filter, query }, { query: search }));
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, filter, query, router]);

  return (
    <div className="relative">
      <label htmlFor={searchId} className="sr-only">
        Rechercher un suivi
      </label>
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      >
        🔍
      </span>
      <input
        id={searchId}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher dans les suivis…"
        className={`${FIELD} pl-9`}
        autoComplete="off"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch("")}
          aria-label="Effacer la recherche"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
}
