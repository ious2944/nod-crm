import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ENTITY_TYPES } from "@/lib/audit/types";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";

import {
  canEditProjectContent,
  canReadProject,
  evaluateTaskAccess,
  evaluateTrashAccess,
  projectAccessSelect,
  readableProjectWhere,
  taskAccessSelect,
  TaskAccessError,
  TaskValidationError,
  TaskVersionConflictError,
  visibleTaskWhere,
  type Actor,
} from "./access";
import type { TaskEvent } from "./automation-model";
import {
  APPROVAL_LABELS,
  PRIORITY_LABELS,
  REACTION_EMOJIS,
  STATUS_LABELS,
} from "./constants";
import { evenPositions, positionBetween, POSITION_STEP, wouldCreateCycle } from "./graph";
import {
  commentBodySchema,
  createTaskSchema,
  customValueSchema,
  moveTaskSchema,
  taskPatchSchema,
  timeEntrySchema,
  type CreateTaskInputV1,
} from "./inputs";
import { notify } from "./notify";
import { publishChange } from "./realtime";
import { describeRecurrence, nextOccurrence } from "./recurrence";
import { extractMentions, toPlainText } from "./rich-text";
import { loadTaskItems, parseRecurrence, toKey } from "./serialize";
import { lockTasks, structureTransaction } from "./structure";
import { checkpoint } from "./test-hooks";
import type {
  CustomFieldValue,
  RecurrenceRule,
  TaskItem,
  TaskPatch,
  TaskPatchField,
} from "./types";

/**
 * Mutations des tâches (V1.0).
 *
 * Chaque fonction :
 * 1. valide ses entrées (`inputs.ts`) ;
 * 2. relit la tâche **bornée à l'espace de la session** et évalue les droits
 *    (`evaluateTaskAccess`) — refus neutre si absente ou interdite ;
 * 3. écrit en transaction, avec l'historique (`task_activities`) ;
 * 4. publie l'événement temps réel, notifie, et déclenche les règles.
 *
 * Modifications concurrentes : chaque écriture fait un « compare-and-set » sur
 * `version`. En plus, le client envoie pour chaque champ modifié la valeur
 * qu'il avait sous les yeux (`base`). Si quelqu'un a changé **ce champ**
 * entre-temps, l'écriture est refusée avec l'état courant (`CONFLICT`) au lieu
 * d'écraser silencieusement ; si seul un autre champ a changé, la
 * modification passe.
 */

export interface MutationContext {
  actor: Actor;
  /**
   * Mutation déclenchée par une règle. `actor` est alors la personne qui a
   * enregistré la règle en dernier : la règle agit avec **ses droits
   * actuels**, contrôlés comme pour une action manuelle (voir `automations.ts`).
   */
  automation?: { ruleId: string; depth: number; chain: string[] };
  /**
   * L'appelant a déjà vérifié un droit plus étroit (envoi d'un formulaire
   * interne : il suffit de pouvoir lire le projet). Réservé au code serveur.
   */
  trusted?: boolean;
}

export function userContext(actor: Actor): MutationContext {
  return { actor };
}

const actorIdOf = (ctx: MutationContext) => (ctx.automation ? null : ctx.actor.id);

// ─── Événements (règles d'automatisation) ────────────────────────────────────

type EventSink = (ctx: MutationContext, events: TaskEvent[]) => Promise<void>;
let eventSink: EventSink | null = null;

/** Branché par `automations.ts` au chargement : évite une dépendance circulaire. */
export function registerEventSink(sink: EventSink): void {
  eventSink = sink;
}

function makeEvent(
  ctx: MutationContext,
  event: Omit<TaskEvent, "id" | "depth" | "chain">,
  id: string = randomUUID(),
): TaskEvent {
  return {
    ...event,
    id,
    depth: ctx.automation ? ctx.automation.depth + 1 : 0,
    chain: ctx.automation ? [...ctx.automation.chain, ctx.automation.ruleId] : [],
  };
}

async function dispatch(ctx: MutationContext, events: TaskEvent[]): Promise<void> {
  if (!eventSink || events.length === 0) return;
  try {
    await eventSink(ctx, events);
  } catch (error) {
    console.error("[automations] échec du moteur", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
}

// ─── Lecture avec contrôle ────────────────────────────────────────────────────

/** Client de lecture : la base, ou la transaction en cours (contrôles refaits sous verrou). */
type Db = Prisma.TransactionClient | typeof prisma;

async function loadAccess(ctx: MutationContext, taskId: string, db: Db = prisma) {
  const task = await db.task.findFirst({
    where: { id: taskId, workspaceId: ctx.actor.workspaceId },
    select: taskAccessSelect(ctx.actor),
  });
  if (!task) throw new TaskAccessError("NOT_FOUND");
  if (task.deletedAt || task.parent?.deletedAt) throw new TaskAccessError("NOT_FOUND");
  const permissions = ctx.trusted
    ? { canRead: true, canEdit: true, canComment: true, canManage: true }
    : evaluateTaskAccess(task, ctx.actor);
  if (!permissions.canRead) throw new TaskAccessError("NOT_FOUND");
  return { task, permissions };
}

export async function requireTaskRead(ctx: MutationContext, taskId: string, db: Db = prisma) {
  return loadAccess(ctx, taskId, db);
}

export async function requireTaskEdit(ctx: MutationContext, taskId: string, db: Db = prisma) {
  const result = await loadAccess(ctx, taskId, db);
  if (!result.permissions.canEdit) throw new TaskAccessError("FORBIDDEN");
  return result;
}

const MANAGE_REFUSED =
  "Seul un éditeur du projet peut faire cela (supprimer, déplacer, réaffecter ou partager la tâche).";

/** Structure et partage de la tâche : voir `evaluateTaskAccess` (canManage). */
export async function requireTaskManage(ctx: MutationContext, taskId: string, db: Db = prisma) {
  const result = await loadAccess(ctx, taskId, db);
  if (!result.permissions.canManage) throw new TaskAccessError("FORBIDDEN", MANAGE_REFUSED);
  return result;
}

/**
 * Parmi `userIds`, ceux qui peuvent lire la tâche. Sert à ne jamais accorder
 * un accès par effet de bord (mention, abonnement automatique).
 */
export async function readersAmong(workspaceId: string, taskId: string, userIds: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const userId of [...new Set(userIds)]) {
    const actor = { id: userId, workspaceId };
    const task = await prisma.task.findFirst({ where: { id: taskId, workspaceId }, select: taskAccessSelect(actor) });
    if (task && evaluateTaskAccess(task, actor).canRead) result.push(userId);
  }
  return result;
}

async function requireProjectContentEdit(ctx: MutationContext, projectId: string, db: Db = prisma) {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId: ctx.actor.workspaceId },
    select: projectAccessSelect(ctx.actor),
  });
  // Un projet de la corbeille n'accepte rien, pas même d'une règle.
  if (!project || project.deletedAt) throw new TaskAccessError("NOT_FOUND", "Projet introuvable.");
  if (!ctx.trusted) {
    if (!canReadProject(project)) throw new TaskAccessError("NOT_FOUND", "Projet introuvable.");
    if (!canEditProjectContent(project, ctx.actor)) {
      throw new TaskAccessError(
        "FORBIDDEN",
        project.archivedAt ? "Ce projet est archivé." : "Vous ne pouvez pas modifier ce projet.",
      );
    }
  }
  return project;
}

export async function getTaskItem(ctx: MutationContext, taskId: string): Promise<TaskItem> {
  const [item] = await loadTaskItems(ctx.actor, { id: taskId, deletedAt: null });
  if (!item) throw new TaskAccessError("NOT_FOUND");
  return item;
}

// ─── Références CRM et utilisateurs ──────────────────────────────────────────

async function assertUserInWorkspace(actor: Actor, userId: string | null | undefined) {
  if (!userId) return;
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId: actor.workspaceId, isActive: true },
    select: { id: true },
  });
  if (!user) throw new TaskValidationError("Cet utilisateur n'existe pas dans votre espace.");
}

export async function assertCrmLinks(
  actor: Actor,
  links: {
    contactId?: string | null;
    organizationId?: string | null;
    opportunityId?: string | null;
    followUpId?: string | null;
  },
) {
  const { workspaceId } = actor;
  const checks: Promise<void>[] = [];
  if (links.contactId) {
    checks.push(
      prisma.contact.findFirst({ where: { id: links.contactId, workspaceId }, select: { id: true } }).then((r) => {
        if (!r) throw new TaskValidationError("Contact introuvable.");
      }),
    );
  }
  if (links.organizationId) {
    checks.push(
      prisma.organization
        .findFirst({ where: { id: links.organizationId, workspaceId }, select: { id: true } })
        .then((r) => {
          if (!r) throw new TaskValidationError("Organisation introuvable.");
        }),
    );
  }
  if (links.opportunityId) {
    checks.push(
      prisma.opportunity
        .findFirst({ where: { id: links.opportunityId, workspaceId }, select: { id: true } })
        .then((r) => {
          if (!r) throw new TaskValidationError("Opportunité introuvable.");
        }),
    );
  }
  if (links.followUpId) {
    checks.push(
      prisma.followUp.findFirst({ where: { id: links.followUpId, workspaceId }, select: { id: true } }).then((r) => {
        if (!r) throw new TaskValidationError("Suivi introuvable.");
      }),
    );
  }
  await Promise.all(checks);
}

async function userLabel(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
  return user ? user.displayName?.trim() || user.email : null;
}

const dueInstant = (key: string | null | undefined) => (key ? startOfDay(key, APP_TIME_ZONE) : null);

// ─── Historique ──────────────────────────────────────────────────────────────

interface ActivityInput {
  taskId: string;
  kind: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  /**
   * Projet concerné par la ligne (ajout, retrait, changement de section) : la
   * ligne n'est montrée qu'aux personnes qui peuvent lire ce projet.
   */
  projectId?: string | null;
  /**
   * Autre tâche citée par la ligne (dépendance, source d'une copie) : sa
   * valeur (le titre) n'est montrée qu'aux personnes qui peuvent lire cette
   * tâche (voir `getTaskDetail`).
   */
  refTaskId?: string | null;
}

function activityRows(ctx: MutationContext, rows: ActivityInput[]) {
  return rows.map((row) => ({
    workspaceId: ctx.actor.workspaceId,
    taskId: row.taskId,
    actorId: actorIdOf(ctx),
    automationRuleId: ctx.automation?.ruleId ?? null,
    kind: row.kind,
    field: row.field ?? null,
    oldValue: row.oldValue?.slice(0, 500) ?? null,
    newValue: row.newValue?.slice(0, 500) ?? null,
    projectId: row.projectId ?? null,
    refTaskId: row.refTaskId ?? null,
  }));
}

async function logActivity(ctx: MutationContext, rows: ActivityInput[], tx: Prisma.TransactionClient = prisma) {
  if (rows.length === 0) return;
  await tx.taskActivity.createMany({ data: activityRows(ctx, rows) });
}

async function audit(ctx: MutationContext, action: "CREATE" | "UPDATE" | "DELETE", entityId: string) {
  await recordAudit({
    workspaceId: ctx.actor.workspaceId,
    userId: actorIdOf(ctx),
    action,
    entityType: AUDIT_ENTITY_TYPES.TASK,
    entityId,
  });
}

async function projectIdsOf(taskId: string): Promise<string[]> {
  const rows = await prisma.taskProject.findMany({ where: { taskId }, select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

async function broadcast(ctx: MutationContext, taskIds: string[], kind = "task") {
  const projects = await prisma.taskProject.findMany({
    where: { taskId: { in: taskIds } },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  await publishChange({
    w: ctx.actor.workspaceId,
    a: actorIdOf(ctx),
    t: taskIds,
    p: projects.map((p) => p.projectId),
    k: kind,
  });
}

// ─── Création ────────────────────────────────────────────────────────────────

async function nextMembershipPosition(projectId: string, sectionId: string | null, placement: "top" | "bottom") {
  const agg = await prisma.taskProject.aggregate({
    where: { projectId, sectionId },
    _max: { position: true },
    _min: { position: true },
  });
  if (placement === "top") return (agg._min.position ?? POSITION_STEP * 2) - POSITION_STEP;
  return (agg._max.position ?? 0) + POSITION_STEP;
}

async function assertSectionInProject(projectId: string, sectionId: string | null | undefined, db: Db = prisma) {
  if (!sectionId) return;
  const section = await db.projectSection.findFirst({ where: { id: sectionId, projectId }, select: { id: true } });
  if (!section) throw new TaskValidationError("Section introuvable.");
}

export async function createTask(ctx: MutationContext, raw: CreateTaskInputV1): Promise<TaskItem> {
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Tâche invalide.");
  const input = parsed.data;
  const { actor } = ctx;

  // Modèle de tâche : il pré-remplit, l'entrée explicite l'emporte.
  let template: {
    title: string;
    description: string | null;
    priority: TaskItem["priority"];
    estimatedMinutes: number | null;
    isApproval: boolean;
    subtasks: unknown;
    tagIds: string[];
  } | null = null;
  if (input.templateId) {
    const found = await prisma.taskTemplate.findFirst({
      where: { id: input.templateId, workspaceId: actor.workspaceId },
      select: {
        title: true,
        description: true,
        priority: true,
        estimatedMinutes: true,
        isApproval: true,
        subtasks: true,
        tagIds: true,
        project: { select: projectAccessSelect(actor) },
      },
    });
    // Le modèle d'un projet n'est utilisable que par qui peut lire ce projet
    // (même message qu'un identifiant inconnu).
    if (!found || (found.project && !ctx.trusted && !canReadProject(found.project))) {
      throw new TaskValidationError("Modèle introuvable.");
    }
    template = found;
  }

  let parentId: string | null = null;
  let parentManageable = true;
  if (input.parentId) {
    const { task: parent, permissions: parentPermissions } = await requireTaskEdit(ctx, input.parentId);
    parentManageable = parentPermissions.canManage;
    if (parent.parentId) {
      throw new TaskValidationError("Une sous-tâche ne peut pas avoir elle-même de sous-tâches.");
    }
    parentId = input.parentId;
  }

  if (input.projectId) {
    if (parentId) throw new TaskValidationError("Une sous-tâche suit les projets de sa tâche parente.");
    await requireProjectContentEdit(ctx, input.projectId);
    await assertSectionInProject(input.projectId, input.sectionId);
  }

  // Responsable par défaut : soi-même pour une tâche personnelle (ni projet ni
  // parente), personne sinon — comme dans Asana.
  const assigneeId =
    input.assigneeId !== undefined ? input.assigneeId : !input.projectId && !parentId ? actor.id : null;
  await assertUserInWorkspace(actor, assigneeId);
  // Affecter une sous-tâche à quelqu'un lui en donne l'accès : réservé à qui
  // peut gérer la tâche parente.
  if (parentId && !parentManageable && assigneeId && assigneeId !== actor.id) {
    throw new TaskAccessError("FORBIDDEN", MANAGE_REFUSED);
  }
  await assertCrmLinks(actor, input);

  if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
    throw new TaskValidationError("La date de début doit précéder l'échéance.");
  }

  const tagIds = [...new Set([...(input.tagIds ?? []), ...(template?.tagIds ?? [])])];
  if (tagIds.length) {
    const count = await prisma.tag.count({ where: { id: { in: tagIds }, workspaceId: actor.workspaceId } });
    if (count !== tagIds.length) throw new TaskValidationError("Tag introuvable.");
  }

  const status = input.status ?? "TODO";
  const isApproval = input.isApproval ?? template?.isApproval ?? false;

  let position = 0;
  if (input.projectId) {
    const sectionId = input.sectionId ?? null;
    if (input.afterTaskId) {
      const anchor = await prisma.taskProject.findFirst({
        where: { taskId: input.afterTaskId, projectId: input.projectId },
        select: { position: true, sectionId: true },
      });
      if (anchor) {
        const next = await prisma.taskProject.findFirst({
          where: { projectId: input.projectId, sectionId: anchor.sectionId, position: { gt: anchor.position } },
          orderBy: { position: "asc" },
          select: { position: true },
        });
        position = positionBetween(anchor.position, next?.position ?? null) ?? anchor.position + 0.0001;
      } else {
        position = await nextMembershipPosition(input.projectId, sectionId, "bottom");
      }
    } else {
      position = await nextMembershipPosition(input.projectId, sectionId, input.placement ?? "bottom");
    }
  }

  let subtaskPosition = 0;
  if (parentId) {
    const agg = await prisma.task.aggregate({ where: { parentId }, _max: { subtaskPosition: true } });
    subtaskPosition = (agg._max.subtaskPosition ?? 0) + POSITION_STEP;
  }

  const description = input.description ?? template?.description ?? null;

  // Création dans un projet ou sous une parente : sous le verrou de structure,
  // en revérifiant le projet et la parente (une suppression de projet ou une
  // conversion en sous-tâche a pu se produire entre-temps).
  const structural = Boolean(parentId || input.projectId);
  const write = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    structural ? structureTransaction(actor.workspaceId, fn) : prisma.$transaction(fn);

  const created = await write(async (tx) => {
    if (parentId) {
      const { task: parent } = await requireTaskEdit(ctx, parentId, tx);
      if (parent.parentId) throw new TaskValidationError("Une sous-tâche ne peut pas avoir elle-même de sous-tâches.");
    }
    if (input.projectId) await requireProjectContentEdit(ctx, input.projectId, tx);
    await checkpoint("createTask:checked");
    const task = await tx.task.create({
      data: {
        workspaceId: actor.workspaceId,
        title: input.title || template?.title || "Nouvelle tâche",
        notes: description,
        status,
        completedAt: status === "DONE" ? new Date() : null,
        priority: input.priority ?? template?.priority ?? "NORMAL",
        assigneeId,
        createdById: actorIdOf(ctx),
        parentId,
        subtaskPosition,
        dueAt: dueInstant(input.dueDate),
        dueTime: input.dueDate ? (input.dueTime ?? null) : null,
        startAt: dueInstant(input.startDate),
        isMilestone: input.isMilestone ?? false,
        isApproval,
        approvalStatus: isApproval ? "PENDING" : null,
        estimatedMinutes: input.estimatedMinutes ?? template?.estimatedMinutes ?? null,
        contactId: input.contactId ?? null,
        organizationId: input.organizationId ?? null,
        opportunityId: input.opportunityId ?? null,
        followUpId: input.followUpId ?? null,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        projects: input.projectId
          ? {
              create: {
                projectId: input.projectId,
                sectionId: input.sectionId ?? null,
                workspaceId: actor.workspaceId,
                position,
              },
            }
          : undefined,
      },
      select: { id: true },
    });

    // Le créateur suit la tâche ; le responsable aussi.
    const followers = new Set([actorIdOf(ctx), assigneeId].filter((v): v is string => Boolean(v)));
    if (followers.size) {
      await tx.taskFollower.createMany({
        data: [...followers].map((userId) => ({ taskId: task.id, userId, kind: "FOLLOWER" as const })),
        skipDuplicates: true,
      });
    }

    const subtaskTitles = Array.isArray(template?.subtasks)
      ? (template!.subtasks as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 50)
      : [];
    if (subtaskTitles.length && !parentId) {
      await tx.task.createMany({
        data: subtaskTitles.map((title, index) => ({
          workspaceId: actor.workspaceId,
          title,
          parentId: task.id,
          subtaskPosition: (index + 1) * POSITION_STEP,
          createdById: actorIdOf(ctx),
        })),
      });
    }

    await logActivity(ctx, [{ taskId: task.id, kind: "created", newValue: input.title }], tx);
    if (parentId) {
      await logActivity(ctx, [{ taskId: parentId, kind: "subtask_added", newValue: input.title }], tx);
    }
    return task;
  });

  if (input.custom) {
    for (const [fieldId, value] of Object.entries(input.custom)) {
      await writeCustomValue(ctx, created.id, fieldId, value, { log: false });
    }
  }

  await audit(ctx, "CREATE", created.id);

  if (assigneeId && assigneeId !== actorIdOf(ctx)) {
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [assigneeId],
      actorId: actorIdOf(ctx),
      type: "ASSIGNED",
      title: `Nouvelle tâche affectée : ${input.title}`,
      taskId: created.id,
    });
  }

  await broadcast(ctx, parentId ? [created.id, parentId] : [created.id], "task_created");
  await dispatch(ctx, [
    makeEvent(ctx, { type: "TASK_CREATED", taskId: created.id, projectId: input.projectId ?? null }),
  ]);

  return getTaskItem(ctx, created.id);
}

// ─── Modification de champs ───────────────────────────────────────────────────

const PATCH_SELECT = {
  id: true,
  title: true,
  notes: true,
  assigneeId: true,
  dueAt: true,
  dueTime: true,
  startAt: true,
  status: true,
  priority: true,
  isMilestone: true,
  isApproval: true,
  approvalStatus: true,
  estimatedMinutes: true,
  recurrence: true,
  contactId: true,
  organizationId: true,
  opportunityId: true,
  completedAt: true,
  parentId: true,
  version: true,
  createdById: true,
  lastActiveStatus: true,
} satisfies Prisma.TaskSelect;

type PatchRecord = Prisma.TaskGetPayload<{ select: typeof PATCH_SELECT }>;

function currentValue(record: PatchRecord, field: TaskPatchField): unknown {
  switch (field) {
    case "description":
      return record.notes;
    case "dueDate":
      return toKey(record.dueAt);
    case "startDate":
      return toKey(record.startAt);
    case "recurrence":
      return parseRecurrence(record.recurrence);
    default:
      return record[field as keyof PatchRecord] ?? null;
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return false;
}

function fieldLabel(field: TaskPatchField): string {
  const labels: Record<TaskPatchField, string> = {
    title: "Titre",
    description: "Description",
    assigneeId: "Responsable",
    dueDate: "Échéance",
    dueTime: "Heure",
    startDate: "Date de début",
    status: "Statut",
    priority: "Priorité",
    isMilestone: "Jalon",
    isApproval: "Validation",
    approvalStatus: "Validation",
    estimatedMinutes: "Temps estimé",
    recurrence: "Récurrence",
    contactId: "Contact",
    organizationId: "Organisation",
    opportunityId: "Opportunité",
  };
  return labels[field];
}

async function displayValue(field: TaskPatchField, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  switch (field) {
    case "assigneeId":
      return userLabel(value as string);
    case "status":
      return STATUS_LABELS[value as TaskItem["status"]];
    case "priority":
      return PRIORITY_LABELS[value as TaskItem["priority"]];
    case "approvalStatus":
      return APPROVAL_LABELS[value as keyof typeof APPROVAL_LABELS];
    case "isMilestone":
    case "isApproval":
      return value ? "Oui" : "Non";
    case "recurrence":
      return describeRecurrence(value as RecurrenceRule);
    case "description":
      return toPlainText(value as string).slice(0, 200);
    case "estimatedMinutes":
      return `${value} min`;
    case "contactId": {
      const c = await prisma.contact.findUnique({ where: { id: value as string }, select: { firstName: true, lastName: true } });
      return c ? `${c.firstName} ${c.lastName}`.trim() : null;
    }
    case "organizationId": {
      const o = await prisma.organization.findUnique({ where: { id: value as string }, select: { name: true } });
      return o?.name ?? null;
    }
    case "opportunityId": {
      const o = await prisma.opportunity.findUnique({ where: { id: value as string }, select: { name: true } });
      return o?.name ?? null;
    }
    default:
      return String(value);
  }
}

export interface UpdateOptions {
  /** Valeurs que le client avait sous les yeux, pour la détection de conflit. */
  base?: Partial<Record<TaskPatchField, unknown>>;
}

export async function updateTaskFields(
  ctx: MutationContext,
  taskId: string,
  rawPatch: TaskPatch,
  options: UpdateOptions = {},
): Promise<TaskItem> {
  const parsed = taskPatchSchema.safeParse(rawPatch);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Modification invalide.");
  const patch = parsed.data as TaskPatch;

  const { permissions } = await requireTaskEdit(ctx, taskId);
  const { actor } = ctx;

  const record = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspaceId },
    select: PATCH_SELECT,
  });
  if (!record) throw new TaskAccessError("NOT_FOUND");

  // Conflit : un champ que l'utilisateur modifie a changé depuis qu'il l'a lu.
  if (options.base) {
    for (const [field, baseValue] of Object.entries(options.base) as [TaskPatchField, unknown][]) {
      if (!(field in patch)) continue;
      if (!same(currentValue(record, field), baseValue)) {
        throw new TaskVersionConflictError(taskId);
      }
    }
  }

  const changes = (Object.keys(patch) as TaskPatchField[]).filter(
    (field) => !same(currentValue(record, field), patch[field]),
  );
  if (changes.length === 0) return getTaskItem(ctx, taskId);

  if (changes.includes("assigneeId")) {
    // Réaffecter donne l'accès à la nouvelle personne : droit de gestion.
    if (!permissions.canManage) throw new TaskAccessError("FORBIDDEN", MANAGE_REFUSED);
    await assertUserInWorkspace(actor, patch.assigneeId);
  }

  // ── Circuit de validation ──
  const isApproval = patch.isApproval ?? record.isApproval;
  const assigneeAfter = "assigneeId" in patch ? patch.assigneeId : record.assigneeId;
  let approvalAfter = "approvalStatus" in patch ? patch.approvalStatus : record.approvalStatus;
  if (changes.includes("approvalStatus") && patch.approvalStatus && patch.approvalStatus !== "PENDING" && !ctx.automation) {
    // La décision revient à la personne responsable de la validation ; sans
    // responsable, à un éditeur du projet.
    const approver = assigneeAfter ? assigneeAfter === actor.id : permissions.canManage;
    if (!approver) throw new TaskAccessError("FORBIDDEN", "Seule la personne chargée de la validation peut approuver ou demander des modifications.");
  }
  if (changes.includes("approvalStatus") && patch.approvalStatus === "APPROVED" && !changes.includes("status")) {
    // Approuver termine la demande.
    patch.status = "DONE";
    changes.push("status");
  }
  if (changes.includes("approvalStatus") && patch.approvalStatus === "CHANGES_REQUESTED" && record.status === "DONE" && !changes.includes("status")) {
    patch.status = record.lastActiveStatus ?? "IN_PROGRESS";
    changes.push("status");
  }
  if (changes.includes("status") && patch.status === "DONE" && isApproval && approvalAfter !== "APPROVED") {
    throw new TaskValidationError("Cette demande de validation doit être approuvée avant d'être terminée.");
  }
  if (changes.includes("status") && record.status === "DONE" && patch.status !== "DONE" && isApproval && approvalAfter === "APPROVED") {
    // Rouvrir une demande approuvée la remet à valider.
    patch.approvalStatus = "PENDING";
    approvalAfter = "PENDING";
    if (!changes.includes("approvalStatus")) changes.push("approvalStatus");
  }
  await assertCrmLinks(actor, {
    contactId: changes.includes("contactId") ? patch.contactId : null,
    organizationId: changes.includes("organizationId") ? patch.organizationId : null,
    opportunityId: changes.includes("opportunityId") ? patch.opportunityId : null,
  });

  const nextStart = "startDate" in patch ? patch.startDate : toKey(record.startAt);
  const nextDue = "dueDate" in patch ? patch.dueDate : toKey(record.dueAt);
  if (nextStart && nextDue && nextStart > nextDue) {
    throw new TaskValidationError("La date de début doit précéder l'échéance.");
  }

  const data: Prisma.TaskUpdateManyMutationInput = { version: { increment: 1 } };
  for (const field of changes) {
    const value = patch[field];
    switch (field) {
      case "description":
        data.notes = value as string | null;
        break;
      case "dueDate":
        data.dueAt = dueInstant(value as string | null);
        if (!value) data.dueTime = null;
        break;
      case "startDate":
        data.startAt = dueInstant(value as string | null);
        break;
      case "recurrence":
        data.recurrence = value ? (value as Prisma.InputJsonValue) : Prisma.DbNull;
        break;
      case "status":
        data.status = value as TaskItem["status"];
        data.completedAt = value === "DONE" ? new Date() : null;
        // Mémorise le dernier statut actif : la réouverture y reviendra.
        if (value === "DONE" && record.status !== "DONE") data.lastActiveStatus = record.status;
        break;
      case "isApproval":
        data.isApproval = value as boolean;
        data.approvalStatus = value ? (record.approvalStatus ?? "PENDING") : null;
        break;
      case "approvalStatus":
        if (!(patch.isApproval ?? record.isApproval) && value) {
          throw new TaskValidationError("Cette tâche n'est pas une demande de validation.");
        }
        data.approvalStatus = value as TaskItem["approvalStatus"];
        break;
      default:
        (data as Record<string, unknown>)[field] = value;
    }
  }
  if ("dueTime" in patch && !nextDue) data.dueTime = null;

  const activity: ActivityInput[] = [];
  for (const field of changes) {
    if (field === "dueTime" && !nextDue) continue;
    activity.push({
      taskId,
      kind: field === "status" && patch.status === "DONE" ? "completed" : field === "status" && record.status === "DONE" ? "reopened" : "field",
      field: fieldLabel(field),
      oldValue: await displayValue(field, currentValue(record, field)),
      newValue: await displayValue(field, patch[field]),
    });
  }

  // Terminer une tâche peut créer l'occurrence suivante (récurrence) : dans
  // la même transaction, sous le verrou de structure, pour qu'un arrêt entre
  // les deux ne perde jamais l'occurrence.
  const completing = changes.includes("status") && patch.status === "DONE";
  const write = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    completing ? structureTransaction(actor.workspaceId, fn) : prisma.$transaction(fn);
  const nextId = await write(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { id: taskId, workspaceId: actor.workspaceId, version: record.version },
      data,
    });
    if (count !== 1) throw new TaskVersionConflictError(taskId);
    await logActivity(ctx, activity, tx);
    if (changes.includes("assigneeId") && patch.assigneeId) {
      await tx.taskFollower.createMany({
        data: [{ taskId, userId: patch.assigneeId, kind: "FOLLOWER" }],
        skipDuplicates: true,
      });
    }
    return completing ? spawnNextOccurrenceIn(tx, ctx, taskId) : null;
  });

  await audit(ctx, "UPDATE", taskId);

  const followers = await prisma.taskFollower.findMany({ where: { taskId }, select: { userId: true } });
  const followerIds = followers.map((f) => f.userId);
  const title = patch.title ?? record.title;
  const assignee = "assigneeId" in patch ? patch.assigneeId : record.assigneeId;

  // ── Notifications des changements importants ──
  if (changes.includes("assigneeId") && patch.assigneeId) {
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [patch.assigneeId],
      actorId: actorIdOf(ctx),
      type: "ASSIGNED",
      title: `Tâche affectée : ${title}`,
      taskId,
    });
  }
  if (changes.includes("status") && patch.status === "DONE") {
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [...followerIds, record.createdById],
      actorId: actorIdOf(ctx),
      type: "TASK_COMPLETED",
      title: `Tâche terminée : ${title}`,
      taskId,
    });
  } else if (changes.includes("dueDate") || changes.includes("status")) {
    const what = changes.includes("dueDate")
      ? `Échéance modifiée${nextDue ? ` : ${nextDue.split("-").reverse().join("/")}` : " (retirée)"}`
      : `Statut : ${STATUS_LABELS[patch.status!]}`;
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [assignee, ...followerIds],
      actorId: actorIdOf(ctx),
      type: "TASK_CHANGED",
      title: `${title} — ${what}`,
      taskId,
    });
  }
  if (changes.includes("isApproval") && patch.isApproval && assignee) {
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [assignee],
      actorId: actorIdOf(ctx),
      type: "APPROVAL",
      title: `Validation demandée : ${title}`,
      taskId,
    });
  }
  if (changes.includes("approvalStatus") && patch.approvalStatus === "PENDING" && record.approvalStatus === "CHANGES_REQUESTED" && assignee) {
    // Nouvelle soumission après une demande de modifications.
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [assignee],
      actorId: actorIdOf(ctx),
      type: "APPROVAL",
      title: `Validation demandée à nouveau : ${title}`,
      taskId,
    });
  }
  if (changes.includes("approvalStatus") && patch.approvalStatus && patch.approvalStatus !== "PENDING") {
    await notify({
      workspaceId: actor.workspaceId,
      recipients: [record.createdById, ...followerIds],
      actorId: actorIdOf(ctx),
      type: "APPROVAL",
      title: `${title} — ${APPROVAL_LABELS[patch.approvalStatus]}`,
      taskId,
    });
  }

  const touched = [taskId];
  if (record.parentId) touched.push(record.parentId);

  // ── Récurrence : l'occurrence suivante a été créée avec l'achèvement ──
  if (nextId) touched.push(nextId);

  await broadcast(ctx, touched);

  // ── Règles ──
  const projectIds = await projectIdsOf(taskId);
  const events: TaskEvent[] = [];
  // Un même changement produit un événement par projet de la tâche, avec un
  // identifiant commun : une règle d'espace ne s'exécute ainsi qu'une fois.
  const forEachProject = (event: Omit<TaskEvent, "id" | "depth" | "chain" | "projectId">) => {
    const targets = projectIds.length ? projectIds : [null];
    const shared = randomUUID();
    for (const projectId of targets) events.push(makeEvent(ctx, { ...event, projectId }, shared));
  };
  if (changes.includes("status")) {
    forEachProject({ type: "STATUS_CHANGED", taskId, from: record.status, to: patch.status });
    if (patch.status === "DONE") forEachProject({ type: "TASK_COMPLETED", taskId });
  }
  if (changes.includes("priority")) {
    forEachProject({ type: "PRIORITY_CHANGED", taskId, from: record.priority, to: patch.priority });
  }
  if (changes.includes("assigneeId")) {
    forEachProject({ type: "ASSIGNEE_CHANGED", taskId, from: record.assigneeId, to: patch.assigneeId ?? null });
  }
  if (changes.includes("approvalStatus") && patch.approvalStatus) {
    forEachProject({ type: "APPROVAL_CHANGED", taskId, to: patch.approvalStatus });
  }

  // Toutes les sous-tâches terminées : événement sur la parente + suggestion.
  if (changes.includes("status") && patch.status === "DONE" && record.parentId) {
    const open = await prisma.task.count({ where: { parentId: record.parentId, status: { not: "DONE" }, deletedAt: null } });
    if (open === 0) {
      const parent = await prisma.task.findUnique({
        where: { id: record.parentId },
        select: { id: true, title: true, status: true, assigneeId: true },
      });
      if (parent && parent.status !== "DONE") {
        const parentProjects = await projectIdsOf(parent.id);
        const shared = randomUUID();
        for (const projectId of parentProjects.length ? parentProjects : [null]) {
          events.push(makeEvent(ctx, { type: "SUBTASKS_COMPLETED", taskId: parent.id, projectId }, shared));
        }
      }
    }
  }
  await dispatch(ctx, events);

  return getTaskItem(ctx, taskId);
}

// ─── Récurrence ───────────────────────────────────────────────────────────────

/**
 * Crée l'occurrence suivante d'une tâche récurrente qui vient d'être terminée.
 * Idempotent : `recurrence_origin_id` est unique, et l'appelant tient la ligne
 * de la source verrouillée (mise à jour dans la même transaction) : un second
 * achèvement (double clic, réouverture puis nouvel achèvement) attend, puis
 * trouve l'occurrence existante.
 */
export async function spawnNextOccurrence(ctx: MutationContext, taskId: string): Promise<string | null> {
  return structureTransaction(ctx.actor.workspaceId, async (tx) => {
    await lockTasks(tx, [taskId]);
    return spawnNextOccurrenceIn(tx, ctx, taskId);
  });
}

async function spawnNextOccurrenceIn(tx: Prisma.TransactionClient, ctx: MutationContext, taskId: string): Promise<string | null> {
  await checkpoint("spawnNextOccurrence:start");
  const source = await tx.task.findFirst({
    where: { id: taskId, workspaceId: ctx.actor.workspaceId },
    include: {
      tags: true,
      customValues: true,
      projects: true,
      followers: true,
      subtasks: { where: { deletedAt: null }, orderBy: { subtaskPosition: "asc" } },
      recurrenceNext: { select: { id: true } },
    },
  });
  if (!source) return null;
  const rule = parseRecurrence(source.recurrence);
  if (!rule) return null;
  if (source.recurrenceNext) return source.recurrenceNext.id;

  const today = dayKey(new Date(), APP_TIME_ZONE);
  const fromKey = source.dueAt ? dayKey(source.dueAt, APP_TIME_ZONE) : today;
  let nextDue = nextOccurrence(rule, fromKey);
  // Rattrapage : une tâche quotidienne en retard d'un mois ne doit pas générer
  // une occurrence déjà en retard.
  for (let guard = 0; nextDue < today && guard < 1000; guard += 1) nextDue = nextOccurrence(rule, nextDue);

  let nextStart: string | null = null;
  if (source.startAt && source.dueAt) {
    const span = Math.round(
      (Date.parse(`${dayKey(source.dueAt, APP_TIME_ZONE)}T00:00:00Z`) -
        Date.parse(`${dayKey(source.startAt, APP_TIME_ZONE)}T00:00:00Z`)) /
        86_400_000,
    );
    nextStart = new Date(Date.parse(`${nextDue}T00:00:00Z`) - span * 86_400_000).toISOString().slice(0, 10);
  }

  const task = await tx.task.create({
    data: {
      workspaceId: source.workspaceId,
      title: source.title,
      notes: source.notes,
      priority: source.priority,
      assigneeId: source.assigneeId,
      createdById: source.createdById,
      parentId: source.parentId,
      subtaskPosition: source.subtaskPosition + 0.5,
      dueAt: startOfDay(nextDue, APP_TIME_ZONE),
      dueTime: source.dueTime,
      startAt: nextStart ? startOfDay(nextStart, APP_TIME_ZONE) : null,
      isMilestone: source.isMilestone,
      isApproval: source.isApproval,
      approvalStatus: source.isApproval ? "PENDING" : null,
      recurrence: source.recurrence ?? Prisma.DbNull,
      recurrenceOriginId: source.id,
      estimatedMinutes: source.estimatedMinutes,
      contactId: source.contactId,
      organizationId: source.organizationId,
      opportunityId: source.opportunityId,
      followUpId: source.followUpId,
      tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
      customValues: {
        create: source.customValues.map((v) => ({
          fieldId: v.fieldId,
          workspaceId: v.workspaceId,
          textValue: v.textValue,
          numberValue: v.numberValue,
          dateValue: v.dateValue,
          boolValue: v.boolValue,
          optionIds: v.optionIds,
        })),
      },
      projects: {
        create: source.projects.map((p) => ({
          projectId: p.projectId,
          sectionId: p.sectionId,
          workspaceId: p.workspaceId,
          position: p.position + 0.5,
        })),
      },
      followers: { create: source.followers.map((f) => ({ userId: f.userId, kind: f.kind })) },
    },
    select: { id: true },
  });
  if (source.subtasks.length) {
    await tx.task.createMany({
      data: source.subtasks.map((sub) => ({
        workspaceId: sub.workspaceId,
        title: sub.title,
        notes: sub.notes,
        priority: sub.priority,
        assigneeId: sub.assigneeId,
        createdById: sub.createdById,
        parentId: task.id,
        subtaskPosition: sub.subtaskPosition,
        estimatedMinutes: sub.estimatedMinutes,
      })),
    });
  }
  await logActivity(
    ctx,
    [
      { taskId: task.id, kind: "recurrence_created", newValue: `Occurrence suivante de « ${source.title} »` },
      { taskId: source.id, kind: "recurrence_spawned", newValue: nextDue.split("-").reverse().join("/") },
    ],
    tx,
  );
  return task.id;
}

// ─── Suppression, duplication ─────────────────────────────────────────────────

/**
 * Met la tâche (et ses sous-tâches encore actives) à la corbeille. Rien n'est
 * effacé : commentaires, pièces jointes, historique et liens restent en base
 * et réapparaissent à la restauration. Les sous-tâches mises à la corbeille en
 * même temps partagent le même horodatage `deleted_at`, qui sert à les
 * restaurer ensemble.
 */
export async function deleteTask(ctx: MutationContext, taskId: string): Promise<{ id: string; parentId: string | null }> {
  await requireTaskManage(ctx, taskId);
  const now = new Date();

  const { task, projectIds } = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    const { task } = await requireTaskManage(ctx, taskId, tx);
    const projectIds = (await tx.taskProject.findMany({ where: { taskId }, select: { projectId: true } })).map((r) => r.projectId);
    await tx.task.updateMany({
      where: { workspaceId: ctx.actor.workspaceId, deletedAt: null, OR: [{ id: taskId }, { parentId: taskId }] },
      data: { deletedAt: now, deletedById: actorIdOf(ctx), version: { increment: 1 } },
    });
    await logActivity(
      ctx,
      [
        { taskId, kind: "trashed" },
        ...(task.parentId ? [{ taskId: task.parentId, kind: "subtask_removed" }] : []),
      ],
      tx,
    );
    return { task, projectIds };
  });
  await audit(ctx, "DELETE", taskId);
  await publishChange({
    w: ctx.actor.workspaceId,
    a: actorIdOf(ctx),
    t: task.parentId ? [taskId, task.parentId] : [taskId],
    p: projectIds,
    k: "task_deleted",
  });
  return { id: taskId, parentId: task.parentId };
}

async function loadTrashed(ctx: MutationContext, taskId: string, db: Db = prisma) {
  const task = await db.task.findFirst({
    where: { id: taskId, workspaceId: ctx.actor.workspaceId, deletedAt: { not: null } },
    select: { ...taskAccessSelect(ctx.actor), createdById: true, deletedById: true, deletedWithProjectId: true },
  });
  if (!task) throw new TaskAccessError("NOT_FOUND");
  // Supprimée avec son projet : introuvable ici, elle se restaure avec lui
  // (`evaluateTrashAccess` refuse), sans révéler le projet.
  const rights = evaluateTrashAccess(task, ctx.actor);
  if (!rights.canRestore && !rights.canPurge) throw new TaskAccessError("NOT_FOUND");
  return { task, rights };
}

export interface TrashItem {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: string | null;
  parentTitle: string | null;
  projects: string[];
  subtaskCount: number;
  canRestore: boolean;
  canPurge: boolean;
}

/** Corbeille de l'espace, limitée aux tâches que l'acteur peut restaurer ou supprimer. */
export async function listTrash(actor: Actor): Promise<TrashItem[]> {
  const rows = await prisma.task.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deletedAt: { not: null },
      // Supprimées avec leur projet : elles figurent sous ce projet.
      deletedWithProjectId: null,
      // Les sous-tâches supprimées avec leur parente sont restaurées avec elle.
      OR: [{ parentId: null }, { parent: { deletedAt: null } }],
    },
    select: {
      ...taskAccessSelect(actor),
      title: true,
      createdById: true,
      deletedById: true,
      deletedBy: { select: { displayName: true, email: true } },
      parent: { select: { ...taskAccessSelect(actor).parent.select, title: true } },
      projects: { select: { project: { select: { ...projectAccessSelect(actor), name: true } } } },
    },
    orderBy: { deletedAt: "desc" },
    take: 300,
  });
  const items: TrashItem[] = [];
  for (const row of rows) {
    const rights = evaluateTrashAccess(row, actor);
    if (!rights.canRestore && !rights.canPurge) continue;
    const subtaskCount = await prisma.task.count({ where: { parentId: row.id, deletedAt: row.deletedAt } });
    const projects = (row.parent ?? row).projects
      .map((p) => p.project as typeof p.project & { name?: string })
      .filter((p) => canReadProject(p))
      .map((p) => p.name ?? "");
    items.push({
      id: row.id,
      title: row.title,
      deletedAt: row.deletedAt!.toISOString(),
      deletedBy: row.deletedBy ? row.deletedBy.displayName?.trim() || row.deletedBy.email : null,
      parentTitle: row.parent?.title ?? null,
      projects,
      subtaskCount,
      ...rights,
    });
  }
  return items;
}

/** Restaure une tâche et les sous-tâches mises à la corbeille avec elle. */
export async function restoreTask(ctx: MutationContext, taskId: string): Promise<TaskItem> {
  const task = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    // Contrôle sous verrou : une purge ou une suppression de projet a pu
    // passer depuis l'affichage de la corbeille.
    const { task, rights } = await loadTrashed(ctx, taskId, tx);
    if (!rights.canRestore) throw new TaskAccessError("FORBIDDEN", MANAGE_REFUSED);
    if (task.parent?.deletedAt) throw new TaskValidationError("Restaurez d'abord la tâche parente.");
    await checkpoint("restoreTask:checked");
    await tx.task.updateMany({
      where: {
        workspaceId: ctx.actor.workspaceId,
        OR: [{ id: taskId }, { parentId: taskId, deletedAt: task.deletedAt }],
      },
      data: { deletedAt: null, deletedById: null, version: { increment: 1 } },
    });
    await logActivity(ctx, [{ taskId, kind: "restored" }], tx);
    return task;
  });
  await audit(ctx, "UPDATE", taskId);
  await broadcast(ctx, task.parentId ? [taskId, task.parentId] : [taskId], "task_created");
  return getTaskItem(ctx, taskId);
}

/**
 * Suppression définitive depuis la corbeille : réservée aux propriétaires de
 * tous les projets de la tâche, corbeille comprise (ou, pour une tâche libre,
 * à son créateur et à la personne qui l'a supprimée). Efface aussi les
 * fichiers joints — seulement si la tâche a bien été effacée : une
 * restauration concurrente l'emporte, et ses fichiers restent intacts.
 */
export async function purgeTask(ctx: MutationContext, taskId: string): Promise<void> {
  const storageKeys = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    const { rights } = await loadTrashed(ctx, taskId, tx);
    if (!rights.canPurge) {
      throw new TaskAccessError("FORBIDDEN", "Seul le propriétaire de chacun de ses projets peut supprimer définitivement cette tâche.");
    }
    const attachments = await tx.taskAttachment.findMany({
      where: { OR: [{ taskId }, { task: { parentId: taskId } }] },
      select: { storageKey: true },
    });
    await checkpoint("purgeTask:scanned");
    const { count } = await tx.task.deleteMany({ where: { id: taskId, workspaceId: ctx.actor.workspaceId, deletedAt: { not: null } } });
    if (count !== 1) throw new TaskAccessError("NOT_FOUND");
    return attachments.map((a) => a.storageKey);
  });
  for (const key of storageKeys) {
    await objectStore.remove(key).catch(() => {});
  }
  await audit(ctx, "DELETE", taskId);
}

export async function duplicateTask(
  ctx: MutationContext,
  taskId: string,
  options: { includeSubtasks?: boolean } = {},
): Promise<TaskItem> {
  await requireTaskManage(ctx, taskId);

  const created = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    await requireTaskManage(ctx, taskId, tx);
    const source = await tx.task.findFirst({
      where: { id: taskId, workspaceId: ctx.actor.workspaceId },
      include: {
        tags: true,
        customValues: { include: { field: { select: { projectId: true } } } },
        projects: { include: { project: { select: projectAccessSelect(ctx.actor) } } },
        subtasks: { where: { deletedAt: null }, orderBy: { subtaskPosition: "asc" } },
      },
    });
    if (!source) throw new TaskAccessError("NOT_FOUND");
    if (source.parentId) await requireTaskManage(ctx, source.parentId, tx);

    // La copie n'entre que dans les projets actifs que la personne peut
    // modifier ; les autres (corbeille, lecture seule, privés non accessibles)
    // sont ignorés, avec les valeurs de leurs champs propres.
    const kept = source.projects.filter((m) => !m.project.deletedAt && canEditProjectContent(m.project, ctx.actor));
    // Garde-fou : une tâche de projet ne devient jamais libre par copie.
    if (source.projects.length > 0 && kept.length === 0) {
      throw new TaskAccessError("FORBIDDEN", MANAGE_REFUSED);
    }
    // Champs propres à un projet : copiables seulement si la copie vit dans ce
    // projet. Une sous-tâche n'a pas de projet : elle suit ceux de sa parente
    // (la copie garde la même parente) — on retient ses projets actifs que la
    // personne peut lire, jamais un projet privé qui lui est inaccessible.
    let fieldProjects = new Set(kept.map((m) => m.projectId));
    if (source.parentId) {
      const parentProjects = await tx.taskProject.findMany({
        where: { taskId: source.parentId, project: { deletedAt: null } },
        select: { projectId: true, project: { select: projectAccessSelect(ctx.actor) } },
      });
      fieldProjects = new Set(parentProjects.filter((m) => canReadProject(m.project)).map((m) => m.projectId));
    }
    const values = source.customValues.filter((v) => !v.field.projectId || fieldProjects.has(v.field.projectId));

    const copies: { projectId: string; sectionId: string | null; position: number }[] = [];
    for (const membership of kept) {
      const next = await tx.taskProject.findFirst({
        where: { projectId: membership.projectId, sectionId: membership.sectionId, position: { gt: membership.position } },
        orderBy: { position: "asc" },
        select: { position: true },
      });
      copies.push({
        projectId: membership.projectId,
        sectionId: membership.sectionId,
        position: positionBetween(membership.position, next?.position ?? null) ?? membership.position + 0.0001,
      });
    }
    const task = await tx.task.create({
      data: {
        workspaceId: source.workspaceId,
        title: `${source.title} (copie)`.slice(0, 300),
        notes: source.notes,
        priority: source.priority,
        assigneeId: source.assigneeId,
        createdById: actorIdOf(ctx),
        parentId: source.parentId,
        subtaskPosition: source.subtaskPosition + 0.5,
        dueAt: source.dueAt,
        dueTime: source.dueTime,
        startAt: source.startAt,
        isMilestone: source.isMilestone,
        isApproval: source.isApproval,
        approvalStatus: source.isApproval ? "PENDING" : null,
        recurrence: source.recurrence ?? Prisma.DbNull,
        estimatedMinutes: source.estimatedMinutes,
        contactId: source.contactId,
        organizationId: source.organizationId,
        opportunityId: source.opportunityId,
        followUpId: source.followUpId,
        tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
        customValues: {
          create: values.map((v) => ({
            fieldId: v.fieldId,
            workspaceId: v.workspaceId,
            textValue: v.textValue,
            numberValue: v.numberValue,
            dateValue: v.dateValue,
            boolValue: v.boolValue,
            optionIds: v.optionIds,
          })),
        },
        projects: { create: copies.map((c) => ({ ...c, workspaceId: source.workspaceId })) },
        followers: actorIdOf(ctx) ? { create: [{ userId: ctx.actor.id, kind: "FOLLOWER" }] } : undefined,
      },
      select: { id: true },
    });
    if (options.includeSubtasks !== false && source.subtasks.length) {
      await tx.task.createMany({
        data: source.subtasks.map((sub) => ({
          workspaceId: sub.workspaceId,
          title: sub.title,
          notes: sub.notes,
          priority: sub.priority,
          assigneeId: sub.assigneeId,
          createdById: actorIdOf(ctx),
          parentId: task.id,
          subtaskPosition: sub.subtaskPosition,
          dueAt: sub.dueAt,
          startAt: sub.startAt,
          estimatedMinutes: sub.estimatedMinutes,
        })),
      });
    }
    // Le titre de la source n'est montré qu'à qui peut la lire (`refTaskId`).
    await logActivity(ctx, [{ taskId: task.id, kind: "duplicated", newValue: source.title, refTaskId: source.id }], tx);
    return task;
  });

  await audit(ctx, "CREATE", created.id);
  await broadcast(ctx, [created.id], "task_created");
  return getTaskItem(ctx, created.id);
}

// ─── Projets d'une tâche, déplacement, ordre ──────────────────────────────────

export interface MoveResult {
  task: TaskItem;
  /** Positions renumérotées de la section, si l'écart était épuisé. */
  renumbered?: { taskId: string; position: number }[];
}

async function renumberSection(projectId: string, sectionId: string | null, tx: Prisma.TransactionClient) {
  const rows = await tx.taskProject.findMany({
    where: { projectId, sectionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { taskId: true },
  });
  const positions = evenPositions(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    await tx.taskProject.update({
      where: { taskId_projectId: { taskId: rows[i].taskId, projectId } },
      data: { position: positions[i] },
    });
  }
  return rows.map((row, i) => ({ taskId: row.taskId, position: positions[i] }));
}

/**
 * Déplace une tâche dans un projet : section cible, entre `beforeId` (au-dessus)
 * et `afterId` (en dessous). Ajoute la tâche au projet si nécessaire.
 */
export async function moveTask(
  ctx: MutationContext,
  raw: { taskId: string; projectId: string; sectionId: string | null; beforeId?: string | null; afterId?: string | null },
): Promise<MoveResult> {
  const parsed = moveTaskSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError("Déplacement invalide.");
  const input = parsed.data;
  // Contrôles rapides, refaits sous le verrou de structure.
  const { task } = await requireTaskRead(ctx, input.taskId);
  if (task.parentId) throw new TaskValidationError("Une sous-tâche suit les projets de sa tâche parente.");
  await requireProjectContentEdit(ctx, input.projectId);

  let renumbered: MoveResult["renumbered"];
  const { existing } = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    const { task } = await requireTaskRead(ctx, input.taskId, tx);
    if (task.parentId) throw new TaskValidationError("Une sous-tâche suit les projets de sa tâche parente.");
    await requireProjectContentEdit(ctx, input.projectId, tx);
    await assertSectionInProject(input.projectId, input.sectionId, tx);
    const existing = await tx.taskProject.findUnique({
      where: { taskId_projectId: { taskId: input.taskId, projectId: input.projectId } },
      select: { sectionId: true, position: true },
    });
    // Ajouter la tâche à un autre projet l'expose à ses membres : droit de gestion.
    if (!existing) await requireTaskManage(ctx, input.taskId, tx);

    const neighbour = async (id: string | null | undefined) => {
      if (!id) return null;
      const row = await tx.taskProject.findUnique({
        where: { taskId_projectId: { taskId: id, projectId: input.projectId } },
        select: { position: true, sectionId: true },
      });
      return row && row.sectionId === input.sectionId ? row.position : null;
    };

    let before = await neighbour(input.beforeId);
    let after = await neighbour(input.afterId);
    if (before === null && after === null && !input.beforeId && !input.afterId) {
      const agg = await tx.taskProject.aggregate({
        where: { projectId: input.projectId, sectionId: input.sectionId, NOT: { taskId: input.taskId } },
        _max: { position: true },
      });
      before = agg._max.position ?? null;
    }
    let position = positionBetween(before, after);
    if (position === null) {
      renumbered = await renumberSection(input.projectId, input.sectionId, tx);
      const map = new Map(renumbered.map((r) => [r.taskId, r.position]));
      before = input.beforeId ? (map.get(input.beforeId) ?? null) : null;
      after = input.afterId ? (map.get(input.afterId) ?? null) : null;
      position = positionBetween(before, after) ?? POSITION_STEP;
    }

    await tx.taskProject.upsert({
      where: { taskId_projectId: { taskId: input.taskId, projectId: input.projectId } },
      create: {
        taskId: input.taskId,
        projectId: input.projectId,
        sectionId: input.sectionId,
        position,
        workspaceId: ctx.actor.workspaceId,
      },
      update: { sectionId: input.sectionId, position },
    });
    await tx.task.update({ where: { id: input.taskId }, data: { version: { increment: 1 } } });

    if (!existing) {
      const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { name: true } });
      await logActivity(ctx, [{ taskId: input.taskId, kind: "project_added", newValue: project?.name, projectId: input.projectId }], tx);
    } else if (existing.sectionId !== input.sectionId) {
      const [from, to] = await Promise.all([
        existing.sectionId ? tx.projectSection.findUnique({ where: { id: existing.sectionId }, select: { name: true } }) : null,
        input.sectionId ? tx.projectSection.findUnique({ where: { id: input.sectionId }, select: { name: true } }) : null,
      ]);
      await logActivity(
        ctx,
        [{ taskId: input.taskId, kind: "moved", field: "Section", oldValue: from?.name ?? "Sans section", newValue: to?.name ?? "Sans section", projectId: input.projectId }],
        tx,
      );
    }
    return { existing };
  });

  await broadcast(ctx, [input.taskId], "task_moved");
  if (!existing || existing.sectionId !== input.sectionId) {
    await dispatch(ctx, [
      makeEvent(ctx, { type: "SECTION_CHANGED", taskId: input.taskId, projectId: input.projectId, sectionId: input.sectionId }),
    ]);
  }
  return { task: await getTaskItem(ctx, input.taskId), renumbered };
}

export async function addTaskToProject(
  ctx: MutationContext,
  taskId: string,
  projectId: string,
  sectionId: string | null = null,
): Promise<TaskItem> {
  return (await moveTask(ctx, { taskId, projectId, sectionId })).task;
}

/**
 * Retire une tâche d'un projet. Le retrait ne doit jamais élargir sa
 * visibilité : il est refusé s'il ne lui laisserait que des projets de la
 * corbeille (elle doit les suivre, pas devenir libre à leur purge), ou si le
 * projet retiré est son seul projet et qu'il est privé (sans projet, une
 * tâche est visible de tout l'espace).
 */
export async function removeTaskFromProject(ctx: MutationContext, taskId: string, projectId: string): Promise<TaskItem> {
  await requireTaskManage(ctx, taskId);
  await requireProjectContentEdit(ctx, projectId);
  const removed = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    await requireTaskManage(ctx, taskId, tx);
    await requireProjectContentEdit(ctx, projectId, tx);
    await checkpoint("removeTaskFromProject:checked");
    const memberships = await tx.taskProject.findMany({
      where: { taskId },
      select: { projectId: true, project: { select: { name: true, deletedAt: true, visibility: true } } },
    });
    const target = memberships.find((m) => m.projectId === projectId);
    if (!target) return false;
    const rest = memberships.filter((m) => m.projectId !== projectId);
    if (rest.length > 0 && rest.every((m) => m.project.deletedAt)) {
      throw new TaskValidationError(
        "Ses autres projets sont dans la corbeille : retirée d'ici, elle n'aurait plus de projet actif. Supprimez-la plutôt, ou restaurez d'abord l'autre projet.",
      );
    }
    if (rest.length === 0 && target.project.visibility === "PRIVATE") {
      throw new TaskValidationError(
        "C'est son seul projet, et il est privé : sans projet, la tâche serait visible de tout l'espace. Ajoutez-la d'abord à un autre projet, ou supprimez-la.",
      );
    }
    await tx.taskProject.delete({ where: { taskId_projectId: { taskId, projectId } } });
    await tx.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
    await logActivity(ctx, [{ taskId, kind: "project_removed", oldValue: target.project.name, projectId }], tx);
    return true;
  });
  if (removed) {
    await publishChange({ w: ctx.actor.workspaceId, a: actorIdOf(ctx), t: [taskId], p: [projectId], k: "task_moved" });
  }
  return getTaskItem(ctx, taskId);
}

export async function moveSubtask(
  ctx: MutationContext,
  taskId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<TaskItem> {
  const { task } = await requireTaskEdit(ctx, taskId);
  if (!task.parentId) throw new TaskValidationError("Ce n'est pas une sous-tâche.");
  const position = async (id: string | null) =>
    id
      ? ((await prisma.task.findFirst({ where: { id, parentId: task.parentId }, select: { subtaskPosition: true } }))
          ?.subtaskPosition ?? null)
      : null;
  let next = positionBetween(await position(beforeId), await position(afterId));
  if (next === null) {
    const siblings = await prisma.task.findMany({
      where: { parentId: task.parentId },
      orderBy: [{ subtaskPosition: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const positions = evenPositions(siblings.length);
    await prisma.$transaction(
      siblings.map((s, i) => prisma.task.update({ where: { id: s.id }, data: { subtaskPosition: positions[i] } })),
    );
    next = positionBetween(await position(beforeId), await position(afterId)) ?? POSITION_STEP;
  }
  await prisma.task.update({ where: { id: taskId }, data: { subtaskPosition: next, version: { increment: 1 } } });
  await broadcast(ctx, [taskId, task.parentId]);
  return getTaskItem(ctx, taskId);
}

/**
 * Devenir la sous-tâche de `parentId` remplace les projets de la tâche par
 * ceux de sa parente. Refusé si cela l'ouvrait à des personnes qui ne la
 * voient pas aujourd'hui : tâche d'un projet privé (et d'aucun projet ouvert
 * à l'espace) sous une parente qui n'est pas dans les mêmes projets. Refusé
 * aussi si elle appartient à un projet de la corbeille, qui doit la retrouver
 * à sa restauration.
 */
async function assertParentKeepsVisibility(tx: Prisma.TransactionClient, taskId: string, parentId: string) {
  const own = await tx.taskProject.findMany({
    where: { taskId },
    select: { projectId: true, project: { select: { deletedAt: true, visibility: true } } },
  });
  if (own.some((m) => m.project.deletedAt)) {
    throw new TaskValidationError("Cette tâche appartient aussi à un projet de la corbeille : elle ne peut pas devenir une sous-tâche.");
  }
  const openToWorkspace = own.length === 0 || own.some((m) => m.project.visibility === "WORKSPACE");
  if (openToWorkspace) return;
  const ownIds = new Set(own.map((m) => m.projectId));
  const parentProjects = await tx.taskProject.findMany({
    where: { taskId: parentId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  if (parentProjects.length === 0 || parentProjects.some((m) => !ownIds.has(m.projectId))) {
    throw new TaskValidationError(
      "Sous cette parente, la tâche deviendrait visible de personnes qui ne la voient pas aujourd'hui (elle est dans un projet privé que la parente ne partage pas).",
    );
  }
}

/**
 * Convertit une sous-tâche en tâche indépendante, ou l'inverse. Une
 * sous-tâche convertie garde la visibilité qu'elle tenait de sa parente :
 * elle rejoint les projets actifs de celle-ci (en fin de liste, sans section).
 */
export async function setTaskParent(ctx: MutationContext, taskId: string, parentId: string | null): Promise<TaskItem> {
  // Changer de parente change qui peut voir la tâche : droit de gestion des deux côtés.
  await requireTaskManage(ctx, taskId);
  if (parentId) {
    if (parentId === taskId) throw new TaskValidationError("Une tâche ne peut pas être sa propre parente.");
    await requireTaskManage(ctx, parentId);
  }
  const previousParent = await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    const { task } = await requireTaskManage(ctx, taskId, tx);
    if (parentId) {
      const { task: parent } = await requireTaskManage(ctx, parentId, tx);
      if (parent.parentId) throw new TaskValidationError("Une sous-tâche ne peut pas avoir de sous-tâches.");
      const children = await tx.task.count({ where: { parentId: taskId, deletedAt: null } });
      if (children) throw new TaskValidationError("Cette tâche a déjà des sous-tâches.");
      await assertParentKeepsVisibility(tx, taskId, parentId);
      await checkpoint("setTaskParent:checked");
      await tx.taskProject.deleteMany({ where: { taskId } });
      await tx.task.update({ where: { id: taskId }, data: { parentId, version: { increment: 1 } } });
    } else {
      if (!task.parentId) return null;
      const inherited = await tx.taskProject.findMany({
        where: { taskId: task.parentId, project: { deletedAt: null } },
        select: { projectId: true },
        orderBy: { projectId: "asc" },
      });
      for (const { projectId } of inherited) {
        const agg = await tx.taskProject.aggregate({ where: { projectId, sectionId: null }, _max: { position: true } });
        await tx.taskProject.create({
          data: { taskId, projectId, sectionId: null, workspaceId: ctx.actor.workspaceId, position: (agg._max.position ?? 0) + POSITION_STEP },
        });
      }
      await tx.task.update({ where: { id: taskId }, data: { parentId: null, version: { increment: 1 } } });
    }
    await logActivity(ctx, [{ taskId, kind: parentId ? "made_subtask" : "made_task" }], tx);
    return task.parentId;
  });
  await broadcast(ctx, [taskId, ...(previousParent ? [previousParent] : []), ...(parentId ? [parentId] : [])]);
  return getTaskItem(ctx, taskId);
}

// ─── Tags et champs personnalisés ─────────────────────────────────────────────

/**
 * Tags d'une tâche. Avec `base` (les tags que le client avait sous les
 * yeux), seule la **différence** voulue est appliquée à l'état courant : une
 * sauvegarde tardive n'efface pas un tag ajouté entre-temps par quelqu'un
 * d'autre (ou par une règle). Sans `base`, l'ensemble est remplacé. Dans les
 * deux cas, lecture et écriture se font sous verrou de la ligne de la tâche.
 */
export async function setTaskTags(
  ctx: MutationContext,
  taskId: string,
  tagIds: string[],
  options: { base?: string[] } = {},
): Promise<TaskItem> {
  await requireTaskEdit(ctx, taskId);
  const unique = [...new Set(tagIds)].slice(0, 30);
  const known = await prisma.tag.count({ where: { id: { in: unique }, workspaceId: ctx.actor.workspaceId } });
  if (known !== unique.length) throw new TaskValidationError("Tag introuvable.");

  const changed = await prisma.$transaction(async (tx) => {
    await lockTasks(tx, [taskId]);
    await requireTaskEdit(ctx, taskId, tx);
    const current = await tx.taskTag.findMany({ where: { taskId }, select: { tagId: true, tag: { select: { name: true } } } });
    const currentIds = new Set(current.map((c) => c.tagId));
    let target: Set<string>;
    if (options.base) {
      const base = new Set(options.base);
      target = new Set(currentIds);
      for (const id of unique) if (!base.has(id)) target.add(id);
      for (const id of base) if (!unique.includes(id)) target.delete(id);
    } else {
      target = new Set(unique);
    }
    if (target.size > 30) throw new TaskValidationError("30 tags au plus par tâche.");
    const addedIds = [...target].filter((id) => !currentIds.has(id));
    const removed = current.filter((c) => !target.has(c.tagId));
    if (!addedIds.length && !removed.length) return false;
    const added = await tx.tag.findMany({ where: { id: { in: addedIds }, workspaceId: ctx.actor.workspaceId }, select: { id: true, name: true } });
    await tx.taskTag.deleteMany({ where: { taskId, tagId: { in: removed.map((r) => r.tagId) } } });
    await tx.taskTag.createMany({ data: added.map((t) => ({ taskId, tagId: t.id })), skipDuplicates: true });
    await tx.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
    await logActivity(
      ctx,
      [
        ...added.map((t) => ({ taskId, kind: "tag_added", field: "Tag", newValue: t.name })),
        ...removed.map((r) => ({ taskId, kind: "tag_removed", field: "Tag", oldValue: r.tag.name })),
      ],
      tx,
    );
    return true;
  });
  if (changed) await broadcast(ctx, [taskId]);
  return getTaskItem(ctx, taskId);
}

async function writeCustomValue(
  ctx: MutationContext,
  taskId: string,
  fieldId: string,
  rawValue: CustomFieldValue,
  options: { log?: boolean } = {},
) {
  const field = await prisma.customField.findFirst({
    where: { id: fieldId, workspaceId: ctx.actor.workspaceId },
    select: { id: true, name: true, type: true, options: true, projectId: true },
  });
  if (!field) throw new TaskValidationError("Champ personnalisé introuvable.");
  if (field.projectId) {
    // Champ propre à un projet : la tâche doit appartenir à ce projet (ou sa
    // parente), et l'acteur doit pouvoir lire ce projet.
    const owner = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { projects: { some: { projectId: field.projectId } } },
          { parent: { projects: { some: { projectId: field.projectId } } } },
        ],
      },
      select: { id: true },
    });
    if (!owner) throw new TaskValidationError(`« ${field.name} » est propre à un autre projet.`);
    if (!ctx.trusted) {
      const project = await prisma.project.findFirst({
        where: { AND: [readableProjectWhere(ctx.actor), { id: field.projectId }] },
        select: { id: true },
      });
      if (!project) throw new TaskValidationError("Champ personnalisé introuvable.");
    }
  }
  const parsed = customValueSchema.safeParse(rawValue);
  if (!parsed.success) throw new TaskValidationError(`Valeur invalide pour « ${field.name} ».`);
  const value = parsed.data;
  const optionIds = new Set(
    (Array.isArray(field.options) ? (field.options as { id?: string }[]) : []).map((o) => o.id),
  );

  const data = { textValue: null as string | null, numberValue: null as number | null, dateValue: null as Date | null, boolValue: null as boolean | null, optionIds: [] as string[] };
  const invalid = () => new TaskValidationError(`Valeur invalide pour « ${field.name} ».`);
  if (value !== null && value !== "") {
    switch (field.type) {
      case "TEXT":
        if (typeof value !== "string") throw invalid();
        data.textValue = value.trim().slice(0, 2000);
        break;
      case "NUMBER":
        if (typeof value !== "number") throw invalid();
        data.numberValue = value;
        break;
      case "DATE":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
        data.dateValue = startOfDay(value, APP_TIME_ZONE);
        break;
      case "CHECKBOX":
        if (typeof value !== "boolean") throw invalid();
        data.boolValue = value;
        break;
      case "SINGLE_SELECT":
        if (typeof value !== "string" || !optionIds.has(value)) throw invalid();
        data.optionIds = [value];
        break;
      case "MULTI_SELECT":
        if (!Array.isArray(value) || value.some((v) => !optionIds.has(v))) throw invalid();
        data.optionIds = [...new Set(value)];
        break;
    }
  }

  const empty = data.textValue === null && data.numberValue === null && data.dateValue === null && data.boolValue === null && data.optionIds.length === 0;
  if (empty) {
    await prisma.taskCustomFieldValue.deleteMany({ where: { taskId, fieldId } });
  } else {
    await prisma.taskCustomFieldValue.upsert({
      where: { taskId_fieldId: { taskId, fieldId } },
      create: { taskId, fieldId, workspaceId: ctx.actor.workspaceId, ...data },
      update: data,
    });
  }
  if (options.log !== false) {
    const labels = (Array.isArray(field.options) ? (field.options as { id: string; label: string }[]) : []);
    const display = Array.isArray(value)
      ? value.map((v) => labels.find((o) => o.id === v)?.label ?? v).join(", ")
      : field.type === "SINGLE_SELECT"
        ? (labels.find((o) => o.id === value)?.label ?? null)
        : value === null
          ? null
          : String(value);
    // Champ propre à un projet : la ligne suit la visibilité de ce projet.
    await logActivity(ctx, [{ taskId, kind: "field", field: field.name, newValue: display, projectId: field.projectId }]);
  }
}

export async function setCustomFieldValue(
  ctx: MutationContext,
  taskId: string,
  fieldId: string,
  value: CustomFieldValue,
): Promise<TaskItem> {
  await requireTaskEdit(ctx, taskId);
  await writeCustomValue(ctx, taskId, fieldId, value);
  await prisma.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
  await broadcast(ctx, [taskId]);
  return getTaskItem(ctx, taskId);
}

// ─── Dépendances ─────────────────────────────────────────────────────────────

async function collectEdges(workspaceId: string, startId: string, db: Db = prisma) {
  // Parcours par niveaux depuis `startId` en suivant « bloque » : on ne
  // charge que la partie du graphe atteignable, pas tout l'espace.
  const edges: { blockingId: string; blockedId: string }[] = [];
  let frontier = [startId];
  const seen = new Set<string>(frontier);
  for (let depth = 0; frontier.length && depth < 200; depth += 1) {
    const rows = await db.taskDependency.findMany({
      where: { workspaceId, blockingId: { in: frontier } },
      select: { blockingId: true, blockedId: true },
    });
    edges.push(...rows);
    frontier = rows.map((r) => r.blockedId).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  return edges;
}

/**
 * `blockingId` bloque `blockedId`. Refuse les boucles et l'auto-dépendance.
 * Le contrôle de boucle et l'écriture se font sous le verrou de structure :
 * deux dépendances inverses simultanées ne peuvent pas passer toutes les deux.
 */
export async function addDependency(ctx: MutationContext, blockedId: string, blockingId: string): Promise<TaskItem> {
  if (blockedId === blockingId) throw new TaskValidationError("Une tâche ne peut pas dépendre d'elle-même.");
  await requireTaskEdit(ctx, blockedId);
  await requireTaskRead(ctx, blockingId);

  await structureTransaction(ctx.actor.workspaceId, async (tx) => {
    await requireTaskEdit(ctx, blockedId, tx);
    await requireTaskRead(ctx, blockingId, tx);
    const edges = await collectEdges(ctx.actor.workspaceId, blockedId, tx);
    if (wouldCreateCycle(edges, blockingId, blockedId)) {
      throw new TaskValidationError("Cette dépendance créerait une boucle (dépendance circulaire).");
    }
    await checkpoint("addDependency:checked");
    const blocking = await tx.task.findUnique({ where: { id: blockingId }, select: { title: true } });
    const { count } = await tx.taskDependency.createMany({
      data: [{ blockingId, blockedId, workspaceId: ctx.actor.workspaceId }],
      skipDuplicates: true,
    });
    if (!count) return;
    await tx.task.updateMany({ where: { id: { in: [blockedId, blockingId] } }, data: { version: { increment: 1 } } });
    // Le titre n'est montré qu'à qui peut lire la tâche bloquante (`refTaskId`).
    await logActivity(ctx, [{ taskId: blockedId, kind: "dependency_added", field: "Bloquée par", newValue: blocking?.title, refTaskId: blockingId }], tx);
  });
  await broadcast(ctx, [blockedId, blockingId]);
  return getTaskItem(ctx, blockedId);
}

export async function removeDependency(ctx: MutationContext, blockedId: string, blockingId: string): Promise<TaskItem> {
  await requireTaskEdit(ctx, blockedId);
  const blocking = await prisma.task.findFirst({ where: { id: blockingId, workspaceId: ctx.actor.workspaceId }, select: { title: true } });
  const { count } = await prisma.taskDependency.deleteMany({
    where: { blockingId, blockedId, workspaceId: ctx.actor.workspaceId },
  });
  if (count) {
    await prisma.task.updateMany({ where: { id: { in: [blockedId, blockingId] } }, data: { version: { increment: 1 } } });
    await logActivity(ctx, [{ taskId: blockedId, kind: "dependency_removed", field: "Bloquée par", oldValue: blocking?.title, refTaskId: blockingId }]);
    await broadcast(ctx, [blockedId, blockingId]);
  }
  return getTaskItem(ctx, blockedId);
}

// ─── Collaborateurs et abonnés ────────────────────────────────────────────────

export async function setFollower(
  ctx: MutationContext,
  taskId: string,
  userId: string,
  kind: "COLLABORATOR" | "FOLLOWER" | null,
): Promise<void> {
  const self = userId === ctx.actor.id;
  // S'abonner (ou se désabonner) soi-même demande seulement de pouvoir lire.
  // Abonner quelqu'un d'autre lui ouvre la tâche, et un collaborateur peut la
  // modifier : ces deux cas demandent le droit de gestion.
  if (self && kind !== "COLLABORATOR") await requireTaskRead(ctx, taskId);
  else await requireTaskManage(ctx, taskId);
  await assertUserInWorkspace(ctx.actor, userId);

  const label = await userLabel(userId);
  if (kind === null) {
    await prisma.taskFollower.deleteMany({ where: { taskId, userId } });
    await logActivity(ctx, [{ taskId, kind: "follower_removed", oldValue: label }]);
  } else {
    await prisma.taskFollower.upsert({
      where: { taskId_userId: { taskId, userId } },
      create: { taskId, userId, kind },
      update: { kind },
    });
    await logActivity(ctx, [
      { taskId, kind: "follower_added", field: kind === "COLLABORATOR" ? "Collaborateur" : "Abonné", newValue: label },
    ]);
    if (!self && kind === "COLLABORATOR") {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
      await notify({
        workspaceId: ctx.actor.workspaceId,
        recipients: [userId],
        actorId: actorIdOf(ctx),
        type: "ASSIGNED",
        title: `Vous collaborez à : ${task?.title ?? "une tâche"}`,
        taskId,
      });
    }
  }
  await prisma.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
  await broadcast(ctx, [taskId]);
}

// ─── Temps passé ──────────────────────────────────────────────────────────────

export async function addTimeEntry(
  ctx: MutationContext,
  taskId: string,
  raw: { minutes: number; date: string; note?: string | null },
): Promise<TaskItem> {
  await requireTaskEdit(ctx, taskId);
  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  await prisma.taskTimeEntry.create({
    data: {
      taskId,
      workspaceId: ctx.actor.workspaceId,
      userId: ctx.actor.id,
      minutes: parsed.data.minutes,
      spentAt: startOfDay(parsed.data.date, APP_TIME_ZONE),
      note: parsed.data.note ?? null,
    },
  });
  await logActivity(ctx, [{ taskId, kind: "time_logged", field: "Temps passé", newValue: `${parsed.data.minutes} min` }]);
  await prisma.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
  await broadcast(ctx, [taskId]);
  return getTaskItem(ctx, taskId);
}

export async function deleteTimeEntry(ctx: MutationContext, entryId: string): Promise<TaskItem> {
  const entry = await prisma.taskTimeEntry.findFirst({
    where: { id: entryId, workspaceId: ctx.actor.workspaceId },
    select: { taskId: true, userId: true, minutes: true },
  });
  if (!entry) throw new TaskAccessError("NOT_FOUND");
  if (entry.userId === ctx.actor.id) await requireTaskRead(ctx, entry.taskId);
  else await requireTaskEdit(ctx, entry.taskId);
  await prisma.taskTimeEntry.delete({ where: { id: entryId } });
  await logActivity(ctx, [{ taskId: entry.taskId, kind: "time_removed", field: "Temps passé", oldValue: `${entry.minutes} min` }]);
  await prisma.task.update({ where: { id: entry.taskId }, data: { version: { increment: 1 } } });
  await broadcast(ctx, [entry.taskId]);
  return getTaskItem(ctx, entry.taskId);
}

// ─── Commentaires et réactions ────────────────────────────────────────────────

export async function addComment(ctx: MutationContext, taskId: string, rawBody: string): Promise<string> {
  const { permissions } = await requireTaskRead(ctx, taskId);
  if (!permissions.canComment) throw new TaskAccessError("FORBIDDEN");
  const parsed = commentBodySchema.safeParse(rawBody);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Commentaire invalide.");
  const body = parsed.data;

  // Mentions : uniquement des utilisateurs de l'espace.
  const mentioned = extractMentions(body);
  const validMentions = mentioned.length
    ? (
        await prisma.user.findMany({
          where: { id: { in: mentioned }, workspaceId: ctx.actor.workspaceId, isActive: true },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];
  // Une mention n'ouvre jamais la tâche : seules les personnes qui la lisent
  // déjà sont abonnées et notifiées.
  const readableMentions = validMentions.length
    ? await readersAmong(ctx.actor.workspaceId, taskId, validMentions)
    : [];

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { workspaceId: ctx.actor.workspaceId, taskId, authorId: actorIdOf(ctx), body },
      select: { id: true },
    });
    const followers = [actorIdOf(ctx), ...readableMentions].filter((v): v is string => Boolean(v));
    if (followers.length) {
      await tx.taskFollower.createMany({
        data: followers.map((userId) => ({ taskId, userId, kind: "FOLLOWER" as const })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, assigneeId: true } });
  const followerIds = (await prisma.taskFollower.findMany({ where: { taskId }, select: { userId: true } })).map(
    (f) => f.userId,
  );
  const preview = toPlainText(body).slice(0, 200);

  if (readableMentions.length) {
    await notify({
      workspaceId: ctx.actor.workspaceId,
      recipients: readableMentions,
      actorId: actorIdOf(ctx),
      type: "MENTIONED",
      title: `Mention dans « ${task?.title ?? "une tâche"} »`,
      body: preview,
      taskId,
      commentId: comment.id,
    });
  }
  await notify({
    workspaceId: ctx.actor.workspaceId,
    recipients: [...followerIds, task?.assigneeId].filter((id) => id && !readableMentions.includes(id)),
    actorId: actorIdOf(ctx),
    type: "COMMENT",
    title: `Nouveau commentaire sur « ${task?.title ?? "une tâche"} »`,
    body: preview,
    taskId,
    commentId: comment.id,
  });

  await broadcast(ctx, [taskId], "comment");
  return comment.id;
}

async function requireOwnComment(ctx: MutationContext, commentId: string) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, workspaceId: ctx.actor.workspaceId },
    select: { id: true, authorId: true, taskId: true, statusUpdateId: true },
  });
  if (!comment) throw new TaskAccessError("NOT_FOUND");
  // Accès actuel d'abord (même réponse qu'un commentaire inexistant), puis
  // qualité d'auteur : être l'auteur ne suffit pas après un retrait d'accès.
  if (comment.taskId) await requireTaskRead(ctx, comment.taskId);
  if (comment.statusUpdateId) {
    const update = await prisma.projectStatusUpdate.findFirst({
      where: { id: comment.statusUpdateId, workspaceId: ctx.actor.workspaceId },
      select: { project: { select: projectAccessSelect(ctx.actor) } },
    });
    if (!update || !canReadProject(update.project)) throw new TaskAccessError("NOT_FOUND");
  }
  if (comment.authorId !== ctx.actor.id) throw new TaskAccessError("FORBIDDEN", "Seul l'auteur peut modifier ce commentaire.");
  return comment;
}

export async function editComment(ctx: MutationContext, commentId: string, rawBody: string): Promise<void> {
  const comment = await requireOwnComment(ctx, commentId);
  const parsed = commentBodySchema.safeParse(rawBody);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Commentaire invalide.");
  await prisma.comment.update({ where: { id: commentId }, data: { body: parsed.data, editedAt: new Date() } });
  if (comment.taskId) await broadcast(ctx, [comment.taskId], "comment");
}

export async function deleteComment(ctx: MutationContext, commentId: string): Promise<void> {
  const comment = await requireOwnComment(ctx, commentId);
  await prisma.comment.delete({ where: { id: commentId } });
  if (comment.taskId) await broadcast(ctx, [comment.taskId], "comment");
}

export async function toggleReaction(ctx: MutationContext, commentId: string, emoji: string): Promise<void> {
  if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) throw new TaskValidationError("Réaction invalide.");
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, workspaceId: ctx.actor.workspaceId },
    select: { taskId: true, statusUpdate: { select: { projectId: true } } },
  });
  if (!comment) throw new TaskAccessError("NOT_FOUND");
  if (comment.taskId) await requireTaskRead(ctx, comment.taskId);
  if (comment.statusUpdate) {
    const project = await prisma.project.findFirst({
      where: { id: comment.statusUpdate.projectId, workspaceId: ctx.actor.workspaceId },
      select: projectAccessSelect(ctx.actor),
    });
    if (!project || !canReadProject(project)) throw new TaskAccessError("NOT_FOUND");
  }
  const key = { commentId_userId_emoji: { commentId, userId: ctx.actor.id, emoji } };
  const existing = await prisma.commentReaction.findUnique({ where: key });
  if (existing) await prisma.commentReaction.delete({ where: key });
  else await prisma.commentReaction.create({ data: { commentId, userId: ctx.actor.id, emoji } });
  if (comment.taskId) await broadcast(ctx, [comment.taskId], "comment");
}

// ─── Actions groupées ─────────────────────────────────────────────────────────

export interface BulkResult {
  updated: TaskItem[];
  failed: { id: string; error: string }[];
}

export async function bulkUpdate(ctx: MutationContext, taskIds: string[], patch: TaskPatch): Promise<BulkResult> {
  const result: BulkResult = { updated: [], failed: [] };
  for (const id of [...new Set(taskIds)].slice(0, 500)) {
    try {
      result.updated.push(await updateTaskFields(ctx, id, patch));
    } catch (error) {
      result.failed.push({ id, error: error instanceof Error ? error.message : "Erreur." });
    }
  }
  return result;
}

export async function bulkDelete(ctx: MutationContext, taskIds: string[]): Promise<{ deleted: string[]; failed: { id: string; error: string }[] }> {
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of [...new Set(taskIds)].slice(0, 500)) {
    try {
      await deleteTask(ctx, id);
      deleted.push(id);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : "Erreur." });
    }
  }
  return { deleted, failed };
}

/** Tâches visibles : utilitaire de lecture partagé par les routes. */
export async function visibleTaskIds(actor: Actor, ids: string[]): Promise<Set<string>> {
  const rows = await prisma.task.findMany({
    where: { AND: [visibleTaskWhere(actor), { id: { in: ids } }] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
