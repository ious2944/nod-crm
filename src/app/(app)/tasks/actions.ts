"use server";

// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Types, constantes et classes d'erreur vivent dans `src/lib/tasks/`.

import { revalidatePath } from "next/cache";

import { APP_TIME_ZONE } from "@/lib/config";
import { shiftDueDate, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import type { CreateTaskState } from "@/lib/tasks/create-state";
import { TaskConflictError } from "@/lib/tasks/errors";
import type { FollowUpPickerOption } from "@/lib/tasks/queries";
import { searchFollowUpOptions } from "@/lib/tasks/queries";
import {
  createTaskSchema,
  followUpSearchSchema,
  taskActionSchema,
} from "@/lib/tasks/schemas";
import { getWorkspaceIdForAction } from "@/lib/workspace";

/** Revalide les pages Commerce quand une tâche est liée à une opportunité. */
function revalidateCommerceIfLinked(opportunityId: string | null): void {
  if (!opportunityId) return;
  revalidatePath("/commerce");
  revalidatePath(`/commerce/${opportunityId}`);
}

/**
 * Les trois pages qui montrent des tâches. Une mutation les rafraîchit toutes :
 * terminer une tâche depuis le cockpit doit la retirer du cockpit *et* mettre à
 * jour la liste Tâches, sans que l'utilisateur ait à recharger quoi que ce soit.
 *
 * `/follow-ups` n'y figure pas, et c'est volontaire : **aucune action sur une
 * tâche ne modifie un suivi.**
 */
const TASK_PATHS = ["/today", "/tasks"] as const;

function revalidateTaskPages(): void {
  for (const path of TASK_PATHS) revalidatePath(path);
}

export async function createTask(
  _previous: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  // Authentification d'abord : une action appelée sans session est rejetée
  // avant même de regarder le contenu du formulaire.
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = createTaskSchema.safeParse(Object.fromEntries(formData));

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
  let followUpId: string | null = null;
  let opportunityId: string | null = null;

  if (input.contactId) {
    // L'identifiant vient du client : on revérifie qu'il désigne bien un
    // contact **de ce workspace**, non archivé. Un formulaire resté ouvert dans
    // un onglet, ou un POST forgé, ne doit pas pouvoir franchir la frontière.
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

  if (input.followUpId) {
    // Même contrôle pour le suivi lié. Rattacher une tâche au suivi d'un autre
    // workspace est impossible : la lecture ne le trouve pas.
    const followUp = await prisma.followUp.findFirst({
      where: { id: input.followUpId, workspaceId },
      select: { id: true },
    });

    if (!followUp) {
      return {
        status: "error",
        message: "Ce suivi n'existe pas.",
        fieldErrors: { followUpId: "Suivi introuvable." },
      };
    }
    followUpId = followUp.id;
  }

  if (input.opportunityId) {
    // Même contrôle pour l'opportunité liée. Seules les opportunités ouvertes
    // et du workspace courant sont valides.
    const opportunity = await prisma.opportunity.findFirst({
      where: {
        id: input.opportunityId,
        workspaceId,
        status: { in: ["A_QUALIFIER", "EN_DISCUSSION", "PROPOSITION"] },
      },
      select: { id: true },
    });

    if (!opportunity) {
      return {
        status: "error",
        message: "Cette opportunité n'existe pas ou est clôturée.",
        fieldErrors: { opportunityId: "Opportunité introuvable." },
      };
    }
    opportunityId = opportunity.id;
  }

  await prisma.task.create({
    data: {
      workspaceId,
      contactId,
      followUpId,
      opportunityId,
      title: input.title,
      notes: input.notes,
      dueAt: startOfDay(input.dueDate, APP_TIME_ZONE),
    },
  });

  revalidateTaskPages();
  revalidateCommerceIfLinked(opportunityId);
  return { status: "success", message: "Tâche créée." };
}

/**
 * Terminer, rouvrir, reporter.
 *
 * Un seul point d'entrée = une seule validation et un seul contrôle de
 * workspace. Aucune de ces transitions ne touche au suivi lié : une tâche et
 * un suivi ont chacun leur état, et c'est le principe même de la V0.4.
 */
export async function applyTaskAction(formData: FormData): Promise<void> {
  const workspaceId = await getWorkspaceIdForAction();

  const parsed = taskActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("Action invalide.");
  }

  const { id, intent, days } = parsed.data;

  const task = await prisma.task.findFirst({
    where: { id, workspaceId },
    select: { id: true, dueAt: true, completedAt: true, opportunityId: true },
  });

  if (!task) {
    throw new Error("Tâche introuvable.");
  }

  const completed = task.completedAt !== null;
  // Deux états, donc trois transitions légitimes seulement. Une action rapide
  // est un point d'entrée public : ce que l'interface ne propose pas, l'action
  // doit le refuser explicitement.
  const allowed =
    (intent === "complete" && !completed) ||
    (intent === "reopen" && completed) ||
    (intent === "snooze" && !completed);

  if (!allowed) {
    throw new TaskConflictError();
  }

  const now = new Date();

  // Un report part de la date la plus tardive entre aujourd'hui et l'échéance :
  // reporter une tâche en retard de 10 jours doit donner « demain », pas
  // « il y a 9 jours ».
  const base = task.dueAt > now ? task.dueAt : now;

  const data =
    intent === "complete"
      ? { completedAt: now }
      : intent === "reopen"
        ? { completedAt: null }
        : { dueAt: shiftDueDate(base, days ?? 1, APP_TIME_ZONE) };

  // Écriture conditionnelle : le `where` reprend l'état exact lu juste avant.
  // Deux clics simultanés lisent le même état, mais un seul `UPDATE` trouve
  // encore la ligne — l'autre repart à zéro ligne modifiée.
  const { count } = await prisma.task.updateMany({
    where: { id, workspaceId, completedAt: task.completedAt, dueAt: task.dueAt },
    data,
  });

  if (count !== 1) {
    throw new TaskConflictError();
  }

  revalidateTaskPages();
  revalidateCommerceIfLinked(task.opportunityId);
}

/**
 * Recherche du sélecteur de suivi, appelée depuis le formulaire de tâche.
 *
 * C'est une lecture, pas une mutation : elle passe par une action uniquement
 * parce que c'est le canal serveur déjà en place — même schéma que
 * `findContacts` pour le formulaire Follow-Up.
 */
export async function findFollowUps(search: string): Promise<FollowUpPickerOption[]> {
  await getWorkspaceIdForAction();

  const parsed = followUpSearchSchema.safeParse(search);
  if (!parsed.success) return [];

  return searchFollowUpOptions(parsed.data);
}
