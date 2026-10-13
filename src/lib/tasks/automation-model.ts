/**
 * Modèle des règles d'automatisation : déclencheur → conditions → actions.
 *
 * Client-safe : l'éditeur de règles et le moteur serveur partagent ces schémas
 * et ces libellés. L'exécution vit dans `automations.ts` (serveur).
 */

import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES } from "./constants";
import type { TaskItem, TaskPriority, TaskStatus } from "./types";

export const AUTOMATION_TRIGGERS = {
  TASK_CREATED: "Une tâche est créée",
  TASK_COMPLETED: "Une tâche est terminée",
  STATUS_CHANGED: "Le statut change",
  PRIORITY_CHANGED: "La priorité change",
  ASSIGNEE_CHANGED: "Le responsable change",
  SECTION_CHANGED: "La tâche est déplacée dans une section",
  SUBTASKS_COMPLETED: "Toutes les sous-tâches sont terminées",
  DUE_DATE_APPROACHING: "L'échéance approche",
  APPROVAL_CHANGED: "La validation change",
} as const;

export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;

const statusEnum = z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]);
const priorityEnum = z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]);

export const triggerConfigSchema = z
  .object({
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    sectionId: z.uuid().optional(),
    days: z.number().int().min(0).max(60).optional(),
    approvalStatus: z.enum(["PENDING", "APPROVED", "CHANGES_REQUESTED"]).optional(),
  })
  .default({});

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("priority_in"), values: z.array(priorityEnum).min(1) }),
  z.object({ kind: z.literal("status_in"), values: z.array(statusEnum).min(1) }),
  z.object({ kind: z.literal("assignee_is"), userId: z.uuid().nullable() }),
  z.object({ kind: z.literal("assignee_set") }),
  z.object({ kind: z.literal("has_tag"), tagId: z.uuid() }),
  z.object({ kind: z.literal("in_section"), sectionId: z.uuid() }),
  z.object({ kind: z.literal("is_milestone") }),
  z.object({ kind: z.literal("is_subtask") }),
]);

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_status"), status: statusEnum }),
  z.object({ kind: z.literal("set_priority"), priority: priorityEnum }),
  z.object({ kind: z.literal("set_assignee"), userId: z.uuid().nullable() }),
  z.object({ kind: z.literal("move_to_section"), sectionId: z.uuid() }),
  z.object({ kind: z.literal("add_tag"), tagId: z.uuid() }),
  z.object({
    kind: z.literal("notify"),
    target: z.enum(["assignee", "followers", "project_owner", "user"]),
    userId: z.uuid().optional(),
    message: z.string().max(300).optional(),
  }),
  z.object({ kind: z.literal("add_comment"), body: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("create_reminder"), message: z.string().max(300).optional() }),
  z.object({ kind: z.literal("suggest_complete_parent") }),
  z.object({ kind: z.literal("set_due_in_days"), days: z.number().int().min(0).max(365) }),
]);

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(120),
  trigger: z.enum(Object.keys(AUTOMATION_TRIGGERS) as [AutomationTrigger, ...AutomationTrigger[]]),
  triggerConfig: triggerConfigSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, "Ajoutez au moins une action.").max(10),
  isEnabled: z.boolean().default(true),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type RuleCondition = z.infer<typeof conditionSchema>;
export type RuleAction = z.infer<typeof actionSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;

export interface AutomationRuleItem extends RuleInput {
  id: string;
  projectId: string | null;
  runCount: number;
  lastRunAt: string | null;
  createdById: string | null;
}

export interface AutomationRunItem {
  id: string;
  ruleId: string;
  taskId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
}

export const CONDITION_LABELS: Record<RuleCondition["kind"], string> = {
  priority_in: "La priorité est",
  status_in: "Le statut est",
  assignee_is: "Le responsable est",
  assignee_set: "Un responsable est défini",
  has_tag: "La tâche a le tag",
  in_section: "La tâche est dans la section",
  is_milestone: "La tâche est un jalon",
  is_subtask: "La tâche est une sous-tâche",
};

export const ACTION_LABELS: Record<RuleAction["kind"], string> = {
  set_status: "Changer le statut",
  set_priority: "Changer la priorité",
  set_assignee: "Affecter à",
  move_to_section: "Déplacer dans la section",
  add_tag: "Ajouter le tag",
  notify: "Envoyer une notification",
  add_comment: "Ajouter un commentaire",
  create_reminder: "Créer un rappel pour le responsable",
  suggest_complete_parent: "Proposer de terminer la tâche parente",
  set_due_in_days: "Fixer l'échéance à J+N",
};

/** Événement émis par une mutation de tâche. */
export interface TaskEvent {
  /** Identifiant unique de l'événement : clé d'idempotence des exécutions. */
  id: string;
  type: AutomationTrigger;
  taskId: string;
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
  sectionId?: string | null;
  /** Profondeur de la chaîne de règles ayant produit l'événement. */
  depth: number;
  /** Règles déjà exécutées dans cette chaîne : jamais deux fois. */
  chain: string[];
}

/** Profondeur maximale d'enchaînement de règles. */
export const MAX_AUTOMATION_DEPTH = 3;

export function triggerMatches(
  rule: { trigger: AutomationTrigger; triggerConfig: TriggerConfig },
  event: Pick<TaskEvent, "type" | "to" | "sectionId">,
): boolean {
  if (rule.trigger !== event.type) return false;
  const config = rule.triggerConfig ?? {};
  switch (rule.trigger) {
    case "STATUS_CHANGED":
      return !config.status || config.status === event.to;
    case "PRIORITY_CHANGED":
      return !config.priority || config.priority === event.to;
    case "SECTION_CHANGED":
      return !config.sectionId || config.sectionId === event.sectionId;
    case "APPROVAL_CHANGED":
      return !config.approvalStatus || config.approvalStatus === event.to;
    default:
      return true;
  }
}

export function conditionsMatch(
  conditions: readonly RuleCondition[],
  task: Pick<TaskItem, "priority" | "status" | "assigneeId" | "tagIds" | "isMilestone" | "parentId" | "memberships">,
  projectId: string | null,
): boolean {
  return conditions.every((condition) => {
    switch (condition.kind) {
      case "priority_in":
        return condition.values.includes(task.priority);
      case "status_in":
        return condition.values.includes(task.status);
      case "assignee_is":
        return task.assigneeId === condition.userId;
      case "assignee_set":
        return task.assigneeId !== null;
      case "has_tag":
        return task.tagIds.includes(condition.tagId);
      case "in_section":
        return task.memberships.some(
          (m) => (!projectId || m.projectId === projectId) && m.sectionId === condition.sectionId,
        );
      case "is_milestone":
        return task.isMilestone;
      case "is_subtask":
        return task.parentId !== null;
    }
  });
}

/** Garde anti-boucle : la règle peut-elle s'exécuter dans cette chaîne ? */
export function loopGuard(ruleId: string, event: Pick<TaskEvent, "depth" | "chain">): string | null {
  if (event.chain.includes(ruleId)) return "Boucle évitée : la règle a déjà agi dans cette chaîne.";
  if (event.depth >= MAX_AUTOMATION_DEPTH) return "Profondeur maximale d'enchaînement atteinte.";
  return null;
}
