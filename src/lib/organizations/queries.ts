import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey } from "@/lib/date";
import { urgencyLevel, dueLabel } from "@/lib/follow-ups/domain";
import { contactFullName } from "@/lib/follow-ups/view";
import { computeTaskTiming } from "@/lib/tasks/domain";
import { formatAmount, STATUS_LABELS } from "@/lib/commerce/domain";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import {
  escapeLikePattern,
  orgSearchTokens,
  ORGANIZATIONS_PAGE_SIZE,
  type OrganizationListParams,
} from "./filters";
import type {
  OrganizationContact,
  OrganizationDetail,
  OrganizationFollowUp,
  OrganizationListItem,
  OrganizationOpportunity,
  OrganizationPickerOption,
  OrganizationTask,
} from "./view";

/**
 * Lectures du module Organisations.
 *
 * Deux invariants, valables pour chaque fonction de ce fichier :
 *
 * 1. **Le workspace vient de la session**, jamais d'un paramètre. Il est donc
 *    impossible d'écrire une requête qui traverse la frontière, même par
 *    inadvertance.
 * 2. **Pas de N+1.** Le nombre de requêtes ne dépend pas du nombre
 *    d'organisations ou de contacts affichés.
 */

/** Nombre de suggestions renvoyées par le sélecteur. */
export const ORG_PICKER_LIMIT = 8;

export interface OrganizationListPage {
  items: OrganizationListItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

function buildWhere(
  workspaceId: string,
  params: OrganizationListParams,
): Prisma.OrganizationWhereInput {
  const and: Prisma.OrganizationWhereInput[] = [];

  for (const rawToken of orgSearchTokens(params.search)) {
    const token = escapeLikePattern(rawToken);
    and.push({
      OR: [
        { name: { contains: token, mode: "insensitive" } },
        { website: { contains: token, mode: "insensitive" } },
        { email: { contains: token, mode: "insensitive" } },
      ],
    });
  }

  return {
    workspaceId,
    archivedAt: params.archived ? { not: null } : null,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/**
 * Page de la liste Organisations.
 *
 * Deux requêtes, quel que soit le nombre d'organisations : la page et le compte
 * de contacts par organisation.
 */
export async function listOrganizationsPage(
  params: OrganizationListParams,
): Promise<OrganizationListPage> {
  const workspaceId = await getWorkspaceIdForPage();
  const where = buildWhere(workspaceId, params);

  const [total, records] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (params.page - 1) * ORGANIZATIONS_PAGE_SIZE,
      take: ORGANIZATIONS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        website: true,
        phone: true,
        email: true,
        archivedAt: true,
      },
    }),
  ]);

  // Compte des contacts actifs par organisation, en une seule agrégation groupée.
  const contactCounts = await countActiveContactsByOrganization(
    workspaceId,
    records.map((r) => r.id),
  );

  const items: OrganizationListItem[] = records.map((record) => ({
    id: record.id,
    name: record.name,
    website: record.website,
    phone: record.phone,
    email: record.email,
    contactCount: contactCounts.get(record.id) ?? 0,
    archived: record.archivedAt !== null,
    form: {
      id: record.id,
      name: record.name,
      website: record.website,
      phone: record.phone,
      email: record.email,
      notes: null, // non chargé dans la liste — disponible dans la fiche
    },
  }));

  return {
    items,
    total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / ORGANIZATIONS_PAGE_SIZE)),
    pageSize: ORGANIZATIONS_PAGE_SIZE,
  };
}

/**
 * Compte les contacts actifs de plusieurs organisations en une seule requête.
 */
async function countActiveContactsByOrganization(
  workspaceId: string,
  organizationIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (organizationIds.length === 0) return counts;

  const rows = await prisma.contact.groupBy({
    by: ["organizationId"],
    where: {
      workspaceId,
      organizationId: { in: organizationIds },
      archivedAt: null,
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.organizationId) {
      counts.set(row.organizationId, row._count._all);
    }
  }

  return counts;
}

/**
 * Fiche détaillée. `null` si l'identifiant ne désigne rien dans CE workspace.
 */
export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const workspaceId = await getWorkspaceIdForPage();

  const record = await prisma.organization.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      name: true,
      website: true,
      phone: true,
      email: true,
      notes: true,
      archivedAt: true,
      createdAt: true,
    },
  });

  if (!record) return null;

  // Contacts rattachés, tous statuts d'archivage confondus : on montre aussi
  // les archivés pour ne pas cacher qu'une relation existait.
  const contacts = await prisma.contact.findMany({
    where: { workspaceId, organizationId: id },
    orderBy: [{ archivedAt: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      email: true,
      phone: true,
      archivedAt: true,
    },
  });

  const contactIds = contacts.map((c) => c.id);
  const now = new Date();

  // Suivis ouverts des contacts de cette organisation — une seule requête.
  // Les suivis sont liés aux contacts, pas à l'organisation directement.
  const openFollowUps =
    contactIds.length > 0
      ? await prisma.followUp.findMany({
          where: {
            workspaceId,
            contactId: { in: contactIds },
            status: "OPEN",
          },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            dueAt: true,
            ballOwner: true,
            contactId: true,
            contact: {
              select: { firstName: true, lastName: true },
            },
          },
        })
      : [];

  // Tâches non terminées des contacts de cette organisation — une seule requête.
  const openTasks =
    contactIds.length > 0
      ? await prisma.task.findMany({
          where: {
            workspaceId,
            contactId: { in: contactIds },
            completedAt: null,
          },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            dueAt: true,
            contactId: true,
            contact: {
              select: { firstName: true, lastName: true },
            },
          },
        })
      : [];

  // Opportunités ouvertes directement rattachées à cette organisation.
  const openOpportunitiesRaw = await prisma.opportunity.findMany({
    where: {
      workspaceId,
      organizationId: id,
      status: { in: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"] },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      estimatedAmount: true,
    },
  });

  const mappedContacts: OrganizationContact[] = contacts.map((c) => ({
    id: c.id,
    displayName: contactFullName(c) || c.email || "Contact sans nom",
    jobTitle: c.jobTitle,
    email: c.email,
    phone: c.phone,
    archived: c.archivedAt !== null,
  }));

  const mappedFollowUps: OrganizationFollowUp[] = openFollowUps.map((fu) => {
    const overdueDays = Math.floor(
      (now.getTime() - fu.dueAt.getTime()) / 86_400_000,
    );
    return {
      id: fu.id,
      title: fu.title,
      contactId: fu.contactId,
      contactName: fu.contact ? contactFullName(fu.contact) : null,
      dueAt: dayKey(fu.dueAt, APP_TIME_ZONE),
      ballOwner: fu.ballOwner as "ME" | "THEM",
      ageLabel: dueLabel(overdueDays),
      ageTier: urgencyLevel(overdueDays).replace("done", "calm") as
        | "calm"
        | "soon"
        | "today"
        | "late"
        | "critical",
    };
  });

  const mappedTasks: OrganizationTask[] = openTasks.map((task) => {
    const timing = computeTaskTiming(
      { dueAt: task.dueAt, completedAt: null },
      now,
      APP_TIME_ZONE,
    );
    return {
      id: task.id,
      title: task.title,
      contactId: task.contactId,
      contactName: task.contact ? contactFullName(task.contact) : null,
      dueAt: dayKey(task.dueAt, APP_TIME_ZONE),
      ageLabel: timing.dueLabel,
      ageTier: timing.level.replace("done", "calm") as
        | "calm"
        | "soon"
        | "today"
        | "late"
        | "critical",
    };
  });

  const mappedOpportunities: OrganizationOpportunity[] = openOpportunitiesRaw.map((opp) => {
    const status = opp.status as import("@/lib/commerce/domain").OpportunityStatus;
    return {
      id: opp.id as string,
      name: opp.name as string,
      status,
      statusLabel: STATUS_LABELS[status],
      estimatedAmount: opp.estimatedAmount
        ? formatAmount(parseFloat((opp.estimatedAmount as { toString(): string }).toString()))
        : null,
    };
  });

  return {
    id: record.id,
    name: record.name,
    website: record.website,
    phone: record.phone,
    email: record.email,
    notes: record.notes,
    archived: record.archivedAt !== null,
    createdAt: record.createdAt.toISOString(),
    contacts: mappedContacts,
    openFollowUps: mappedFollowUps,
    openTasks: mappedTasks,
    openOpportunities: mappedOpportunities,
  };
}

/**
 * Suggestions du sélecteur d'organisation (formulaire Contact).
 *
 * Recherche côté serveur, plafonnée. Exclut les organisations archivées.
 */
export async function searchOrganizationOptions(
  search: string,
): Promise<OrganizationPickerOption[]> {
  const workspaceId = await getWorkspaceIdForPage();

  const where: Prisma.OrganizationWhereInput = {
    workspaceId,
    archivedAt: null,
    ...(search.trim()
      ? {
          OR: [
            { name: { contains: escapeLikePattern(search.trim()), mode: "insensitive" } },
            { website: { contains: escapeLikePattern(search.trim()), mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const records = await prisma.organization.findMany({
    where,
    orderBy: search.trim()
      ? [{ name: "asc" }]
      : [{ updatedAt: "desc" }],
    take: ORG_PICKER_LIMIT,
    select: { id: true, name: true, website: true },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    subtitle: record.website ? websiteHostname(record.website) : null,
  }));
}

function websiteHostname(website: string): string | null {
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
