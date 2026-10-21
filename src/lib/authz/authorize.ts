import "server-only";

import {
  canEditProjectContent,
  canManageProject,
  canReadProject,
  evaluateProjectTrashAccess,
  evaluateTaskAccess,
  evaluateTrashAccess,
  type Actor,
  type ProjectAccessInfo,
  type TaskAccessInfo,
} from "@/lib/tasks/access";

import { CAPABILITY_RULES, type Capability } from "./capabilities";

/**
 * Point de contrôle central des droits (lot 0 des permissions V1).
 *
 * Chaque Server Action d'écriture et chaque route qui écrit appelle
 * `authorize` (via `runAction`, `runCrmAction` ou `withActor`) avant toute
 * lecture ou écriture métier. Voir `docs/permissions-v1.md`.
 *
 * **Lot 0 : aucune règle nouvelle.** `authorize` ne fait que ré-exprimer les
 * règles en vigueur :
 *   - sans ressource : l'acteur est authentifié et son espace vient de la
 *     session — c'est la seule condition actuelle à l'entrée d'une action ;
 *     les contrôles fins restent dans les services et les `where` bornés à
 *     l'espace, inchangés ;
 *   - avec ressource : même espace que l'acteur, puis la fonction existante de
 *     `access.ts` qui correspond à la capacité (voir `CAPABILITY_RULES`).
 *
 * Les refus reprennent la convention de `access.ts` : `NOT_FOUND` quand la
 * ressource n'est pas lisible (« absent » et « interdit » indiscernables),
 * `FORBIDDEN` quand elle l'est mais que le droit demandé manque.
 *
 * ─── Point d'extension — lot A (propriété) ─────────────────────────────────
 * Le lot A ajoutera un `ownerId` aux fiches CRM, RGPD et aux tâches libres.
 * C'est ici, dans `checkRecord`, que la règle « privé par défaut » se branchera
 * (`resource.ownerId === actor.id` pour les capacités `crm.*` / `privacy.*`),
 * et dans `checkTask` / `checkProject` que les services passeront leur
 * ressource au lieu d'appeler directement `access.ts`. Les appelants n'auront
 * pas à changer : ils passent déjà par `authorize`.
 */

export type AuthzResource =
  /** Une donnée bornée à un espace (fiche CRM, RGPD, réglage). */
  | { kind: "record"; workspaceId: string }
  | { kind: "task"; workspaceId: string; task: TaskAccessInfo }
  | { kind: "task-trash"; workspaceId: string; task: Parameters<typeof evaluateTrashAccess>[0] }
  | { kind: "project"; workspaceId: string; project: ProjectAccessInfo }
  | { kind: "project-trash"; workspaceId: string; project: ProjectAccessInfo };

export type AuthzDenialCode = "NOT_FOUND" | "FORBIDDEN";

export type AuthzDecision = { allowed: true } | { allowed: false; code: AuthzDenialCode };

const ALLOW: AuthzDecision = { allowed: true };
const deny = (code: AuthzDenialCode): AuthzDecision => ({ allowed: false, code });

export function authorize(actor: Actor, capability: Capability, resource?: AuthzResource): AuthzDecision {
  // Garde de cohérence : un acteur vient toujours d'une session vérifiée.
  if (!actor.id || !actor.workspaceId) return deny("FORBIDDEN");
  if (!resource) return ALLOW;

  // Frontière d'espace, commune à toutes les capacités.
  if (resource.workspaceId !== actor.workspaceId) return deny("NOT_FOUND");

  const rule = CAPABILITY_RULES[capability];
  switch (rule.scope) {
    case "record":
      return checkRecord();
    case "task":
      return checkTask(actor, rule.right, expectKind(resource, "task", capability).task);
    case "task-trash":
      return checkTrash(evaluateTrashAccess(expectKind(resource, "task-trash", capability).task, actor), rule.right);
    case "project":
      return checkProject(actor, rule.right, expectKind(resource, "project", capability).project);
    case "project-trash":
      return checkTrash(evaluateProjectTrashAccess(expectKind(resource, "project-trash", capability).project, actor), rule.right);
  }
}

/** Une donnée de l'espace : aujourd'hui, toute personne de l'espace y a droit. */
function checkRecord(): AuthzDecision {
  // Lot A : contrôle de propriété ici.
  return ALLOW;
}

function checkTask(
  actor: Actor,
  right: "canRead" | "canComment" | "canEdit" | "canManage",
  task: TaskAccessInfo,
): AuthzDecision {
  const permissions = evaluateTaskAccess(task, actor);
  if (!permissions.canRead) return deny("NOT_FOUND");
  return permissions[right] ? ALLOW : deny("FORBIDDEN");
}

function checkProject(actor: Actor, right: "read" | "edit" | "manage", project: ProjectAccessInfo): AuthzDecision {
  if (!canReadProject(project)) return deny("NOT_FOUND");
  if (right === "edit" && !canEditProjectContent(project, actor)) return deny("FORBIDDEN");
  if (right === "manage" && !canManageProject(project, actor)) return deny("FORBIDDEN");
  return ALLOW;
}

/** Corbeille : invisible sans aucun des deux droits, refus explicite sinon (comme les services). */
function checkTrash(rights: { canRestore: boolean; canPurge: boolean }, right: "canRestore" | "canPurge"): AuthzDecision {
  if (!rights.canRestore && !rights.canPurge) return deny("NOT_FOUND");
  return rights[right] ? ALLOW : deny("FORBIDDEN");
}

function expectKind<K extends AuthzResource["kind"]>(
  resource: AuthzResource,
  kind: K,
  capability: Capability,
): Extract<AuthzResource, { kind: K }> {
  // Erreur de programmation, pas un refus : la capacité et la ressource ne vont pas ensemble.
  if (resource.kind !== kind) throw new Error(`authorize(${capability}) attend une ressource « ${kind} ».`);
  return resource as Extract<AuthzResource, { kind: K }>;
}

/** Refus levé par les helpers d'entrée (`runCrmAction`). Message neutre, comme `TaskAccessError`. */
export class AuthorizationError extends Error {
  readonly code: AuthzDenialCode;
  constructor(code: AuthzDenialCode) {
    super(code === "NOT_FOUND" ? "Élément introuvable." : "Vous n'avez pas les droits nécessaires pour cette action.");
    this.name = "AuthorizationError";
    this.code = code;
  }
}
