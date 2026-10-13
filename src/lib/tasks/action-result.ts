import "server-only";

import { UnauthenticatedError } from "@/lib/auth/dal";
import { getActorForAction } from "@/lib/workspace";

import { TaskAccessError, TaskValidationError, TaskVersionConflictError, type Actor } from "./access";
import { getTaskItem, userContext } from "./service";
import type { ActionResult } from "./types";

// Branche le moteur de règles sur le service (effet de bord à l'import).
import "./automations";

/**
 * Exécute une Server Action du module et convertit toute erreur en
 * `ActionResult` : en production, Next masque le message des exceptions
 * levées par une action — l'utilisateur ne verrait que « erreur ». Ici, les
 * erreurs métier (droits, validation, conflit) arrivent avec un message clair ;
 * les autres sont journalisées côté serveur et remplacées par un message
 * générique, sans détail interne.
 */
export async function runAction<T>(fn: (actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  let actor: Actor;
  try {
    actor = await getActorForAction();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: "Votre session a expiré. Reconnectez-vous.", code: "FORBIDDEN" };
    }
    throw error;
  }

  try {
    return { ok: true, data: await fn(actor) };
  } catch (error) {
    if (error instanceof TaskVersionConflictError) {
      const current = await getTaskItem(userContext(actor), error.taskId).catch(() => undefined);
      return { ok: false, code: "CONFLICT", error: error.message, current };
    }
    if (error instanceof TaskAccessError) return { ok: false, code: error.code, error: error.message };
    if (error instanceof TaskValidationError) return { ok: false, code: "VALIDATION", error: error.message };
    console.error("[tasks] action en échec", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 200) : undefined,
    });
    return { ok: false, error: "Une erreur est survenue. Vos modifications n'ont pas été enregistrées." };
  }
}
