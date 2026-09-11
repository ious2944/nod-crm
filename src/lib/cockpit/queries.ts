import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import {
  compareFeed,
  compareUpcoming,
  compareWaiting,
  FEED_LIMIT,
  SECTION_LIMIT,
  UPCOMING_WINDOW_DAYS,
} from "./domain";
import {
  belongsToFeed,
  matchesCockpitFilter,
  type AttentionCounters,
  type CockpitFilter,
} from "./filters";
import { toCockpitItem, type CockpitItem } from "./view";

/**
 * Lecture du cockpit.
 *
 * Deux invariants, comme dans les autres modules :
 *
 * 1. **Le workspace vient de la session.** Il n'est jamais paramètre, donc
 *    aucune signature de ce fichier ne permet d'écrire une requête qui
 *    traverse la frontière.
 * 2. **Compteurs par SQL, sections par chargement ciblé.** Les indicateurs
 *    d'attention (late, today, upcoming, waiting) sont calculés par quatre
 *    COUNT SQL dans une transaction — O(1) en mémoire serveur quel que soit
 *    le volume. Les sections d'affichage chargent encore les suivis ouverts
 *    pour le tri applicatif (feedReason / idleDays), mais c'est une contrainte
 *    temporaire : le tri peut être poussé côté SQL dans un prochain lot.
 *
 * L'index `follow_ups(workspace_id, status, due_at)` existant couvre déjà ce
 * `WHERE` et ce `ORDER BY` : aucune migration d'index n'est nécessaire.
 */

const CONTACT_SELECTION = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    // Nom de repli quand un contact n'a ni prénom ni nom.
    email: true,
    organizationName: true,
    // `archivedAt` sert à afficher « archivé » : un suivi ne doit pas perdre
    // silencieusement son interlocuteur.
    archivedAt: true,
  },
} as const;

/** Une zone du cockpit : ce qu'on montre, et combien il y en a en tout. */
export interface CockpitSection {
  items: CockpitItem[];
  /** Nombre total de suivis concernés, avant plafonnement. */
  total: number;
}

export interface CockpitData {
  counters: AttentionCounters;
  feed: CockpitSection;
  upcoming: CockpitSection;
  waiting: CockpitSection;
  /** Suivis ouverts, tous groupes confondus. Sert à l'état vide global. */
  openTotal: number;
}

export async function getCockpit(filter: CockpitFilter): Promise<CockpitData> {
  const workspaceId = await getWorkspaceIdForPage();
  // Un seul instant de référence pour toute la page : sans cela, deux sections
  // rendues à cheval sur minuit se contrediraient.
  const now = new Date();
  const todayKey = dayKey(now, APP_TIME_ZONE);

  // Bornes calendaires dans le fuseau de l'application pour les compteurs SQL.
  const startOfToday = startOfDay(todayKey, APP_TIME_ZONE);
  const startOfTomorrow = startOfDay(addDaysToKey(todayKey, 1), APP_TIME_ZONE);
  // Fenêtre « à venir » : jour j+1 inclus jusqu'à j+UPCOMING_WINDOW_DAYS inclus.
  const startOfAfterWindow = startOfDay(
    addDaysToKey(todayKey, UPCOMING_WINDOW_DAYS + 1),
    APP_TIME_ZONE,
  );

  // Compteurs via SQL — pas de chargement complet en mémoire pour les indicateurs.
  // late     : overdueDays >= 1  → dueAt < startOfToday
  // today    : overdueDays === 0 → startOfToday <= dueAt < startOfTomorrow
  // upcoming : 0 < -overdueDays <= UPCOMING_WINDOW_DAYS → startOfTomorrow <= dueAt < startOfAfterWindow
  // waiting  : ballOwner === "THEM" (transversal au temps)
  const [late, today, upcoming, waiting] = await prisma.$transaction([
    prisma.followUp.count({
      where: { workspaceId, status: "OPEN", dueAt: { lt: startOfToday } },
    }),
    prisma.followUp.count({
      where: {
        workspaceId,
        status: "OPEN",
        dueAt: { gte: startOfToday, lt: startOfTomorrow },
      },
    }),
    prisma.followUp.count({
      where: {
        workspaceId,
        status: "OPEN",
        dueAt: { gte: startOfTomorrow, lt: startOfAfterWindow },
      },
    }),
    prisma.followUp.count({
      where: { workspaceId, status: "OPEN", ballOwner: "THEM" },
    }),
  ]);

  const counters: AttentionCounters = { late, today, upcoming, waiting };

  // Items pour les sections d'affichage.
  // Le tri applicatif (feedReason, idleDays via updatedAt) empêche de déléguer
  // entièrement le tri à SQL : on charge les suivis ouverts pour les trier en mémoire.
  const records = await prisma.followUp.findMany({
    where: { workspaceId, status: "OPEN" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  const items = records.map((record) => toCockpitItem(record, now, APP_TIME_ZONE));

  return {
    counters,
    feed: section(
      items.filter((item) => belongsToFeed(filter, item)),
      compareFeed,
      FEED_LIMIT,
    ),
    upcoming: section(
      items.filter((item) => matchesCockpitFilter("upcoming", item)),
      compareUpcoming,
      SECTION_LIMIT,
    ),
    waiting: section(
      items.filter((item) => matchesCockpitFilter("waiting", item)),
      compareWaiting,
      SECTION_LIMIT,
    ),
    openTotal: items.length,
  };
}

function section(
  items: CockpitItem[],
  compare: (a: CockpitItem, b: CockpitItem) => number,
  limit: number,
): CockpitSection {
  return { items: [...items].sort(compare).slice(0, limit), total: items.length };
}
