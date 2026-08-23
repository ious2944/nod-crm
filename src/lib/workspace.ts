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
