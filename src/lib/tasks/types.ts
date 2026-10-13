/**
 * Types partagés du module de gestion de travail (V1.0).
 *
 * Ce fichier ne dépend ni de Prisma ni de `server-only` : il est importé par
 * les composants client comme par la couche serveur. Les unions littérales
 * reprennent exactement les enums Prisma — même convention que
 * `FollowUpStatus` dans `@/lib/follow-ups/domain`.
 *
 * Toutes les dates « calendaires » circulent sous forme de clés `YYYY-MM-DD`
 * dans le fuseau de l'application (`APP_TIME_ZONE`) : le navigateur n'a jamais
 * à raisonner sur des instants ni sur son propre fuseau.
 */

export type TaskStatus = "TODO" | "IN_PROGRESS" | "WAITING" | "DONE";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ApprovalStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
export type ProjectStatus = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ON_HOLD" | "COMPLETE";
export type ProjectVisibility = "WORKSPACE" | "PRIVATE";
export type ProjectRole = "OWNER" | "EDITOR" | "COMMENTER";
export type CustomFieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "SINGLE_SELECT"
  | "MULTI_SELECT";
export type FollowerKind = "COLLABORATOR" | "FOLLOWER";

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/**
 * Règle de récurrence. `weekdays` : 1 = lundi … 7 = dimanche (ISO 8601).
 * `monthDay` : jour du mois visé (borné au dernier jour du mois).
 */
export interface RecurrenceRule {
  freq: RecurrenceFrequency;
  interval: number;
  weekdays?: number[];
  monthDay?: number | null;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
  initials: string;
  isActive: boolean;
}

export interface TagRef {
  id: string;
  name: string;
  color: string;
}

export interface CustomFieldOption {
  id: string;
  label: string;
  color: string;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
}

/**
 * Valeur d'un champ personnalisé côté client :
 * TEXT → string, NUMBER → number, DATE → `YYYY-MM-DD`, CHECKBOX → boolean,
 * SINGLE_SELECT → id d'option, MULTI_SELECT → ids d'options.
 */
export type CustomFieldValue = string | number | boolean | string[] | null;

export interface TaskMembership {
  projectId: string;
  sectionId: string | null;
  position: number;
}

/** Une tâche telle que la manipulent toutes les vues (liste, tableau, calendrier…). */
export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  parentId: string | null;
  subtaskPosition: number;
  isMilestone: boolean;
  isApproval: boolean;
  approvalStatus: ApprovalStatus | null;
  estimatedMinutes: number | null;
  spentMinutes: number;
  tagIds: string[];
  custom: Record<string, CustomFieldValue>;
  memberships: TaskMembership[];
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  attachmentCount: number;
  /** Tâches qui bloquent celle-ci (ouvertes ou non). */
  blockedByIds: string[];
  /** Tâches que celle-ci bloque. */
  blockingIds: string[];
  /** Nombre de bloqueurs encore ouverts : > 0 ⇒ tâche bloquée. */
  openBlockerCount: number;
  recurrence: RecurrenceRule | null;
  hasDescription: boolean;
  /** Début de la description en texte brut (recherche locale, aperçus). */
  excerpt: string;
  contactId: string | null;
  organizationId: string | null;
  opportunityId: string | null;
  followUpId: string | null;
  version: number;
  canEdit: boolean;
}

export interface SectionItem {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  color: string;
  icon: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  archived: boolean;
  isTemplate: boolean;
  isFavorite: boolean;
  ownerId: string | null;
  role: ProjectRole | null;
  canEdit: boolean;
  canManage: boolean;
}

export interface ProjectMemberItem {
  userId: string;
  role: ProjectRole;
}

export interface StatusUpdateItem {
  id: string;
  status: ProjectStatus;
  title: string;
  body: string | null;
  authorId: string | null;
  createdAt: string;
  comments: CommentItem[];
}

export interface CrmRef {
  id: string;
  label: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  members: ProjectMemberItem[];
  customFieldIds: string[];
  contact: CrmRef | null;
  organization: CrmRef | null;
  opportunity: CrmRef | null;
  createdAt: string;
  version: number;
}

export interface ProjectBundle {
  project: ProjectDetail;
  sections: SectionItem[];
  /** Tâches du projet et leurs sous-tâches. */
  tasks: TaskItem[];
  statusUpdates: StatusUpdateItem[];
}

export interface WorkContext {
  me: UserRef;
  users: UserRef[];
  tags: TagRef[];
  fields: CustomFieldDef[];
  projects: ProjectSummary[];
  timeZone: string;
  today: string;
  unreadCount: number;
}

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  startDate: string | null;
  assigneeId: string | null;
}

export interface ReactionItem {
  emoji: string;
  userIds: string[];
}

export interface CommentItem {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionItem[];
}

export interface AttachmentItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: string;
  url: string;
}

export interface ActivityItem {
  id: string;
  actorId: string | null;
  automationRuleId: string | null;
  kind: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface TimeEntryItem {
  id: string;
  userId: string | null;
  minutes: number;
  spentDate: string;
  note: string | null;
}

export interface TaskProjectRef {
  id: string;
  name: string;
  color: string;
  icon: string;
  sectionId: string | null;
  sections: { id: string; name: string }[];
}

export interface FollowerItem {
  userId: string;
  kind: FollowerKind;
}

export interface TaskDetail {
  task: TaskItem;
  description: string | null;
  parent: TaskRef | null;
  subtasks: TaskItem[];
  blockedBy: TaskRef[];
  blocking: TaskRef[];
  followers: FollowerItem[];
  comments: CommentItem[];
  attachments: AttachmentItem[];
  activity: ActivityItem[];
  timeEntries: TimeEntryItem[];
  projects: TaskProjectRef[];
  contact: CrmRef | null;
  organization: CrmRef | null;
  opportunity: CrmRef | null;
  followUp: CrmRef | null;
  canComment: boolean;
  /** Occurrence suivante déjà générée par la récurrence, le cas échéant. */
  recurrenceNextId: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  actorId: string | null;
  taskId: string | null;
  projectId: string | null;
  actionKind: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/** Résultat d'une Server Action : jamais d'exception sérialisée vers le client. */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION";
      /** En cas de conflit : l'état actuel, pour que l'interface se resynchronise. */
      current?: TaskItem;
    };

/** Champs d'une tâche modifiables par `updateTaskFields`. */
export interface TaskPatch {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  startDate?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  isMilestone?: boolean;
  isApproval?: boolean;
  approvalStatus?: ApprovalStatus | null;
  estimatedMinutes?: number | null;
  recurrence?: RecurrenceRule | null;
  contactId?: string | null;
  organizationId?: string | null;
  opportunityId?: string | null;
}

export type TaskPatchField = keyof TaskPatch;
