import "server-only";

import type { Actor } from "@/lib/tasks/access";

/**
 * Lecture des fiches CRM (organisations, contacts, opportunités, suivis) et
 * RGPD (traitements, sous-traitants, demandes, incidents) — permissions V1,
 * lot A : **seul le propriétaire** voit et modifie une fiche.
 *
 * À combiner dans chaque `where` (`{ ...crmReadableWhere(actor), id }`) :
 * une fiche d'autrui est alors indiscernable d'une fiche inexistante. C'est la
 * règle de la portée `owned` de `authorize`, exprimée pour la base.
 *
 * Le filtre d'espace reste explicite : la propriété s'ajoute, elle ne le
 * remplace pas.
 */
export interface CrmOwned {
  workspaceId: string;
  ownerId: string;
}

export function crmReadableWhere(actor: Actor): CrmOwned {
  return { workspaceId: actor.workspaceId, ownerId: actor.id };
}
