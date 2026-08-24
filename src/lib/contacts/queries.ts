import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { toFollowUpView, type FollowUpView } from "@/lib/follow-ups/view";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";
import {
  CONTACTS_PAGE_SIZE,
  escapeLikePattern,
  NO_ORGANIZATION,
  searchTokens,
  type ContactListParams,
} from "./filters";
import {
  contactDisplayName,
  contactInitials,
  contactPhotoUrl,
  followUpLabel,
  type ContactListItem,
} from "./view";

/**
 * Lectures du module Contacts.
 *
 * Deux invariants, valables pour chaque fonction de ce fichier :
 *
 * 1. **Le workspace vient de la session**, jamais d'un paramètre. Il est donc
 *    impossible d'écrire une requête qui traverse la frontière, même par
 *    inadvertance.
 * 2. **Aucune requête par contact.** La liste sait combien de suivis porte
 *    chacune de ses lignes en une seule agrégation groupée : le nombre de
 *    requêtes ne dépend pas du nombre de contacts affichés.
 */

/** Champs réellement lus. `photoKey` sert d'URL, jamais le contenu de l'image. */
const CONTACT_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  jobTitle: true,
  organizationName: true,
  notes: true,
  photoKey: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const FOLLOW_UP_CONTACT_SELECTION = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    organizationName: true,
    archivedAt: true,
  },
} as const;

export interface ContactListPage {
  items: ContactListItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  initials: string;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  followUps: FollowUpView[];
}

/** Option du sélecteur de contact, dans le formulaire Follow-Up. */
export interface ContactPickerOption {
  id: string;
  name: string;
  subtitle: string | null;
}

/** Nombre de suggestions renvoyées par le sélecteur. */
export const CONTACT_PICKER_LIMIT = 8;

const CLOSED_STATUSES = ["COMPLETED", "ABANDONED"] as const;

/**
 * Traduction des paramètres d'URL en filtre SQL.
 *
 * La recherche est découpée en mots : chacun devient une clause `AND`, et
 * chaque clause accepte n'importe lequel des champs. « julien easylab »
 * retrouve donc le contact dont le prénom correspond au premier mot et
 * l'organisation au second.
 *
 * `contains` + `mode: "insensitive"` produit un `ILIKE` : insensible à la
 * casse, et naturellement tolérant aux `NULL` (une colonne vide ne correspond
 * simplement à rien, sans erreur). Prisma paramètre la requête, la valeur
 * saisie n'est jamais concaténée dans le SQL.
 */
function buildWhere(
  workspaceId: string,
  params: ContactListParams,
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];

  for (const rawToken of searchTokens(params.search)) {
    // `%` et `_` sont des jokers pour `LIKE` : on les neutralise, sinon une
    // recherche sur « 50% » ou « john_doe » ne veut plus dire ce qu'elle dit.
    const token = escapeLikePattern(rawToken);

    and.push({
      OR: [
        { firstName: { contains: token, mode: "insensitive" } },
        { lastName: { contains: token, mode: "insensitive" } },
        { email: { contains: token, mode: "insensitive" } },
        { phone: { contains: token, mode: "insensitive" } },
        { jobTitle: { contains: token, mode: "insensitive" } },
        { organizationName: { contains: token, mode: "insensitive" } },
      ],
    });
  }

  if (params.organization === NO_ORGANIZATION) {
    and.push({ OR: [{ organizationName: null }, { organizationName: "" }] });
  } else if (params.organization) {
    and.push({ organizationName: params.organization });
  }

  switch (params.followUp) {
    case "active":
      and.push({ followUps: { some: { status: "OPEN" } } });
      break;
    case "none":
      and.push({ followUps: { none: {} } });
      break;
    case "done":
      // « Terminés » = il reste une trace, mais plus rien d'ouvert.
      and.push({
        followUps: { some: { status: { in: [...CLOSED_STATUSES] } }, none: { status: "OPEN" } },
      });
      break;
    case "any":
      break;
  }

  return {
    workspaceId,
    // Un contact archivé sort de la liste ET de la recherche : c'est tout
    // l'intérêt de l'archivage par rapport à une suppression.
    archivedAt: null,
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

function buildOrderBy(sort: ContactListParams["sort"]): Prisma.ContactOrderByWithRelationInput[] {
  switch (sort) {
    case "name-desc":
      return [{ firstName: "desc" }, { lastName: "desc" }, { id: "desc" }];
    case "recent":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "updated":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "name-asc":
    default:
      // `id` en dernier départage les homonymes : sans lui, deux pages
      // successives peuvent réafficher ou sauter une ligne.
      return [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }];
  }
}

/**
 * Page de la liste Contacts.
 *
 * Trois requêtes, quel que soit le nombre de contacts affichés : la page, son
 * total pour la pagination, et l'agrégation des suivis.
 */
export async function listContactsPage(
  params: ContactListParams,
): Promise<ContactListPage> {
  const workspaceId = await getWorkspaceIdForPage();
  const where = buildWhere(workspaceId, params);

  const [total, records] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: buildOrderBy(params.sort),
      skip: (params.page - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: CONTACT_FIELDS,
    }),
  ]);

  const counts = await countFollowUpsByContact(
    workspaceId,
    records.map((record) => record.id),
  );

  const items: ContactListItem[] = records.map((record) => {
    const count = counts.get(record.id) ?? { open: 0, closed: 0 };
    const photoUrl = contactPhotoUrl(record.id, record.photoKey);

    return {
      id: record.id,
      displayName: contactDisplayName(record),
      initials: contactInitials(record),
      photoUrl,
      organizationName: record.organizationName,
      jobTitle: record.jobTitle,
      email: record.email,
      phone: record.phone,
      openFollowUps: count.open,
      closedFollowUps: count.closed,
      followUpLabel: followUpLabel(count.open, count.closed),
      archived: record.archivedAt !== null,
      form: {
        id: record.id,
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email,
        phone: record.phone,
        jobTitle: record.jobTitle,
        organizationName: record.organizationName,
        notes: record.notes,
        photoUrl,
      },
    };
  });

  return {
    items,
    total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE)),
    pageSize: CONTACTS_PAGE_SIZE,
  };
}

/**
 * Compte les suivis de plusieurs contacts d'un coup.
 *
 * C'est la parade au N+1 : un `GROUP BY (contact_id, status)` restreint aux
 * identifiants de la page en cours. Une requête, quelle que soit la taille de
 * la page.
 */
async function countFollowUpsByContact(
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, { open: number; closed: number }>> {
  const counts = new Map<string, { open: number; closed: number }>();
  if (contactIds.length === 0) return counts;

  const rows = await prisma.followUp.groupBy({
    by: ["contactId", "status"],
    where: { workspaceId, contactId: { in: contactIds } },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (!row.contactId) continue;
    const entry = counts.get(row.contactId) ?? { open: 0, closed: 0 };
    if (row.status === "OPEN") {
      entry.open += row._count._all;
    } else {
      entry.closed += row._count._all;
    }
    counts.set(row.contactId, entry);
  }

  return counts;
}

/** Fiche détaillée. `null` si l'identifiant ne désigne rien dans CE workspace. */
export async function getContactDetail(id: string): Promise<ContactDetail | null> {
  const workspaceId = await getWorkspaceIdForPage();

  const record = await prisma.contact.findFirst({
    where: { id, workspaceId },
    select: CONTACT_FIELDS,
  });

  if (!record) return null;

  const followUps = await prisma.followUp.findMany({
    where: { workspaceId, contactId: id },
    // Les suivis ouverts d'abord, les plus urgents en tête.
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    include: { contact: FOLLOW_UP_CONTACT_SELECTION },
  });

  const now = new Date();

  return {
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    displayName: contactDisplayName(record),
    initials: contactInitials(record),
    photoUrl: contactPhotoUrl(record.id, record.photoKey),
    email: record.email,
    phone: record.phone,
    jobTitle: record.jobTitle,
    organizationName: record.organizationName,
    notes: record.notes,
    archived: record.archivedAt !== null,
    createdAt: record.createdAt.toISOString(),
    followUps: followUps.map((followUp) => toFollowUpView(followUp, now, APP_TIME_ZONE)),
  };
}

/**
 * Organisations distinctes du workspace, pour le filtre.
 *
 * `DISTINCT` côté PostgreSQL, plafonné : le filtre est une commodité, pas un
 * annuaire. Le jour où une table `organizations` existera, cette fonction sera
 * la seule à changer.
 */
export async function listOrganizationOptions(): Promise<string[]> {
  const workspaceId = await getWorkspaceIdForPage();

  const rows = await prisma.contact.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      organizationName: { not: null },
    },
    distinct: ["organizationName"],
    orderBy: { organizationName: "asc" },
    select: { organizationName: true },
    take: 200,
  });

  return rows
    .map((row) => row.organizationName)
    .filter((name): name is string => Boolean(name));
}

/**
 * Suggestions du sélecteur de contact (formulaire Follow-Up).
 *
 * Recherche côté serveur, plafonnée : le navigateur ne reçoit jamais la base
 * de contacts, seulement les quelques lignes qu'il affiche.
 */
export async function searchContactOptions(
  search: string,
): Promise<ContactPickerOption[]> {
  const workspaceId = await getWorkspaceIdForPage();

  const where = buildWhere(workspaceId, {
    search,
    organization: "",
    followUp: "any",
    sort: "name-asc",
    page: 1,
  });

  const records = await prisma.contact.findMany({
    where,
    // Sans recherche, on propose les contacts les plus récemment touchés :
    // c'est presque toujours celui qu'on cherche.
    orderBy: search ? [{ firstName: "asc" }, { lastName: "asc" }] : [{ updatedAt: "desc" }],
    take: CONTACT_PICKER_LIMIT,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      jobTitle: true,
      organizationName: true,
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: contactDisplayName(record),
    subtitle: [record.organizationName, record.jobTitle].filter(Boolean).join(" · ") || null,
  }));
}
