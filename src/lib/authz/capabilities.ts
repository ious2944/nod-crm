/**
 * Capacités : ce qu'un point d'entrée demande le droit de faire.
 *
 * Une capacité par **règle** distincte, pas par fonction : `task.edit` couvre
 * toutes les actions qui exigent aujourd'hui `requireTaskEdit` (champs,
 * tags, dépendances, pièces jointes, temps…). La correspondance exacte
 * action → capacité est tenue dans `docs/permissions-v1.md` et vérifiée par
 * `tests/unit/authz-inventory.test.ts`.
 *
 * La liste est une constante (et pas seulement un type) pour que le test
 * d'inventaire puisse refuser une chaîne inconnue.
 *
 * `scope` dit quelle règle existante s'applique quand une ressource est
 * fournie à `authorize` (voir `authorize.ts`) :
 *   - `record`  : la donnée appartient à l'espace de l'acteur ;
 *   - `task`    : droit de `evaluateTaskAccess` (`right`) ;
 *   - `task-trash` / `project-trash` : `evaluateTrashAccess` / `evaluateProjectTrashAccess` ;
 *   - `project` : `canReadProject` / `canEditProjectContent` / `canManageProject`.
 *
 * Ce fichier n'importe rien : il est partagé par le code serveur et les tests.
 */

export const CAPABILITY_RULES = {
  // ─── CRM ─────────────────────────────────────────────────────────────────
  "crm.organization.read": { scope: "record" },
  "crm.organization.create": { scope: "record" },
  "crm.organization.update": { scope: "record" },
  "crm.organization.archive": { scope: "record" },
  "crm.contact.read": { scope: "record" },
  "crm.contact.create": { scope: "record" },
  "crm.contact.update": { scope: "record" },
  "crm.contact.archive": { scope: "record" },
  "crm.contact.import": { scope: "record" },
  "crm.opportunity.read": { scope: "record" },
  "crm.opportunity.create": { scope: "record" },
  "crm.opportunity.update": { scope: "record" },
  "crm.opportunity.delete": { scope: "record" },
  "crm.followup.read": { scope: "record" },
  "crm.followup.create": { scope: "record" },
  "crm.followup.update": { scope: "record" },

  // ─── RGPD ────────────────────────────────────────────────────────────────
  "privacy.treatment.create": { scope: "record" },
  "privacy.treatment.update": { scope: "record" },
  "privacy.treatment.archive": { scope: "record" },
  "privacy.processor.create": { scope: "record" },
  "privacy.processor.update": { scope: "record" },
  "privacy.processor.archive": { scope: "record" },
  "privacy.request.create": { scope: "record" },
  "privacy.request.update": { scope: "record" },
  "privacy.incident.create": { scope: "record" },
  "privacy.incident.update": { scope: "record" },

  // ─── Tâches ──────────────────────────────────────────────────────────────
  /** Créer une tâche (libre, ou dans un projet modifiable — vérifié par le service). */
  "task.create": { scope: "record" },
  /** Lire ; aussi s'abonner soi-même et supprimer sa propre saisie de temps (le service exige plus pour autrui). */
  "task.read": { scope: "task", right: "canRead" },
  /**
   * Commenter, réagir. Une réaction peut viser le commentaire d'un **point
   * d'avancement** (portée projet, `canReadProject`) : au lot B, l'appelant
   * passera alors `project.read` avec la ressource projet, pas `task.comment`.
   */
  "task.comment": { scope: "task", right: "canComment" },
  "task.edit": { scope: "task", right: "canEdit" },
  /** Structure et partage : supprimer, dupliquer, déplacer, réaffecter, abonner **d'autres** personnes. */
  "task.manage": { scope: "task", right: "canManage" },
  /** Modifier ou supprimer **son** commentaire, de tâche ou de point d'avancement (auteur + accès actuel : service). */
  "task.comment.own": { scope: "record" },
  "task.restore": { scope: "task-trash", right: "canRestore" },
  "task.purge": { scope: "task-trash", right: "canPurge" },

  // ─── Projets ─────────────────────────────────────────────────────────────
  "project.create": { scope: "record" },
  /** Lire le projet : favori, duplication, commentaire d'avancement, envoi de formulaire. */
  "project.read": { scope: "project", right: "read" },
  /** Contenu : sections, points d'avancement, champs, formulaires, modèles, import CSV. */
  "project.edit": { scope: "project", right: "edit" },
  /** Administration : réglages, membres, archivage, suppression. */
  "project.manage": { scope: "project", right: "manage" },
  "project.restore": { scope: "project-trash", right: "canRestore" },
  "project.purge": { scope: "project-trash", right: "canPurge" },

  // ─── Espace (réglages partagés) ──────────────────────────────────────────
  "workspace.tag.write": { scope: "record" },
  /** Bibliothèque de champs ; un champ propre à un projet exige aussi `project.edit` (service). */
  "workspace.field.write": { scope: "record" },
  /** Règles d'automatisation (auteur ou éditeur du projet : vérifié par le service). */
  "workspace.rule.write": { scope: "record" },
  "workspace.template.write": { scope: "record" },

  // ─── Préférences personnelles ────────────────────────────────────────────
  "user.view.write": { scope: "record" },
  "user.notification.write": { scope: "record" },
  "user.capacity.write": { scope: "record" },
} as const satisfies Record<string, CapabilityRule>;

export type CapabilityRule =
  | { scope: "record" }
  | { scope: "task"; right: "canRead" | "canComment" | "canEdit" | "canManage" }
  | { scope: "task-trash" | "project-trash"; right: "canRestore" | "canPurge" }
  | { scope: "project"; right: "read" | "edit" | "manage" };

export type Capability = keyof typeof CAPABILITY_RULES;

export const CAPABILITIES = Object.keys(CAPABILITY_RULES) as Capability[];

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITY_RULES, value);
}
