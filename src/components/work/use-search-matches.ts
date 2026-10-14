"use client";

import { useEffect, useState } from "react";

import { fetchJson } from "./store";

/**
 * Recherche des vues projet et « Mes tâches » : le client filtre localement
 * sur le titre et les 300 premiers caractères de la description ; ce hook
 * demande en plus au serveur les tâches dont la **description complète**
 * contient le texte (mêmes permissions que la recherche globale).
 */
export function useSearchMatches(search: string | undefined, scope: { projectId?: string | null; mine?: boolean }): ReadonlySet<string> | null {
  const text = search?.trim() ?? "";
  const [result, setResult] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const key = `${scope.projectId ?? ""}|${scope.mine ? "1" : ""}|${text}`;

  useEffect(() => {
    if (text.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const filters = {
        search: text,
        completion: "all",
        ...(scope.projectId ? { projectIds: [scope.projectId] } : {}),
        ...(scope.mine ? { assigneeIds: ["me"] } : {}),
      };
      fetchJson<{ ids: string[] }>(`/api/tasks/search?idsOnly=1&filters=${encodeURIComponent(JSON.stringify(filters))}`)
        .then((data) => {
          if (!cancelled) setResult({ key, ids: new Set(data.ids) });
        })
        .catch(() => {
          // Hors ligne : la recherche locale (titre + extrait) reste active.
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, text, scope.projectId, scope.mine]);

  return text.length >= 2 && result?.key === key ? result.ids : null;
}
