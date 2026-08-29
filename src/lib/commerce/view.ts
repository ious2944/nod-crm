/**
 * Mise en forme d'une Opportunity pour l'affichage.
 *
 * Même découpage que `src/lib/contacts/view.ts` et `src/lib/tasks/view.ts` :
 * les composants React reçoivent des objets sérialisables et sans logique
 * restante. Toute la mise en forme est ici, en fonctions pures testables.
 *
 * **Important** : le montant Prisma `Decimal` est converti en `number | null`
 * dès la couche query (`parseFloat(...)`) — aucun objet Decimal ne traverse
 * cette couche.
 */

import { dayKey } from "@/lib/date";
import { formatAmount, isOpenStatus, STATUS_LABELS, statusVariant, type OpportunityStatus, type StatusVariant } from "./domain";

// ─── Enregistrements bruts (sortie Prisma) ─────────────────────────────────

/** Ce qu'une ligne `opportunities` retourne avec ses relations minimales. */
export interface OpportunityRecord {
  id: string;
  name: string;
  status: OpportunityStatus;
  estimatedAmount: number | null;
  expectedCloseAt: Date | null;
  closedAt: Date | null;
  notes: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
  };
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    archivedAt: Date | null;
  } | null;
}

// ─── Vues React (sérialisables) ─────────────────────────────────────────────

/** Ce qu'une ligne de la liste Commerce affiche. */
export interface OpportunityListItem {
  id: string;
  name: string;
  status: OpportunityStatus;
  statusLabel: string;
  statusVariant: StatusVariant;
  isOpen: boolean;
  estimatedAmount: string | null;
  /** Valeur brute en nombre pour les formulaires d'édition (non formatée). */
  estimatedAmountRaw: number | null;
  /** `YYYY-MM-DD` ou null. */
  expectedCloseDate: string | null;
  closedDate: string | null;
  organizationId: string;
  organizationName: string;
  contactId: string | null;
  contactName: string | null;
  contactArchived: boolean;
  isDemo: boolean;
  createdAt: string;
}

/** Ce qu'une fiche opportunité affiche (page de détail). */
export interface OpportunityDetail extends OpportunityListItem {
  notes: string | null;
  openTasks: OpportunityTask[];
  openFollowUps: OpportunityFollowUp[];
}

/** Une tâche vue depuis la fiche opportunité (résumé). */
export interface OpportunityTask {
  id: string;
  title: string;
  contactId: string | null;
  contactName: string | null;
  dueAt: string;
}

/** Un suivi vu depuis la fiche opportunité (résumé). */
export interface OpportunityFollowUp {
  id: string;
  title: string;
  contactId: string | null;
  contactName: string | null;
  dueAt: string;
  ballOwner: "ME" | "THEM";
}

// ─── Fonctions de conversion ────────────────────────────────────────────────

function contactFullName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

export function toOpportunityListItem(
  record: OpportunityRecord,
  timeZone: string,
): OpportunityListItem {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    statusLabel: STATUS_LABELS[record.status],
    statusVariant: statusVariant(record.status),
    isOpen: isOpenStatus(record.status),
    estimatedAmount: formatAmount(record.estimatedAmount),
    estimatedAmountRaw: record.estimatedAmount,
    expectedCloseDate: record.expectedCloseAt ? dayKey(record.expectedCloseAt, timeZone) : null,
    closedDate: record.closedAt ? dayKey(record.closedAt, timeZone) : null,
    organizationId: record.organization.id,
    organizationName: record.organization.name,
    contactId: record.contact?.id ?? null,
    contactName: record.contact ? contactFullName(record.contact) : null,
    contactArchived: record.contact?.archivedAt != null,
    isDemo: record.isDemo,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Enregistrement étendu attendu pour la page de détail. */
export interface OpportunityDetailRecord extends OpportunityRecord {
  tasks: Array<{
    id: string;
    title: string;
    dueAt: Date;
    completedAt: Date | null;
    contact: { id: string; firstName: string; lastName: string } | null;
  }>;
  followUps: Array<{
    id: string;
    title: string;
    dueAt: Date;
    status: string;
    ballOwner: "ME" | "THEM";
    contact: { id: string; firstName: string; lastName: string } | null;
  }>;
}

export function toOpportunityDetail(
  record: OpportunityDetailRecord,
  timeZone: string,
): OpportunityDetail {
  const base = toOpportunityListItem(record, timeZone);

  const openTasks: OpportunityTask[] = record.tasks
    .filter((t) => t.completedAt === null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      contactId: t.contact?.id ?? null,
      contactName: t.contact ? contactFullName(t.contact) : null,
      dueAt: dayKey(t.dueAt, timeZone),
    }));

  const openFollowUps: OpportunityFollowUp[] = record.followUps
    .filter((f) => f.status === "OPEN")
    .map((f) => ({
      id: f.id,
      title: f.title,
      contactId: f.contact?.id ?? null,
      contactName: f.contact ? contactFullName(f.contact) : null,
      dueAt: dayKey(f.dueAt, timeZone),
      ballOwner: f.ballOwner,
    }));

  return {
    ...base,
    notes: record.notes,
    openTasks,
    openFollowUps,
  };
}
