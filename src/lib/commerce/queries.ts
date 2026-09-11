import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import { filterToStatuses, type StatusFilter } from "./filters";
import type { OpportunityPickerOption } from "./domain";
import {
  toOpportunityDetail,
  toOpportunityListItem,
  type OpportunityDetail,
  type OpportunityListItem,
} from "./view";

/**
 * Lectures du module Commerce.
 *
 * Invariant unique et non négociable : **le workspace vient de la session**,
 * jamais d'un paramètre. Aucune fonction de ce fichier n'accepte de
 * `workspaceId` — il n'existe donc pas de chemin par lequel une opportunité
 * d'un autre espace pourrait être lue, même par erreur de programmation.
 *
 * La colonne `estimatedAmount` est un `Decimal` Prisma : elle est convertie
 * en `number | null` dès ici via `parseFloat()` pour que les vues React
 * restent sérialisables sans dépendance à `@prisma/client`.
 */

/** Nombre de suggestions renvoyées au sélecteur. */
const OPPORTUNITY_PICKER_LIMIT = 8;

/** Taille de page de la liste Commerce. */
export const COMMERCE_PAGE_SIZE = 25;

const OPPORTUNITY_INCLUDE = {
  organization: { select: { id: true, name: true } },
  contact: {
    select: { id: true, firstName: true, lastName: true, archivedAt: true },
  },
} as const;

/** Convertit un Decimal Prisma en number | null. */
function toAmount(
  value: { toString(): string } | null | undefined,
): number | null {
  if (value == null) return null;
  const n = parseFloat(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** Résultat paginé de la liste Commerce. */
export interface CommerceListPage {
  items: OpportunityListItem[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Liste des opportunités paginée, filtrée par statut.
 *
 * Tri stable : `expectedCloseAt ASC NULLS LAST, id ASC`. Ce tri garantit qu'un
 * enregistrement ne saute ni ne se répète entre deux pages (contrairement à
 * `updatedAt DESC` qui bougait dès qu'une opportunité était modifiée pendant la
 * navigation). Les opportunités sans date de clôture prévue arrivent en fin de
 * liste.
 */
export async function listOpportunities(
  filter: StatusFilter,
  page: number = 1,
): Promise<CommerceListPage> {
  const workspaceId = await getWorkspaceIdForPage();
  const statuses = filterToStatuses(filter);
  const where = {
    workspaceId,
    ...(statuses ? { status: { in: statuses } } : {}),
  };

  const [total, records] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      orderBy: [
        { expectedCloseAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ],
      skip: (page - 1) * COMMERCE_PAGE_SIZE,
      take: COMMERCE_PAGE_SIZE,
      include: OPPORTUNITY_INCLUDE,
    }),
  ]);

  return {
    items: records.map((record) =>
      toOpportunityListItem(
        { ...record, estimatedAmount: toAmount(record.estimatedAmount) },
        APP_TIME_ZONE,
      ),
    ),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / COMMERCE_PAGE_SIZE)),
  };
}

/**
 * Fiche détaillée. `null` si l'identifiant ne désigne rien dans CE workspace.
 */
export async function getOpportunityDetail(
  id: string,
): Promise<OpportunityDetail | null> {
  const workspaceId = await getWorkspaceIdForPage();

  const record = await prisma.opportunity.findFirst({
    where: { id, workspaceId },
    include: {
      ...OPPORTUNITY_INCLUDE,
      tasks: {
        where: { completedAt: null },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          dueAt: true,
          completedAt: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      followUps: {
        where: { status: "OPEN" },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          dueAt: true,
          status: true,
          ballOwner: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!record) return null;

  return toOpportunityDetail(
    { ...record, estimatedAmount: toAmount(record.estimatedAmount) },
    APP_TIME_ZONE,
  );
}

/**
 * Statistiques pour l'en-tête de la page Commerce.
 *
 * Deux compteurs, une seule passe : ouvertes / closes.
 */
export interface CommerceStats {
  openCount: number;
  closedCount: number;
}

export async function getCommerceStats(): Promise<CommerceStats> {
  const workspaceId = await getWorkspaceIdForPage();

  const [openCount, closedCount] = await Promise.all([
    prisma.opportunity.count({
      where: {
        workspaceId,
        status: { in: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"] },
      },
    }),
    prisma.opportunity.count({
      where: {
        workspaceId,
        status: { in: ["GAGNEE", "PERDUE"] },
      },
    }),
  ]);

  return { openCount, closedCount };
}

/**
 * Suggestions du sélecteur d'opportunité (formulaires Task / FollowUp).
 *
 * Seules les opportunités **ouvertes du workspace courant** sont proposées :
 * lier une tâche à une affaire close n'a pas de sens métier, et la recherche
 * est faite par PostgreSQL — le navigateur ne reçoit jamais la liste entière.
 */
export async function searchOpportunityOptions(
  search: string,
): Promise<OpportunityPickerOption[]> {
  const workspaceId = await getWorkspaceIdForPage();
  const term = search.trim();

  const records = await prisma.opportunity.findMany({
    where: {
      workspaceId,
      status: { in: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"] },
      ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
    },
    orderBy: term ? [{ name: "asc" }] : [{ updatedAt: "desc" }],
    take: OPPORTUNITY_PICKER_LIMIT,
    select: {
      id: true,
      name: true,
      organization: { select: { name: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    subtitle: record.organization.name,
  }));
}
