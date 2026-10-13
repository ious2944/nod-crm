/**
 * Libellés et palettes du module de gestion de travail.
 *
 * Client-safe. Les classes de couleur réutilisent les jetons sémantiques de
 * `globals.css` (calm / soon / today / late / critical / done) pour tout ce qui
 * porte un sens (statut, priorité, état de projet), afin que le mode sombre
 * suive sans palette dédiée. Les couleurs « décoratives » (projets, tags,
 * options de champ) utilisent une palette fermée de pastilles.
 */

import type {
  ApprovalStatus,
  CustomFieldType,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
  TaskPriority,
  TaskStatus,
} from "./types";

export const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "WAITING", "DONE"];
export const TASK_PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const PROJECT_STATUSES: ProjectStatus[] = [
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "ON_HOLD",
  "COMPLETE",
];
export const APPROVAL_STATUSES: ApprovalStatus[] = ["PENDING", "APPROVED", "CHANGES_REQUESTED"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  WAITING: "En attente",
  DONE: "Terminé",
};

export const STATUS_STYLES: Record<TaskStatus, string> = {
  TODO: "bg-calm-bg text-calm-fg",
  IN_PROGRESS: "bg-soon-bg text-soon-fg",
  WAITING: "bg-today-bg text-today-fg",
  DONE: "bg-done-bg text-done-fg",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

export const PRIORITY_STYLES: Record<TaskPriority, string> = {
  LOW: "bg-calm-bg text-calm-fg",
  NORMAL: "bg-soon-bg text-soon-fg",
  HIGH: "bg-late-bg text-late-fg",
  URGENT: "bg-critical-bg text-critical-fg",
};

/** Rang de tri : plus grand = plus prioritaire. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "À valider",
  APPROVED: "Approuvé",
  CHANGES_REQUESTED: "Modifications demandées",
};

export const APPROVAL_STYLES: Record<ApprovalStatus, string> = {
  PENDING: "bg-today-bg text-today-fg",
  APPROVED: "bg-done-bg text-done-fg",
  CHANGES_REQUESTED: "bg-late-bg text-late-fg",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ON_TRACK: "En bonne voie",
  AT_RISK: "À risque",
  OFF_TRACK: "En difficulté",
  ON_HOLD: "En pause",
  COMPLETE: "Terminé",
};

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  ON_TRACK: "bg-done-bg text-done-fg",
  AT_RISK: "bg-today-bg text-today-fg",
  OFF_TRACK: "bg-critical-bg text-critical-fg",
  ON_HOLD: "bg-calm-bg text-calm-fg",
  COMPLETE: "bg-soon-bg text-soon-fg",
};

export const PROJECT_STATUS_DOTS: Record<ProjectStatus, string> = {
  ON_TRACK: "bg-done-fg",
  AT_RISK: "bg-today-fg",
  OFF_TRACK: "bg-critical-fg",
  ON_HOLD: "bg-calm-fg",
  COMPLETE: "bg-soon-fg",
};

export const VISIBILITY_LABELS: Record<ProjectVisibility, string> = {
  WORKSPACE: "Tout l'espace",
  PRIVATE: "Membres uniquement",
};

export const ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: "Propriétaire",
  EDITOR: "Éditeur",
  COMMENTER: "Commentateur",
};

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Texte",
  NUMBER: "Nombre",
  DATE: "Date",
  CHECKBOX: "Case à cocher",
  SINGLE_SELECT: "Sélection simple",
  MULTI_SELECT: "Sélection multiple",
};

/** Palette fermée des pastilles décoratives (projets, tags, options). */
export const COLOR_KEYS = [
  "indigo",
  "blue",
  "sky",
  "teal",
  "green",
  "lime",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "slate",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_SWATCH: Record<ColorKey, string> = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  teal: "bg-teal-500",
  green: "bg-green-500",
  lime: "bg-lime-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  pink: "bg-pink-500",
  purple: "bg-purple-500",
  slate: "bg-slate-500",
};

/** Chip discrète : fond teinté translucide, lisible en clair comme en sombre. */
export const COLOR_CHIP: Record<ColorKey, string> = {
  indigo: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  green: "bg-green-500/15 text-green-700 dark:text-green-300",
  lime: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

/** Couleur de barre (chronologie) : la teinte du projet, en plein. */
export const COLOR_BAR: Record<ColorKey, string> = COLOR_SWATCH;

export function colorKey(value: string | null | undefined): ColorKey {
  return (COLOR_KEYS as readonly string[]).includes(value ?? "")
    ? (value as ColorKey)
    : "indigo";
}

/** Icônes de projet : clés fermées, résolues en composants Lucide côté client. */
export const PROJECT_ICON_KEYS = [
  "folder",
  "briefcase",
  "rocket",
  "target",
  "calendar",
  "megaphone",
  "users",
  "lightbulb",
  "flag",
  "star",
  "heart",
  "code",
  "chart",
  "book",
  "wrench",
  "globe",
] as const;

export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number];

export function projectIconKey(value: string | null | undefined): ProjectIconKey {
  return (PROJECT_ICON_KEYS as readonly string[]).includes(value ?? "")
    ? (value as ProjectIconKey)
    : "folder";
}

/** Types de notification, et leur libellé dans les préférences. */
export const NOTIFICATION_TYPES = {
  ASSIGNED: "Une tâche m'est affectée",
  MENTIONED: "Je suis mentionné dans un commentaire",
  COMMENT: "Nouveau commentaire sur une tâche suivie",
  TASK_COMPLETED: "Une tâche suivie est terminée",
  TASK_CHANGED: "Changement important sur une tâche suivie (échéance, statut)",
  DUE_SOON: "Rappel d'échéance (veille de l'échéance)",
  APPROVAL: "Demande ou réponse de validation",
  PROJECT_STATUS: "Nouveau point d'avancement sur un projet dont je suis membre",
  PROJECT_MEMBER: "Je suis ajouté à un projet",
  AUTOMATION: "Message d'une règle d'automatisation",
  FORM_SUBMISSION: "Nouvelle demande reçue par un formulaire",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Sections créées avec un nouveau projet vierge. */
export const DEFAULT_SECTIONS = ["À faire", "En cours", "Terminé"];

/** Taille maximale d'une pièce jointe. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Émojis proposés pour les réactions. Liste fermée : rien d'autre n'est accepté. */
export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "✅", "🙏"] as const;

export const TASK_LIMITS_V1 = {
  title: 300,
  description: 20_000,
  comment: 5_000,
  projectName: 120,
  projectDescription: 5_000,
  sectionName: 120,
  tagName: 40,
  fieldName: 60,
  optionLabel: 60,
  statusTitle: 160,
  statusBody: 5_000,
  ruleName: 120,
  formName: 120,
  viewName: 80,
} as const;
