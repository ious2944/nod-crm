"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types, constantes et classes d'erreur vivent dans `src/lib/follow-ups/`.

import { revalidatePath } from "next/cache";

import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, shiftDueDate, startOfDay } from "@/lib/date";
import type { CreateFollowUpState } from "@/lib/follow-ups/create-state";
import { FollowUpConflictError } from "@/lib/follow-ups/errors";
import {
  isTransitionAllowed,
  NUDGE_SNOOZE_DAYS,
  RECEIVED_SNOOZE_DAYS,
  type FollowUpIntent,
} from "@/lib/follow-ups/domain";
import { createFollowUpSchema, quickActionSchema } from "@/lib/follow-ups/schemas";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getWorkspaceIdForAction } from "@/lib/workspace";

export async function createFollowUp(
  _previous: CreateFollowUpState,
  formData: FormData,
): Promise<CreateFollowUpState> {
  // Authentification d'abord : une action appelée sans session est rejetée
  // avant même de regarder le contenu du formulaire.
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = createFollowUpSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Le formulaire est incomplet.", fieldErrors };
  }

  const input = parsed.data;

  let contactId: string | null = null;

  if (input.contactId === "new") {
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        firstName: input.newContactFirstName ?? "",
        lastName: input.newContactLastName ?? "",
        organizationName: input.newContactOrganization,
      },
      select: { id: true },
    });
    contactId = contact.id;
  } else if (input.contactId) {
    // On re-vérifie que le contact appartient bien au workspace : l'id vient du
    // client. `archivedAt: null` fait partie du filtre, pas d'un contrôle
    // séparé : un contact archivé ne doit pas plus accepter un nouveau suivi
    // que le contact d'un autre workspace. Le sélecteur ne le propose plus,
    // mais un formulaire resté ouvert dans un onglet, lui, le poste encore.
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

  await prisma.followUp.create({
    data: {
      workspaceId,
      contactId,
      title: input.title,
      description: input.description,
      ballOwner: input.ballOwner,
      dueAt: startOfDay(input.dueDate, APP_TIME_ZONE),
    },
  });

  revalidatePath("/follow-ups");
  return { status: "success", message: "Suivi créé." };
}

/**
 * Toutes les actions rapides de la liste passent par ici.
 * Un seul point d'entrée = une seule validation, un seul contrôle de workspace.
 */
export async function applyQuickAction(formData: FormData): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = quickActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("Action invalide.");
  }

  const { id, intent, days } = parsed.data;

  const followUp = await prisma.followUp.findFirst({
    where: { id, workspaceId },
    select: { id: true, status: true, dueAt: true },
  });

  if (!followUp) {
    throw new Error("Suivi introuvable.");
  }

  if (!isTransitionAllowed(intent, followUp.status)) {
    throw new FollowUpConflictError();
  }

  const now = new Date();
  // Un report part de la date la plus tardive entre aujourd'hui et l'échéance :
  // reporter un suivi en retard de 10 jours doit donner « demain », pas « il y a 9 jours ».
  const base = followUp.dueAt > now ? followUp.dueAt : now;

  const data = buildTransition(intent, { now, base, days });

  // Écriture conditionnelle : le `where` reprend l'état exact lu juste avant.
  // Deux clics simultanés lisent le même état, mais un seul `UPDATE` trouve
  // encore la ligne dans cet état — l'autre repart à zéro ligne modifiée.
  // C'est ce qui rend la transition atomique sans transaction explicite.
  const { count } = await prisma.followUp.updateMany({
    where: { id, workspaceId, status: followUp.status, dueAt: followUp.dueAt },
    data,
  });

  if (count !== 1) {
    throw new FollowUpConflictError();
  }

  revalidatePath("/follow-ups");
}

/** Effet de chaque transition. Séparé de l'écriture pour rester lisible. */
function buildTransition(
  intent: FollowUpIntent,
  context: { now: Date; base: Date; days?: number },
): Prisma.FollowUpUpdateManyMutationInput {
  const { now, base, days } = context;

  switch (intent) {
    case "nudge":
      // Relancer : la balle repart chez eux et on se redonne un délai d'attente.
      return {
        ballOwner: "THEM",
        nudgeCount: { increment: 1 },
        lastNudgedAt: now,
        dueAt: shiftDueDate(now, NUDGE_SNOOZE_DAYS, APP_TIME_ZONE),
      };

    case "handoff":
      // J'ai fait ma part : la balle repart chez eux, sans compter de relance.
      return {
        ballOwner: "THEM",
        dueAt: shiftDueDate(now, NUDGE_SNOOZE_DAYS, APP_TIME_ZONE),
      };

    case "received":
      // Ils ont répondu : la balle revient chez moi, avec un délai pour traiter.
      return {
        ballOwner: "ME",
        dueAt: shiftDueDate(base, RECEIVED_SNOOZE_DAYS, APP_TIME_ZONE),
      };

    case "snooze":
      return { dueAt: shiftDueDate(base, days ?? 1, APP_TIME_ZONE) };

    case "complete":
      return { status: "COMPLETED", completedAt: now };

    case "abandon":
      return { status: "ABANDONED", completedAt: now };

    case "reopen":
      // Rouvrir un vieux suivi sans échéance utilisable n'aurait aucun sens.
      return {
        status: "OPEN",
        completedAt: null,
        dueAt: startOfDay(dayKey(now, APP_TIME_ZONE), APP_TIME_ZONE),
      };
  }
}
