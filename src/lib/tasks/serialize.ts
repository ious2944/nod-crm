import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";

import {
  canEditProjectContent,
  canManageProject,
  evaluateTaskAccess,
  projectAccessSelect,
  projectRole,
  type Actor,
  type ProjectAccessInfo,
} from "./access";
import { recurrenceSchema } from "./recurrence";
import { toPlainText } from "./rich-text";
import type {
  CustomFieldDef,
  CustomFieldOption,
  CustomFieldValue,
  ProjectSummary,
  RecurrenceRule,
  TaskItem,
  UserRef,
} from "./types";

/**
 * Conversion des lignes Prisma en objets de transfert (`TaskItem`…).
 *
 * Ce qui part au navigateur est explicitement choisi ici : jamais une ligne
 * brute. Les dates calendaires sont converties en clés `YYYY-MM-DD` dans le
 * fuseau de l'application.
 */

export const toKey = (date: Date | null | undefined): string | null =>
  date ? dayKey(date, APP_TIME_ZONE) : null;

export function initialsOf(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export function toUserRef(user: {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
}): UserRef {
  const name = user.displayName?.trim() || user.email.split("@")[0];
  return { id: user.id, name, email: user.email, initials: initialsOf(name), isActive: user.isActive };
}

export function parseOptions(value: unknown): CustomFieldOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o): o is { id: string; label: string; color?: string } =>
      Boolean(o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string"),
    )
    .map((o) => ({ id: o.id, label: String(o.label ?? ""), color: String(o.color ?? "slate") }));
}

export function toFieldDef(field: {
  id: string;
  name: string;
  type: CustomFieldDef["type"];
  options: unknown;
}): CustomFieldDef {
  return { id: field.id, name: field.name, type: field.type, options: parseOptions(field.options) };
}

export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (!value) return null;
  const parsed = recurrenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function taskItemSelect(actor: Actor) {
  const access = {
    assigneeId: true,
    createdById: true,
    followers: { where: { userId: actor.id }, select: { kind: true } },
    projects: { select: { project: { select: projectAccessSelect(actor) } } },
  } satisfies Prisma.TaskSelect;

  return {
    id: true,
    title: true,
    notes: true,
    status: true,
    priority: true,
    assigneeId: true,
    createdById: true,
    dueAt: true,
    dueTime: true,
    startAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    parentId: true,
    subtaskPosition: true,
    isMilestone: true,
    isApproval: true,
    approvalStatus: true,
    estimatedMinutes: true,
    recurrence: true,
    contactId: true,
    organizationId: true,
    opportunityId: true,
    followUpId: true,
    version: true,
    tags: { select: { tagId: true } },
    customValues: {
      select: {
        fieldId: true,
        textValue: true,
        numberValue: true,
        dateValue: true,
        boolValue: true,
        optionIds: true,
        field: { select: { type: true } },
      },
    },
    followers: { where: { userId: actor.id }, select: { kind: true } },
    projects: {
      select: {
        projectId: true,
        sectionId: true,
        position: true,
        project: { select: projectAccessSelect(actor) },
      },
    },
    parent: { select: access },
    blockedBy: { select: { blockingId: true, blocking: { select: { status: true } } } },
    blocking: { select: { blockedId: true } },
    _count: { select: { subtasks: true, comments: true, attachments: true } },
  } satisfies Prisma.TaskSelect;
}

export type TaskItemRecord = Prisma.TaskGetPayload<{ select: ReturnType<typeof taskItemSelect> }>;

function customValueOf(value: TaskItemRecord["customValues"][number]): CustomFieldValue {
  switch (value.field.type) {
    case "TEXT":
      return value.textValue;
    case "NUMBER":
      return value.numberValue;
    case "DATE":
      return toKey(value.dateValue);
    case "CHECKBOX":
      return value.boolValue ?? false;
    case "SINGLE_SELECT":
      return value.optionIds[0] ?? null;
    case "MULTI_SELECT":
      return value.optionIds;
  }
}

/**
 * Charge des `TaskItem` complets. Les agrégats (sous-tâches terminées, temps
 * passé) sont calculés en deux requêtes groupées pour toute la liste, jamais
 * tâche par tâche.
 */
export async function loadTaskItems(
  actor: Actor,
  where: Prisma.TaskWhereInput,
  options: { orderBy?: Prisma.TaskOrderByWithRelationInput[]; take?: number } = {},
): Promise<TaskItem[]> {
  const records = await prisma.task.findMany({
    where: { AND: [{ workspaceId: actor.workspaceId }, where] },
    select: taskItemSelect(actor),
    orderBy: options.orderBy ?? [{ createdAt: "asc" }],
    take: options.take,
  });
  return hydrateTaskItems(actor, records);
}

export async function hydrateTaskItems(actor: Actor, records: TaskItemRecord[]): Promise<TaskItem[]> {
  if (records.length === 0) return [];
  const ids = records.map((r) => r.id);

  const [doneCounts, spent] = await Promise.all([
    prisma.task.groupBy({
      by: ["parentId"],
      where: { workspaceId: actor.workspaceId, parentId: { in: ids }, status: "DONE" },
      _count: { _all: true },
    }),
    prisma.taskTimeEntry.groupBy({
      by: ["taskId"],
      where: { workspaceId: actor.workspaceId, taskId: { in: ids } },
      _sum: { minutes: true },
    }),
  ]);

  const doneMap = new Map(doneCounts.map((row) => [row.parentId, row._count._all]));
  const spentMap = new Map(spent.map((row) => [row.taskId, row._sum.minutes ?? 0]));

  return records.map((record) => toTaskItem(actor, record, doneMap.get(record.id) ?? 0, spentMap.get(record.id) ?? 0));
}

export function toTaskItem(
  actor: Actor,
  record: TaskItemRecord,
  subtaskDoneCount: number,
  spentMinutes: number,
): TaskItem {
  const access = evaluateTaskAccess(
    {
      parentId: record.parentId,
      assigneeId: record.assigneeId,
      createdById: record.createdById,
      followers: record.followers,
      projects: record.projects.map((p) => ({ project: p.project })),
      parent: record.parent,
    },
    actor,
  );

  const custom: Record<string, CustomFieldValue> = {};
  for (const value of record.customValues) custom[value.fieldId] = customValueOf(value);

  const plain = toPlainText(record.notes);

  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    assigneeId: record.assigneeId,
    createdById: record.createdById,
    dueDate: toKey(record.dueAt),
    dueTime: record.dueTime,
    startDate: toKey(record.startAt),
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    parentId: record.parentId,
    subtaskPosition: record.subtaskPosition,
    isMilestone: record.isMilestone,
    isApproval: record.isApproval,
    approvalStatus: record.approvalStatus,
    estimatedMinutes: record.estimatedMinutes,
    spentMinutes,
    tagIds: record.tags.map((t) => t.tagId),
    custom,
    // Les appartenances à des projets illisibles par l'acteur ne sont pas
    // divulguées : on ne montre que ce qu'il pourrait ouvrir.
    memberships: record.projects
      .filter((p) => p.project.visibility === "WORKSPACE" || p.project.members.length > 0)
      .map((p) => ({ projectId: p.projectId, sectionId: p.sectionId, position: p.position })),
    subtaskCount: record._count.subtasks,
    subtaskDoneCount,
    commentCount: record._count.comments,
    attachmentCount: record._count.attachments,
    blockedByIds: record.blockedBy.map((d) => d.blockingId),
    blockingIds: record.blocking.map((d) => d.blockedId),
    openBlockerCount: record.blockedBy.filter((d) => d.blocking.status !== "DONE").length,
    recurrence: parseRecurrence(record.recurrence),
    hasDescription: Boolean(record.notes?.trim()),
    excerpt: plain.slice(0, 300),
    contactId: record.contactId,
    organizationId: record.organizationId,
    opportunityId: record.opportunityId,
    followUpId: record.followUpId,
    version: record.version,
    canEdit: access.canEdit,
  };
}

export function toProjectSummary(
  actor: Actor,
  project: ProjectAccessInfo & {
    name: string;
    color: string;
    icon: string;
    status: ProjectSummary["status"];
    favorites?: { userId: string }[];
  },
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    icon: project.icon,
    status: project.status,
    visibility: project.visibility,
    archived: project.archivedAt !== null,
    isTemplate: project.isTemplate,
    isFavorite: (project.favorites ?? []).length > 0,
    ownerId: project.ownerId,
    role: projectRole(project),
    canEdit: canEditProjectContent(project, actor),
    canManage: canManageProject(project, actor),
  };
}

export function projectSummarySelect(actor: Actor) {
  return {
    ...projectAccessSelect(actor),
    name: true,
    color: true,
    icon: true,
    status: true,
    favorites: { where: { userId: actor.id }, select: { userId: true } },
  } satisfies Prisma.ProjectSelect;
}
