"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types, constantes et classes d'erreur vivent dans `src/lib/commerce/`.

import { revalidatePath } from "next/cache";

import { APP_TIME_ZONE } from "@/lib/config";
import { startOfDay } from "@/lib/date";
import { OpportunityConflictError } from "@/lib/commerce/errors";
import { isOpenStatus, isTransitionAllowed } from "@/lib/commerce/domain";
import type { CreateOpportunityState, UpdateOpportunityState } from "@/lib/commerce/create-state";
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  changeStatusSchema,
  opportunitySearchSchema,
} from "@/lib/commerce/schemas";
import { searchOpportunityOptions } from "@/lib/commerce/queries";
import type { OpportunityPickerOption } from "@/lib/commerce/domain";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForAction } from "@/lib/workspace";

/**
 * Pages du module Commerce à invalider après chaque mutation.
 *
 * La liste `/commerce` et le détail `/commerce/[id]` sont traités séparément :
 * une mise à jour de statut sur une affaire connue n'a pas besoin d'invalider
 * toutes les autres fiches.
 */
const COMMERCE_LIST_PATH = "/commerce";

function revalidateCommerceList(): void {
  revalidatePath(COMMERCE_LIST_PATH);
}

function revalidateOpportunityDetail(id: string): void {
  revalidatePath(`/commerce/${id}`);
}

// ─── Création ──────────────────────────────────────────────────────────────

export async function createOpportunity(
  _previous: CreateOpportunityState,
  formData: FormData,
): Promise<CreateOpportunityState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = createOpportunitySchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Le formulaire est incomplet.", fieldErrors };
  }

  const input = parsed.data;

  // L'organisation est obligatoire ; on vérifie qu'elle appartient au workspace.
  const organization = await prisma.organization.findFirst({
    where: { id: input.organizationId, workspaceId, archivedAt: null },
    select: { id: true },
  });

  if (!organization) {
    return {
      status: "error",
      message: "Cette organisation n'existe pas ou a été archivée.",
      fieldErrors: { organizationId: "Organisation introuvable." },
    };
  }

  let contactId: string | null = null;

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId, archivedAt: null },
      select: { id: true },
    });

    if (!contact) {
      return {
        status: "error",
        message: "Ce contact n'existe pas ou a été archivé.",
        fieldErrors: { contactId: "Contact introuvable." },
      };
    }
    contactId = contact.id;
  }

  const expectedCloseAt = input.expectedCloseDate
    ? startOfDay(input.expectedCloseDate, APP_TIME_ZONE)
    : null;

  await prisma.opportunity.create({
    data: {
      workspaceId,
      organizationId: organization.id,
      contactId,
      name: input.name,
      status: input.status,
      estimatedAmount: input.estimatedAmount,
      expectedCloseAt,
      notes: input.notes,
    },
  });

  revalidateCommerceList();
  return { status: "success", message: "Opportunité créée." };
}

// ─── Mise à jour ────────────────────────────────────────────────────────────

export async function updateOpportunity(
  _previous: UpdateOpportunityState,
  formData: FormData,
): Promise<UpdateOpportunityState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = updateOpportunitySchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Le formulaire est incomplet.", fieldErrors };
  }

  const input = parsed.data;

  // Vérification d'appartenance au workspace, anti–mass-assignment.
  const existing = await prisma.opportunity.findFirst({
    where: { id: input.id, workspaceId },
    select: { id: true },
  });

  if (!existing) {
    return {
      status: "error",
      message: "Cette opportunité est introuvable.",
      fieldErrors: { id: "Opportunité introuvable." },
    };
  }

  // Vérification de l'organisation.
  const organization = await prisma.organization.findFirst({
    where: { id: input.organizationId, workspaceId, archivedAt: null },
    select: { id: true },
  });

  if (!organization) {
    return {
      status: "error",
      message: "Cette organisation n'existe pas ou a été archivée.",
      fieldErrors: { organizationId: "Organisation introuvable." },
    };
  }

  let contactId: string | null = null;

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, workspaceId, archivedAt: null },
      select: { id: true },
    });

    if (!contact) {
      return {
        status: "error",
        message: "Ce contact n'existe pas ou a été archivé.",
        fieldErrors: { contactId: "Contact introuvable." },
      };
    }
    contactId = contact.id;
  }

  const expectedCloseAt = input.expectedCloseDate
    ? startOfDay(input.expectedCloseDate, APP_TIME_ZONE)
    : null;

  await prisma.opportunity.update({
    where: { id: input.id },
    data: {
      organizationId: organization.id,
      contactId,
      name: input.name,
      estimatedAmount: input.estimatedAmount,
      expectedCloseAt,
      notes: input.notes,
    },
  });

  revalidateCommerceList();
  revalidateOpportunityDetail(input.id);
  return { status: "success", message: "Opportunité mise à jour." };
}

// ─── Changement de statut ───────────────────────────────────────────────────

/**
 * Transition de pipeline. La machine à états est vérifiée avant l'écriture :
 * une requête forgée ne peut pas sauter des étapes ou rouvrir une affaire
 * sans passer par un état ouvert.
 */
export async function changeOpportunityStatus(formData: FormData): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = changeStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("Données invalides.");
  }

  const { id, status: newStatus } = parsed.data;

  const opportunity = await prisma.opportunity.findFirst({
    where: { id, workspaceId },
    select: { id: true, status: true },
  });

  if (!opportunity) {
    throw new Error("Opportunité introuvable.");
  }

  if (!isTransitionAllowed(opportunity.status, newStatus)) {
    throw new OpportunityConflictError();
  }

  const now = new Date();

  // `closedAt` : horodatage de la clôture effective. On le pose à la première
  // transition vers un statut terminal, et on l'efface si l'affaire est rouverte.
  const closedAt = isOpenStatus(newStatus)
    ? null
    : isOpenStatus(opportunity.status)
      ? now // fermeture
      : undefined; // déjà clos → on ne touche pas à la date

  await prisma.opportunity.update({
    where: { id },
    data: {
      status: newStatus,
      ...(closedAt !== undefined ? { closedAt } : {}),
    },
  });

  revalidateCommerceList();
  revalidateOpportunityDetail(id);
}

// ─── Suppression ────────────────────────────────────────────────────────────

/**
 * Suppression définitive d'une opportunité.
 *
 * Les tâches et suivis liés ont `onDelete: SetNull` dans le schéma : leur
 * `opportunityId` passe à `null`, ils restent intacts. C'est le comportement
 * voulu : supprimer une affaire ne doit pas silencieusement supprimer des
 * actions ou des relances.
 */
export async function deleteOpportunity(formData: FormData): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    throw new Error("Identifiant manquant.");
  }

  const opportunity = await prisma.opportunity.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  });

  if (!opportunity) {
    throw new Error("Opportunité introuvable.");
  }

  await prisma.opportunity.delete({ where: { id } });

  revalidateCommerceList();
}

// ─── Sélecteur ─────────────────────────────────────────────────────────────

/**
 * Recherche du sélecteur d'opportunité (formulaires Task / FollowUp).
 *
 * Lecture déguisée en action : même canal serveur que `findFollowUps`.
 */
export async function findOpportunities(
  search: string,
): Promise<OpportunityPickerOption[]> {
  await getWorkspaceIdForAction();

  const parsed = opportunitySearchSchema.safeParse(search);
  if (!parsed.success) return [];

  return searchOpportunityOptions(parsed.data);
}
