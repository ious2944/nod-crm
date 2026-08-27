import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import { matchesOpenFilter, type FollowUpFilter } from "./filters";
import { toFollowUpView, type FollowUpView } from "./view";

const CONTACT_SELECTION = {
  // `archivedAt` sert uniquement à afficher « — archivé » à côté du nom : un
  // suivi historique ne doit pas perdre silencieusement son interlocuteur.
  select: {
    id: true,
    firstName: true,
    lastName: true,
    organizationName: true,
    archivedAt: true,
  },
} as const;

/** Compteurs du bandeau « Aujourd'hui ». */
export interface FollowUpStats {
  open: number;
  ballWithMe: number;
  ballWithThem: number;
  toNudge: number;
  needsAttention: number;
  completed: number;
}

export interface FollowUpBoard {
  stats: FollowUpStats;
  items: FollowUpView[];
}

/**
 * Charge le tableau de bord des suivis.
 *
 * Les compteurs (`stats`) sont toujours calculés sur la totalité des suivis
 * ouverts du workspace, sans égard pour la recherche : ils reflètent la
 * situation réelle. Seule la liste d'items est réduite par la recherche.
 *
 * La recherche textuelle (`query`) porte sur `title` et `description` en
 * mode insensible à la casse (ILIKE côté PostgreSQL pour les terminés ;
 * filtre mémoire pour les ouverts, déjà tous chargés pour les stats).
 */
export async function getFollowUpBoard(
  filter: FollowUpFilter,
  query: string = "",
): Promise<FollowUpBoard> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();

  // Tous les suivis ouverts — servant à la fois aux compteurs et à la liste.
  const openRecords = await prisma.followUp.findMany({
    where: { workspaceId, status: "OPEN" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  const allOpen = openRecords.map((record) => toFollowUpView(record, now, APP_TIME_ZONE));

  // Les stats ignorent la recherche : elles donnent le vrai état du workspace.
  const stats: FollowUpStats = {
    open: allOpen.length,
    ballWithMe: allOpen.filter((item) => item.ballOwner === "ME").length,
    ballWithThem: allOpen.filter((item) => item.ballOwner === "THEM").length,
    toNudge: allOpen.filter((item) => matchesOpenFilter("nudge", item)).length,
    needsAttention: allOpen.filter((item) => item.needsAttention).length,
    completed: await prisma.followUp.count({
      where: { workspaceId, status: { in: ["COMPLETED", "ABANDONED"] } },
    }),
  };

  if (filter === "done") {
    // Les terminés sont plafonnés à 100 : on leur applique la recherche côté DB.
    const doneWhere = buildSearchWhere(workspaceId, { in: ["COMPLETED", "ABANDONED"] }, query);
    const doneRecords = await prisma.followUp.findMany({
      where: doneWhere,
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
      include: { contact: CONTACT_SELECTION },
    });

    return {
      stats,
      items: doneRecords.map((record) => toFollowUpView(record, now, APP_TIME_ZONE)),
    };
  }

  // Pour les ouverts : filtre + recherche en mémoire (tous déjà chargés pour les stats).
  const q = query.trim().toLowerCase();
  const items = allOpen.filter(
    (item) =>
      matchesOpenFilter(filter, item) &&
      (q === "" ||
        item.title.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)),
  );

  return { stats, items };
}

/**
 * Construit le `where` Prisma pour une recherche textuelle sur titre et description.
 * Prisma paramètre les valeurs (pas d'injection SQL), mais `%` et `_` gardent
 * leur sens de joker dans ILIKE — l'échappement est géré par Prisma en mode
 * `contains` (il ajoute des `%` autour du motif mais n'échappe pas le motif lui-même).
 * `mode: "insensitive"` génère ILIKE sur PostgreSQL.
 */
function buildSearchWhere(
  workspaceId: string,
  status: { in: string[] } | string,
  query: string,
): object {
  const base = { workspaceId, status };
  const q = query.trim();
  if (!q) return base;

  return {
    ...base,
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
  };
}

/**
 * Suivis actionnables aujourd'hui, pour le cockpit « Aujourd'hui ».
 *
 * Même définition qu'en V0.3 (`needsAttention` : un suivi ouvert dont
 * l'échéance est atteinte), mais posée dans le `WHERE` plutôt qu'après coup :
 * le cockpit n'a pas besoin de charger les suivis lointains pour les écarter.
 * La borne est la fin du jour courant dans `APP_TIME_ZONE`.
 */
export async function getActionableFollowUps(endOfToday: Date): Promise<FollowUpView[]> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();

  const records = await prisma.followUp.findMany({
    where: { workspaceId, status: "OPEN", dueAt: { lte: endOfToday } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  return records.map((record) => toFollowUpView(record, now, APP_TIME_ZONE));
}

// `listContacts` a disparu en V0.2 : le formulaire Follow-Up ne charge plus
// l'annuaire entier dans la page, il interroge `searchContactOptions`
// (`src/lib/contacts/queries.ts`), qui cherche côté serveur et plafonne le
// résultat.
