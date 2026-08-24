import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import { matchesOpenFilter, type FollowUpFilter } from "./filters";
import { toFollowUpView, type FollowUpView } from "./view";

const CONTACT_SELECTION = {
  select: { id: true, firstName: true, lastName: true, organizationName: true },
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
 * Une seule lecture pour toute la page : les suivis ouverts servent à la fois
 * aux compteurs et à la liste. Le volume attendu en V0.1 (quelques dizaines de
 * lignes) rend inutile toute pagination.
 */
export async function getFollowUpBoard(filter: FollowUpFilter): Promise<FollowUpBoard> {
  const workspaceId = await getWorkspaceIdForPage();
  const now = new Date();

  const openRecords = await prisma.followUp.findMany({
    where: { workspaceId, status: "OPEN" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: CONTACT_SELECTION },
  });

  const open = openRecords.map((record) => toFollowUpView(record, now, APP_TIME_ZONE));

  const stats: FollowUpStats = {
    open: open.length,
    ballWithMe: open.filter((item) => item.ballOwner === "ME").length,
    ballWithThem: open.filter((item) => item.ballOwner === "THEM").length,
    toNudge: open.filter((item) => matchesOpenFilter("nudge", item)).length,
    needsAttention: open.filter((item) => item.needsAttention).length,
    completed: await prisma.followUp.count({
      where: { workspaceId, status: { in: ["COMPLETED", "ABANDONED"] } },
    }),
  };

  if (filter === "done") {
    const doneRecords = await prisma.followUp.findMany({
      where: { workspaceId, status: { in: ["COMPLETED", "ABANDONED"] } },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
      include: { contact: CONTACT_SELECTION },
    });

    return {
      stats,
      items: doneRecords.map((record) => toFollowUpView(record, now, APP_TIME_ZONE)),
    };
  }

  return {
    stats,
    items: open.filter((item) => matchesOpenFilter(filter, item)),
  };
}

// `listContacts` a disparu en V0.2 : le formulaire Follow-Up ne charge plus
// l'annuaire entier dans la page, il interroge `searchContactOptions`
// (`src/lib/contacts/queries.ts`), qui cherche côté serveur et plafonne le
// résultat.
