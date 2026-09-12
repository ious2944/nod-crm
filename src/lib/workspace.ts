import "server-only";

import { requireActor, requireUser } from "@/lib/auth/dal";

/**
 * Le workspace autorisé est **dérivé de la session**, jamais d'une entrée
 * client. Il n'existe aucun chemin de code permettant au navigateur de choisir
 * son workspace : ni paramètre d'URL, ni champ de formulaire, ni en-tête.
 *
 * Aujourd'hui un utilisateur appartient à un seul workspace. Le jour où il
 * pourra en avoir plusieurs, c'est ici — et seulement ici — que la sélection
 * devra être arbitrée, en la validant contre la liste de ses appartenances.
 */

/** Pour une page : redirige vers /login si la session est absente. */
export async function getWorkspaceIdForPage(): Promise<string> {
  return (await requireUser()).workspaceId;
}

/** Pour une Server Action : lève `UnauthenticatedError` si la session est absente. */
export async function getWorkspaceIdForAction(): Promise<string> {
  return (await requireActor()).workspaceId;
}

/**
 * Pour une Server Action qui doit aussi journaliser son résultat dans
 * l'audit trail : mêmes garanties que `getWorkspaceIdForAction` (même appel à
 * `requireActor()`, dédupliqué par le `cache()` de la DAL — donc gratuit si
 * l'un des deux a déjà été appelé plus tôt dans la même requête), avec en
 * plus l'identifiant de l'acteur.
 */
export async function getActorForAction(): Promise<{ id: string; workspaceId: string }> {
  const actor = await requireActor();
  return { id: actor.id, workspaceId: actor.workspaceId };
}
