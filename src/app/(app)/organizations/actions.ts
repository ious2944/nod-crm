"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types, constantes et schémas vivent dans `src/lib/organizations/`.

import { revalidatePath } from "next/cache";

import type { OrganizationFormState } from "@/lib/organizations/form-state";
import type { OrganizationPickerOption } from "@/lib/organizations/view";
import { searchOrganizationOptions } from "@/lib/organizations/queries";
import {
  createOrganizationSchema,
  organizationIdSchema,
  organizationSearchSchema,
  updateOrganizationSchema,
} from "@/lib/organizations/schemas";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForAction } from "@/lib/workspace";

/**
 * Mutations du module Organisations.
 *
 * Chaque action suit le même ordre que le module Contacts :
 *
 * 1. **authentification d'abord** — rejet immédiat sans session ;
 * 2. **validation Zod** — le schéma énumère ses champs, pas d'affectation de masse ;
 * 3. **portée workspace** — toute écriture porte `workspaceId` dans son `where`.
 */

function collectFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createOrganization(
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = createOrganizationSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire est incomplet.",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const org = await prisma.organization.create({
    data: {
      workspaceId,
      name: parsed.data.name,
      website: parsed.data.website,
      phone: parsed.data.phone,
      email: parsed.data.email,
      notes: parsed.data.notes,
    },
    select: { id: true },
  });

  revalidatePath("/organizations");
  revalidatePath("/contacts");

  return {
    status: "success",
    message: "Organisation créée.",
    organizationId: org.id,
  };
}

export async function updateOrganization(
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = updateOrganizationSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire est incomplet.",
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const { id, ...fields } = parsed.data;

  // Lecture bornée au workspace : un identifiant appartenant à quelqu'un
  // d'autre est indiscernable d'un identifiant inexistant.
  const existing = await prisma.organization.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  });

  if (!existing) {
    return { status: "error", message: "Cette organisation n'existe pas." };
  }

  // Sync du nom dans les contacts liés : si le nom change, on met à jour
  // `organization_name` en miroir pour conserver la cohérence d'affichage
  // sur les contacts.
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: existing.id },
      data: {
        name: fields.name,
        website: fields.website,
        phone: fields.phone,
        email: fields.email,
        notes: fields.notes,
      },
    }),
    prisma.contact.updateMany({
      where: { organizationId: existing.id, workspaceId },
      data: { organizationName: fields.name },
    }),
  ]);

  revalidatePath("/organizations");
  revalidatePath(`/organizations/${existing.id}`);
  revalidatePath("/contacts");

  return {
    status: "success",
    message: "Organisation mise à jour.",
    organizationId: existing.id,
  };
}

/**
 * Archivage — jamais de suppression destructive.
 *
 * Les contacts liés restent valides et conservent leur lien : une organisation
 * archivée disparaît de la liste et du sélecteur, mais le lien FK reste.
 */
export async function archiveOrganization(formData: FormData): Promise<void> {
  await setArchivedAt(formData, new Date());
}

/** Restauration : un archivage doit pouvoir se défaire. */
export async function restoreOrganization(formData: FormData): Promise<void> {
  await setArchivedAt(formData, null);
}

async function setArchivedAt(formData: FormData, archivedAt: Date | null): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = organizationIdSchema.safeParse(formData.get("id"));
  if (!parsed.success) {
    throw new Error("Organisation introuvable.");
  }

  // updateMany avec workspaceId dans le WHERE : si l'id appartient à un autre
  // workspace, 0 lignes sont mises à jour — aucune erreur, aucune divulgation.
  await prisma.organization.updateMany({
    where: { id: parsed.data, workspaceId },
    data: { archivedAt },
  });

  revalidatePath("/organizations");
  revalidatePath(`/organizations/${parsed.data}`);
  revalidatePath("/contacts");
}

/**
 * Recherche du sélecteur d'organisation (formulaire Contact).
 *
 * Lecture plafonnée, serveur uniquement. Exclut les organisations archivées.
 */
export async function findOrganizations(
  search: string,
): Promise<OrganizationPickerOption[]> {
  await getWorkspaceIdForAction();

  const parsed = organizationSearchSchema.safeParse(search);
  if (!parsed.success) return [];

  return searchOrganizationOptions(parsed.data);
}
