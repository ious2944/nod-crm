"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { buildFollowUpHref, type FollowUpFilter } from "@/lib/follow-ups/filters";

/**
 * Barre de recherche de la liste de suivis — V0.7.
 *
 * La recherche est exécutée côté serveur à chaque changement d'URL : elle
 * ne filtre pas le DOM, elle déclenche un rendu serveur qui interroge la base.
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted"
      >
        🔍
      </span>
      <input
        id={searchId}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher dans les suivis…"
        className="w-full rounded-lg border border-border-strong bg-surface py-2 pl-9 pr-9 text-sm text-ink placeholder:text-muted/60 transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        autoComplete="off"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch("")}
          aria-label="Effacer la recherche"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}
