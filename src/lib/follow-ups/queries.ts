import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, endOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import { type FollowUpFilter } from "./filters";
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
 * Les compteurs (`stats`) sont calculés par des requêtes COUNT SQL sur la
 * totalité des suivis du workspace — sans égard pour la recherche et sans
 * charger les enregistrements en mémoire. Seule la liste d'items reflète le
 * filtre actif et la recherche textuelle.
 *
 * La recherche textuelle (`query`) porte sur `title` et `description` en
 * mode insensible à la casse (ILIKE côté PostgreSQL pour les ouverts et les
 * terminés).
 *
 * `needsAttention` = `dueAt <= fin du jour courant (APP_TIME_ZONE)`,
 * ce qui correspond à `overdueDays >= 0` du domaine métier.
 */
export async function getFollowUpBoard(
  filter: FollowUpFilter,
  query: string = "",
): Promise<FollowUpBoard> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();
  const todayKey = dayKey(now, APP_TIME_ZONE);
  const endOfToday = endOfDay(todayKey, APP_TIME_ZONE);

  // Compteurs via SQL — aucun chargement de lignes en mémoire.
  const [open, ballWithMe, ballWithThem, toNudge, needsAttentionCount, completed] =
    await prisma.$transaction([
      prisma.followUp.count({ where: { workspaceId, status: "OPEN" } }),
      prisma.followUp.count({ where: { workspaceId, status: "OPEN", ballOwner: "ME" } }),
      prisma.followUp.count({ where: { workspaceId, status: "OPEN", ballOwner: "THEM" } }),
      // toNudge : balle chez eux + échéance passée (= matchesOpenFilter("nudge"))
      prisma.followUp.count({
        where: {
          workspaceId,
          status: "OPEN",
          ballOwner: "THEM",
          dueAt: { lte: endOfToday },
        },
      }),
      // needsAttention : échéance atteinte ou passée (= overdueDays >= 0)
      prisma.followUp.count({
        where: { workspaceId, status: "OPEN", dueAt: { lte: endOfToday } },
      }),
      prisma.followUp.count({
        where: { workspaceId, status: { in: ["COMPLETED", "ABANDONED"] } },
      }),
    ]);

  const stats: FollowUpStats = {
    open,
    ballWithMe,
    ballWithThem,
    toNudge,
    needsAttention: needsAttentionCount,
    completed,
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

  // Pour les ouverts : filtre côté DB selon l'onglet actif, recherche côté DB.
  const openWhere = buildOpenWhere(workspaceId, filter, query, endOfToday);
  const openRecords = await prisma.followUp.findMany({
    where: openWhere,
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  return {
    stats,
    items: openRecords.map((record) => toFollowUpView(record, now, APP_TIME_ZONE)),
  };
}

/**
 * Construit le `where` Prisma pour les suivis ouverts, en appliquant le filtre
 * d'onglet et la recherche textuelle directement en SQL.
 *
 * Les filtres par onglet correspondent aux prédicats de `matchesOpenFilter` :
 * on ne charge que les enregistrements utiles plutôt que tout en mémoire.
 */
function buildOpenWhere(
  workspaceId: string,
  filter: FollowUpFilter,
  query: string,
  endOfToday: Date,
): object {
  const base: Record<string, unknown> = { workspaceId, status: "OPEN" };

  switch (filter) {
    case "me":
      base.ballOwner = "ME";
      break;
    case "them":
      base.ballOwner = "THEM";
      break;
    case "nudge":
      // Balle chez eux ET délai passé — identique à matchesOpenFilter("nudge").
      base.ballOwner = "THEM";
      base.dueAt = { lte: endOfToday };
      break;
    case "all":
    default:
      break;
  }

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
