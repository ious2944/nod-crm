/**
 * Validation des entrées du module de gestion de travail (V1.0).
 *
 * Même discipline que le reste de NOD CRM : chaque schéma énumère ses champs
 * (Zod écarte le reste — impossible de forcer `workspaceId`, `version` ou
 * `createdById`), nettoie le texte et borne les tailles. Toute référence
 * (utilisateur, projet, contact…) est ensuite **re-vérifiée en base** contre
 * l'espace de la session : la forme d'un UUID ne prouve rien d'autre.
 */

import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";

import {
  APPROVAL_STATUSES,
  COLOR_KEYS,
  PROJECT_ICON_KEYS,
  PROJECT_STATUSES,
  TASK_LIMITS_V1,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./constants";
import { recurrenceSchema } from "./recurrence";
import type { ApprovalStatus, ProjectStatus, TaskPriority, TaskStatus } from "./types";

const id = z.uuid("Identifiant invalide.");
const nullableId = id.nullable();

/** Texte sur une ligne : espaces normalisés, bornes explicites. */
export const line = (max: number, required = false, label = "Ce champ") =>
  z
    .string()
    .transform(sanitizeText)
    .pipe(
      required
        ? z.string().min(1, `${label} est obligatoire.`).max(max, `${label} dépasse ${max} caractères.`)
        : z.string().max(max, `${label} dépasse ${max} caractères.`),
    );

/** Texte multiligne : on garde les retours à la ligne, on retire les contrôles. */
export const multiline = (max: number) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trimEnd(),
    )
    .pipe(z.string().max(max, `Le texte dépasse ${max} caractères.`));

export const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1970 && y <= 2200;
  }, "Date invalide.");

export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide.");

const statusEnum = z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]);
const priorityEnum = z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]);
const approvalEnum = z.enum(APPROVAL_STATUSES as [ApprovalStatus, ...ApprovalStatus[]]);
const projectStatusEnum = z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]);

export const customValueSchema = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.array(z.uuid()).max(50),
  z.null(),
]);

export const taskPatchSchema = z
  .object({
    title: line(TASK_LIMITS_V1.title, true, "Le titre"),
    description: multiline(TASK_LIMITS_V1.description).nullable(),
    assigneeId: nullableId,
    dueDate: dateKey.nullable(),
    dueTime: timeOfDay.nullable(),
    startDate: dateKey.nullable(),
    status: statusEnum,
    priority: priorityEnum,
    isMilestone: z.boolean(),
    isApproval: z.boolean(),
    approvalStatus: approvalEnum.nullable(),
    estimatedMinutes: z.number().int().min(0).max(100_000).nullable(),
    recurrence: recurrenceSchema.nullable(),
    contactId: nullableId,
    organizationId: nullableId,
    opportunityId: nullableId,
  })
  .partial();

export const createTaskSchema = z.object({
  title: line(TASK_LIMITS_V1.title, true, "Le titre"),
  description: multiline(TASK_LIMITS_V1.description).nullable().optional(),
  projectId: id.optional().nullable(),
  sectionId: id.optional().nullable(),
  placement: z.enum(["top", "bottom"]).optional(),
  afterTaskId: id.optional().nullable(),
  parentId: id.optional().nullable(),
  assigneeId: nullableId.optional(),
  dueDate: dateKey.nullable().optional(),
  dueTime: timeOfDay.nullable().optional(),
  startDate: dateKey.nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  isMilestone: z.boolean().optional(),
  isApproval: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  tagIds: z.array(id).max(30).optional(),
  custom: z.record(z.uuid(), customValueSchema).optional(),
  contactId: nullableId.optional(),
  organizationId: nullableId.optional(),
  opportunityId: nullableId.optional(),
  followUpId: nullableId.optional(),
  templateId: id.optional().nullable(),
});

export type CreateTaskInputV1 = z.input<typeof createTaskSchema>;

export const moveTaskSchema = z.object({
  taskId: id,
  projectId: id,
  sectionId: nullableId,
  beforeId: nullableId.optional(),
  afterId: nullableId.optional(),
});

export const projectInputSchema = z.object({
  name: line(TASK_LIMITS_V1.projectName, true, "Le nom"),
  description: multiline(TASK_LIMITS_V1.projectDescription).nullable().optional(),
  color: z.enum(COLOR_KEYS).optional(),
  icon: z.enum(PROJECT_ICON_KEYS).optional(),
  ownerId: nullableId.optional(),
  startDate: dateKey.nullable().optional(),
  dueDate: dateKey.nullable().optional(),
  visibility: z.enum(["WORKSPACE", "PRIVATE"]).optional(),
  status: projectStatusEnum.optional(),
  memberIds: z.array(id).max(200).optional(),
  templateId: id.nullable().optional(),
  contactId: nullableId.optional(),
  organizationId: nullableId.optional(),
  opportunityId: nullableId.optional(),
});

export const projectPatchSchema = projectInputSchema
  .omit({ memberIds: true, templateId: true })
  .partial();

export const sectionNameSchema = line(TASK_LIMITS_V1.sectionName, true, "Le nom de la section");

export const statusUpdateSchema = z.object({
  status: projectStatusEnum,
  title: line(TASK_LIMITS_V1.statusTitle, true, "Le titre"),
  body: multiline(TASK_LIMITS_V1.statusBody).nullable().optional(),
});

export const commentBodySchema = multiline(TASK_LIMITS_V1.comment).pipe(
  z.string().refine((value) => value.trim().length > 0, "Le commentaire est vide."),
);

export const tagInputSchema = z.object({
  name: line(TASK_LIMITS_V1.tagName, true, "Le nom du tag"),
  color: z.enum(COLOR_KEYS).optional(),
});

export const customFieldInputSchema = z.object({
  name: line(TASK_LIMITS_V1.fieldName, true, "Le nom du champ"),
  type: z.enum(["TEXT", "NUMBER", "DATE", "CHECKBOX", "SINGLE_SELECT", "MULTI_SELECT"]),
  options: z
    .array(
      z.object({
        id: z.uuid().optional(),
        label: line(TASK_LIMITS_V1.optionLabel, true, "Le libellé"),
        color: z.enum(COLOR_KEYS).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const timeEntrySchema = z.object({
  minutes: z.number().int().min(1, "Durée invalide.").max(24 * 60, "Durée invalide."),
  date: dateKey,
  note: line(200).optional().nullable(),
});

export const savedViewSchema = z.object({
  name: line(TASK_LIMITS_V1.viewName, true, "Le nom de la vue"),
  scope: z.string().regex(/^(my-tasks|search|project:[0-9a-f-]{36})$/, "Portée invalide."),
});

export const taskTemplateSchema = z.object({
  name: line(TASK_LIMITS_V1.ruleName, true, "Le nom"),
  title: line(TASK_LIMITS_V1.title, true, "Le titre"),
  description: multiline(TASK_LIMITS_V1.description).nullable().optional(),
  priority: priorityEnum.optional(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  isApproval: z.boolean().optional(),
  subtasks: z.array(line(TASK_LIMITS_V1.title, true, "La sous-tâche")).max(50).optional(),
  tagIds: z.array(id).max(30).optional(),
  projectId: nullableId.optional(),
});

export const formInputSchema = z.object({
  name: line(TASK_LIMITS_V1.formName, true, "Le nom"),
  description: multiline(2000).nullable().optional(),
  sectionId: nullableId.optional(),
  isActive: z.boolean().optional(),
  fields: z
    .object({
      description: z.boolean().default(true),
      dueDate: z.boolean().default(false),
      priority: z.boolean().default(false),
      assignee: z.boolean().default(false),
      fieldIds: z.array(id).max(20).default([]),
    })
    .default({ description: true, dueDate: false, priority: false, assignee: false, fieldIds: [] }),
});
