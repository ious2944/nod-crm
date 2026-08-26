import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import {
  compareFeed,
  compareUpcoming,
  compareWaiting,
  FEED_LIMIT,
  SECTION_LIMIT,
} from "./domain";
import {
  ATTENTION_KEYS,
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
 * 2. **Une seule requête pour toute la page.** Les compteurs, le feed et les
 *    deux sections secondaires sont trois lectures du *même* jeu de suivis
 *    ouverts. Le nombre de requêtes ne dépend donc ni du nombre de cartes
 *    affichées, ni du filtre actif — la page peut être ouverte cent fois par
 *    jour sans coûter davantage.
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

  const records = await prisma.followUp.findMany({
    where: { workspaceId, status: "OPEN" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  const items = records.map((record) => toCockpitItem(record, now, APP_TIME_ZONE));

  const counters = Object.fromEntries(
    ATTENTION_KEYS.map((key) => [
      key,
      items.filter((item) => matchesCockpitFilter(key, item)).length,
    ]),
  ) as AttentionCounters;

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
