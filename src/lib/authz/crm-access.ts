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

/**
 * Lot B — liens vers une fiche CRM (tâche → contact / organisation /
 * opportunité / suivi ; projet → contact / organisation / opportunité).
 *
 * Une tâche ou un projet partagé est lisible par ses membres ; la fiche liée,
 * elle, reste à sa propriétaire. Même règle que `crmReadableWhere`, pour une
 * fiche déjà chargée avec `CRM_OWNER_SELECT` : qui ne la lit pas ne reçoit ni
 * son identifiant ni son nom.
 */
export const CRM_OWNER_SELECT = { workspaceId: true, ownerId: true } as const;

export function canReadCrm(actor: Actor, record: CrmOwned): boolean {
  return record.workspaceId === actor.workspaceId && record.ownerId === actor.id;
}

/** Identifiant de la fiche liée, ou `null` si l'acteur ne la lit pas. */
export function readableCrmId(actor: Actor, record: (CrmOwned & { id: string }) | null): string | null {
  return record && canReadCrm(actor, record) ? record.id : null;
}
