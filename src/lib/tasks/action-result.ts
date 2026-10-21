import "server-only";

import { UnauthenticatedError } from "@/lib/auth/dal";
import { authorize } from "@/lib/authz/authorize";
import type { Capability } from "@/lib/authz/capabilities";
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
 *
 * `capability` passe par le point de contrôle central (`authorize`) avant
 * l'action ; un refus prend la forme d'un `TaskAccessError` du même code.
 */
export async function runAction<T>(capability: Capability, fn: (actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
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
    const decision = authorize(actor, capability);
    if (!decision.allowed) throw new TaskAccessError(decision.code);
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
