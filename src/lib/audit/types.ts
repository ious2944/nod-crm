/**
 * Types du journal d'audit.
 *
 * `AuditAction` reprend exactement les valeurs de l'enum Prisma `AuditAction`
 * (voir `prisma/schema.prisma`) sous forme d'union TypeScript littérale — même
 * convention que `FollowUpStatus` dans `@/lib/follow-ups/domain` : la couche
 * métier ne dépend pas du client généré, seulement d'un type qu'elle possède.
 */
export type AuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE" | "DELETE" | "EXPORT";

/**
 * Type d'entité métier journalisé — le nom du modèle Prisma, pas celui de la
 * table SQL. Volontairement une chaîne plutôt qu'un enum en base : ajouter un
 * nouveau module ne doit pas exiger de migration pour pouvoir le journaliser.
 *
 * Ajouter une nouvelle entrée ici à chaque nouveau module métier instrumenté ;
 * c'est le seul endroit où la liste doit rester à jour.
 */
export const AUDIT_ENTITY_TYPES = {
  CONTACT: "Contact",
  ORGANIZATION: "Organization",
  FOLLOW_UP: "FollowUp",
  TASK: "Task",
  OPPORTUNITY: "Opportunity",
  PRIVACY_TREATMENT: "PrivacyTreatment",
  PRIVACY_PROCESSOR: "PrivacyProcessor",
  PRIVACY_REQUEST: "PrivacyRequest",
  PRIVACY_INCIDENT: "PrivacyIncident",
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

/**
 * Un événement à journaliser. Volontairement plat et minimal — voir le README
 * du module pour ce qui est délibérément exclu (snapshot, diff, métadonnées
 * libres).
 */
export interface AuditEvent {
  workspaceId: string;
  /** `null` : aucun acteur applicatif (aucune mutation instrumentée n'est censée être dans ce cas aujourd'hui). */
  userId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  /** `null` quand l'action ne porte pas sur une entité unique. */
  entityId?: string | null;
  requestId?: string | null;
}
