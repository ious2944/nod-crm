import "server-only";

import type { Actor } from "@/lib/tasks/access";
import { getActorForAction } from "@/lib/workspace";

import { AuthorizationError, authorize } from "./authorize";
import type { Capability } from "./capabilities";

/**
 * Entrée des Server Actions CRM et RGPD (et des formulaires historiques du
 * module Tâches) : le pendant de `runAction`, mais **transparent**.
 *
 * `runAction` convertit les erreurs en `ActionResult` ; ces actions-là
 * renvoient leurs propres états de formulaire (ou `void`) et lèvent des
 * erreurs que l'interface et les tests attendent telles quelles. Ce helper ne
 * touche donc ni au type de retour ni aux erreurs :
 *
 * 1. résout l'acteur depuis la session, une seule fois — sans session,
 *    `UnauthenticatedError` part comme avant, avant toute lecture du
 *    formulaire ;
 * 2. appelle `authorize` (lot 0 : aucune règle nouvelle, voir `authorize.ts`) ;
 * 3. exécute l'action avec cet acteur et rend son résultat tel quel.
 */
export async function runCrmAction<T>(capability: Capability, fn: (actor: Actor) => Promise<T>): Promise<T> {
  const actor = await getActorForAction();
  const decision = authorize(actor, capability);
  if (!decision.allowed) throw new AuthorizationError(decision.code);
  return fn(actor);
}
