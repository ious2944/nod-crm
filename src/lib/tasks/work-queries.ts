import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, endOfDay, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";

import {
  canEditProjectContent,
  canReadProject,
  evaluateTaskAccess,
  NOT_TEMPLATE_TASK,
  readableProjectWhere,
  taskAccessSelect,
  TaskAccessError,
  visibleTaskWhere,
  type Actor,
} from "./access";
import { ruleInputSchema, type AutomationRuleItem, type AutomationRunItem } from "./automation-model";
import { formInputSchema } from "./inputs";
import { viewConfigSchema, type TaskFilters, type ViewConfig } from "./query-engine";
import {
  hydrateTaskItems,
  loadTaskItems,
  projectSummarySelect,
  taskItemSelect,
  toFieldDef,
  toKey,
  toProjectSummary,
  toUserRef,
} from "./serialize";
import type {
  ActivityItem,
  AttachmentItem,
  CommentItem,
  CrmRef,
  NotificationItem,
  ProjectBundle,
  ProjectDetail,
  ProjectSummary,
  StatusUpdateItem,
  TaskDetail,
  TaskItem,
  TaskRef,
  WorkContext,
} from "./types";

/**
 * Lectures du module de gestion de travail.
 *
 * Toutes les fonctions prennent l'acteur **de la session** (jamais un
 * identifiant venu du client) et appliquent `visibleTaskWhere` /
 * `readableProjectWhere` dans la requête elle-même : une tâche invisible
 * n'est jamais chargée, donc jamais divulguée.
 */

export function todayKey(): string {
  return dayKey(new Date(), APP_TIME_ZONE);
}

const contactLabel = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim() || "Contact";

// ─── Contexte ─────────────────────────────────────────────────────────────────

export async function getWorkContext(actor: Actor): Promise<WorkContext> {
  const [users, tags, fields, projects, unreadCount] = await Promise.all([
    prisma.user.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { id: true, email: true, displayName: true, isActive: true },
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
    }),
    prisma.tag.findMany({ where: { workspaceId: actor.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.customField.findMany({ where: { workspaceId: actor.workspaceId }, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({
      where: readableProjectWhere(actor),
      select: projectSummarySelect(actor),
      orderBy: [{ name: "asc" }],
    }),
    prisma.notification.count({ where: { userId: actor.id, workspaceId: actor.workspaceId, readAt: null, archivedAt: null } }),
  ]);
  const refs = users.map(toUserRef);
  const me = refs.find((u) => u.id === actor.id)!;
  return {
    me,
    users: refs,
    tags,
    fields: fields.map(toFieldDef),
    projects: projects.map((p) => toProjectSummary(actor, p)),
    timeZone: APP_TIME_ZONE,
    today: todayKey(),
    unreadCount,
  };
}

// ─── Projet ───────────────────────────────────────────────────────────────────

function commentItems(
  comments: {
    id: string;
    authorId: string | null;
    body: string;
    createdAt: Date;
    editedAt: Date | null;
    reactions: { emoji: string; userId: string }[];
  }[],
): CommentItem[] {
  return comments.map((c) => {
    const byEmoji = new Map<string, string[]>();
    for (const r of c.reactions) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId]);
    return {
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      reactions: [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
    };
  });
}

const COMMENT_SELECT = {
  id: true,
  authorId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  reactions: { select: { emoji: true, userId: true } },
} satisfies Prisma.CommentSelect;

export async function getProjectDetail(actor: Actor, projectId: string): Promise<ProjectDetail> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId },
    select: {
      ...projectSummarySelect(actor),
      description: true,
      startAt: true,
      dueAt: true,
      createdAt: true,
      version: true,
      customFields: { orderBy: { position: "asc" }, select: { fieldId: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      organization: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true } },
    },
  });
  if (!project || !canReadProject(project)) throw new TaskAccessError("NOT_FOUND", "Projet introuvable.");
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    ...toProjectSummary(actor, project),
    description: project.description,
    startDate: toKey(project.startAt),
    dueDate: toKey(project.dueAt),
    members,
    customFieldIds: project.customFields.map((f) => f.fieldId),
    contact: project.contact ? { id: project.contact.id, label: contactLabel(project.contact) } : null,
    organization: project.organization ? { id: project.organization.id, label: project.organization.name } : null,
    opportunity: project.opportunity ? { id: project.opportunity.id, label: project.opportunity.name } : null,
    createdAt: project.createdAt.toISOString(),
    version: project.version,
  };
}

export async function getProjectBundle(actor: Actor, projectId: string): Promise<ProjectBundle> {
  const project = await getProjectDetail(actor, projectId);
  const [sections, topLevel, statusUpdates] = await Promise.all([
    prisma.projectSection.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, projectId: true, name: true, position: true },
    }),
    loadTaskItems(actor, { AND: [visibleTaskWhere(actor), { projects: { some: { projectId } } }] }),
    prisma.projectStatusUpdate.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        status: true,
        title: true,
        body: true,
        authorId: true,
        createdAt: true,
        comments: { orderBy: { createdAt: "asc" }, select: COMMENT_SELECT },
      },
    }),
  ]);
  const parentIds = topLevel.map((t) => t.id);
  const subtasks = parentIds.length
    ? await loadTaskItems(actor, { AND: [visibleTaskWhere(actor), { parentId: { in: parentIds } }] }, {
        orderBy: [{ subtaskPosition: "asc" }],
      })
    : [];
  const updates: StatusUpdateItem[] = statusUpdates.map((u) => ({
    id: u.id,
    status: u.status,
    title: u.title,
    body: u.body,
    authorId: u.authorId,
    createdAt: u.createdAt.toISOString(),
    comments: commentItems(u.comments),
  }));
  return { project, sections, tasks: [...topLevel, ...subtasks], statusUpdates: updates };
}

export async function listProjects(
  actor: Actor,
  scope: "active" | "archived" | "templates" | "all" = "active",
): Promise<(ProjectSummary & { taskCount: number; doneCount: number; overdueCount: number; dueDate: string | null; startDate: string | null; memberIds: string[] })[]> {
  const where: Prisma.ProjectWhereInput = {
    AND: [
      readableProjectWhere(actor),
      scope === "templates"
        ? { isTemplate: true }
        : scope === "archived"
          ? { isTemplate: false, archivedAt: { not: null } }
          : scope === "active"
            ? { isTemplate: false, archivedAt: null }
            : {},
    ],
  };
  const projects = await prisma.project.findMany({
    where,
    select: { ...projectSummarySelect(actor), dueAt: true, startAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }],
  });
  const ids = projects.map((p) => p.id);
  const today = startOfDay(todayKey(), APP_TIME_ZONE);
  const [totals, done, overdue, members] = await Promise.all([
    prisma.taskProject.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.taskProject.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, task: { status: "DONE" } }, _count: { _all: true } }),
    prisma.taskProject.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, task: { status: { not: "DONE" }, dueAt: { lt: today } } },
      _count: { _all: true },
    }),
    prisma.projectMember.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, userId: true } }),
  ]);
  const count = (rows: { projectId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.projectId, r._count._all]));
  const totalMap = count(totals);
  const doneMap = count(done);
  const overdueMap = count(overdue);
  return projects.map((p) => ({
    ...toProjectSummary(actor, p),
    taskCount: totalMap.get(p.id) ?? 0,
    doneCount: doneMap.get(p.id) ?? 0,
    overdueCount: overdueMap.get(p.id) ?? 0,
    dueDate: toKey(p.dueAt),
    startDate: toKey(p.startAt),
    memberIds: members.filter((m) => m.projectId === p.id).map((m) => m.userId),
  }));
}

// ─── Mes tâches ───────────────────────────────────────────────────────────────

export async function getMyTasks(actor: Actor, includeCompleted = false): Promise<TaskItem[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return loadTaskItems(
    actor,
    {
      AND: [
        visibleTaskWhere(actor),
        NOT_TEMPLATE_TASK,
        { assigneeId: actor.id },
        includeCompleted ? { OR: [{ status: { not: "DONE" } }, { completedAt: { gte: since } }] } : { status: { not: "DONE" } },
      ],
    },
    { orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 2000 },
  );
}

// ─── Détail d'une tâche ───────────────────────────────────────────────────────

function toRef(task: { id: string; title: string; status: TaskItem["status"]; dueAt: Date | null; startAt: Date | null; assigneeId: string | null }): TaskRef {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: toKey(task.dueAt),
    startDate: toKey(task.startAt),
    assigneeId: task.assigneeId,
  };
}

const REF_SELECT = { id: true, title: true, status: true, dueAt: true, startAt: true, assigneeId: true } as const;

export async function getTaskDetail(actor: Actor, taskId: string): Promise<TaskDetail> {
  const access = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspaceId },
    select: taskAccessSelect(actor),
  });
  if (!access) throw new TaskAccessError("NOT_FOUND");
  const permissions = evaluateTaskAccess(access, actor);
  if (!permissions.canRead) throw new TaskAccessError("NOT_FOUND");

  const record = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      ...taskItemSelect(actor),
      parent: { select: { ...REF_SELECT, ...taskItemSelect(actor).parent.select } },
      blockedBy: { select: { blockingId: true, blocking: { select: REF_SELECT } } },
      blocking: { select: { blockedId: true, blocked: { select: REF_SELECT } } },
      followers: { select: { userId: true, kind: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      organization: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true } },
      followUp: { select: { id: true, title: true } },
      recurrenceNext: { select: { id: true } },
    },
  });

  const visible = new Set(
    (
      await prisma.task.findMany({
        where: {
          AND: [
            visibleTaskWhere(actor),
            { id: { in: [...record.blockedBy.map((d) => d.blockingId), ...record.blocking.map((d) => d.blockedId)] } },
          ],
        },
        select: { id: true },
      })
    ).map((t) => t.id),
  );

  const [item] = await hydrateTaskItems(actor, [
    {
      ...record,
      followers: record.followers.filter((f) => f.userId === actor.id).map((f) => ({ kind: f.kind })),
      blockedBy: record.blockedBy.map((d) => ({ blockingId: d.blockingId, blocking: { status: d.blocking.status } })),
      blocking: record.blocking.map((d) => ({ blockedId: d.blockedId })),
    },
  ]);

  const [subtasks, comments, attachments, activity, timeEntries] = await Promise.all([
    loadTaskItems(actor, { parentId: taskId }, { orderBy: [{ subtaskPosition: "asc" }, { createdAt: "asc" }] }),
    prisma.comment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" }, select: COMMENT_SELECT, take: 500 }),
    prisma.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } }),
    prisma.taskActivity.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.taskTimeEntry.findMany({ where: { taskId }, orderBy: { spentAt: "desc" }, take: 200 }),
  ]);

  const projectIds = item.memberships.map((m) => m.projectId);
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, color: true, icon: true, sections: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
      })
    : [];

  return {
    task: item,
    description: record.notes,
    parent: record.parent ? toRef(record.parent) : null,
    subtasks,
    blockedBy: record.blockedBy.filter((d) => visible.has(d.blockingId)).map((d) => toRef(d.blocking)),
    blocking: record.blocking.filter((d) => visible.has(d.blockedId)).map((d) => toRef(d.blocked)),
    followers: record.followers,
    comments: commentItems(comments),
    attachments: attachments.map(
      (a): AttachmentItem => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        uploadedById: a.uploadedById,
        createdAt: a.createdAt.toISOString(),
        url: `/api/tasks/attachments/${a.id}`,
      }),
    ),
    activity: activity.map(
      (a): ActivityItem => ({
        id: a.id,
        actorId: a.actorId,
        automationRuleId: a.automationRuleId,
        kind: a.kind,
        field: a.field,
        oldValue: a.oldValue,
        newValue: a.newValue,
        createdAt: a.createdAt.toISOString(),
      }),
    ),
    timeEntries: timeEntries.map((t) => ({ id: t.id, userId: t.userId, minutes: t.minutes, spentDate: toKey(t.spentAt)!, note: t.note })),
    projects: item.memberships
      .map((m) => {
        const p = projects.find((x) => x.id === m.projectId);
        return p ? { id: p.id, name: p.name, color: p.color, icon: p.icon, sectionId: m.sectionId, sections: p.sections } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
    contact: record.contact ? { id: record.contact.id, label: contactLabel(record.contact) } : null,
    organization: record.organization ? { id: record.organization.id, label: record.organization.name } : null,
    opportunity: record.opportunity ? { id: record.opportunity.id, label: record.opportunity.name } : null,
    followUp: record.followUp ? { id: record.followUp.id, label: record.followUp.title } : null,
    canComment: permissions.canComment,
    recurrenceNextId: record.recurrenceNext?.id ?? null,
  };
}

/** Projet où ouvrir une tâche (lien direct) : le premier projet lisible, sinon Mes tâches. */
export async function resolveTaskLocation(actor: Actor, taskId: string): Promise<string> {
  const task = await prisma.task.findFirst({
    where: { AND: [visibleTaskWhere(actor), { id: taskId }] },
    select: { id: true, parentId: true, projects: { select: { projectId: true, project: { select: { visibility: true, members: { where: { userId: actor.id }, select: { role: true } } } } } }, parent: { select: { projects: { select: { projectId: true } } } } },
  });
  if (!task) throw new TaskAccessError("NOT_FOUND");
  const readable = task.projects.find((p) => p.project.visibility === "WORKSPACE" || p.project.members.length > 0);
  const projectId = readable?.projectId ?? task.parent?.projects[0]?.projectId;
  return projectId ? `/tasks/projects/${projectId}?view=list&task=${taskId}` : `/tasks?task=${taskId}`;
}

// ─── Recherche ────────────────────────────────────────────────────────────────

/**
 * Recherche transverse, côté serveur : titre **et description complète**,
 * filtres combinables. Les permissions sont dans la requête (`visibleTaskWhere`)
 * — une tâche d'un projet privé n'apparaît jamais à un non-membre.
 */
export async function searchTasks(actor: Actor, filters: TaskFilters, limit = 300): Promise<TaskItem[]> {
  const and: Prisma.TaskWhereInput[] = [visibleTaskWhere(actor), NOT_TEMPLATE_TASK];
  const text = filters.search?.trim();
  if (text) {
    and.push({ OR: [{ title: { contains: text, mode: "insensitive" } }, { notes: { contains: text, mode: "insensitive" } }] });
  }
  if (filters.assigneeIds?.length) {
    const ids = filters.assigneeIds.map((id) => (id === "me" ? actor.id : id));
    const real = ids.filter((id) => id !== "none");
    and.push({ OR: [...(real.length ? [{ assigneeId: { in: real } }] : []), ...(ids.includes("none") ? [{ assigneeId: null }] : [])] });
  }
  if (filters.projectIds?.length) and.push({ projects: { some: { projectId: { in: filters.projectIds } } } });
  if (filters.statuses?.length) and.push({ status: { in: filters.statuses } });
  if (filters.priorities?.length) and.push({ priority: { in: filters.priorities } });
  if (filters.tagIds?.length) and.push({ tags: { some: { tagId: { in: filters.tagIds } } } });
  const completion = filters.completion ?? "incomplete";
  if (completion === "incomplete") and.push({ status: { not: "DONE" } });
  if (completion === "completed") and.push({ status: "DONE" });
  if (filters.dueFrom) and.push({ dueAt: { gte: startOfDay(filters.dueFrom, APP_TIME_ZONE) } });
  if (filters.dueTo) and.push({ dueAt: { lte: endOfDay(filters.dueTo, APP_TIME_ZONE) } });
  if (filters.due === "no_date") and.push({ dueAt: null });
  if (filters.due === "has_date") and.push({ dueAt: { not: null } });
  if (filters.due === "overdue") and.push({ dueAt: { lt: startOfDay(todayKey(), APP_TIME_ZONE) }, status: { not: "DONE" } });
  if (filters.due === "today") and.push({ dueAt: { gte: startOfDay(todayKey(), APP_TIME_ZONE), lte: endOfDay(todayKey(), APP_TIME_ZONE) } });
  if (filters.milestonesOnly) and.push({ isMilestone: true });
  if (filters.blockedOnly) and.push({ blockedBy: { some: { blocking: { status: { not: "DONE" } } } } });

  return loadTaskItems(actor, { AND: and }, { orderBy: [{ updatedAt: "desc" }], take: limit });
}

export async function getSavedViews(actor: Actor, scope?: string) {
  const views = await prisma.savedView.findMany({
    where: { userId: actor.id, workspaceId: actor.workspaceId, ...(scope ? { scope } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return views
    .map((v) => {
      const config = viewConfigSchema.safeParse(v.config);
      return config.success ? { id: v.id, name: v.name, scope: v.scope, config: config.data as ViewConfig } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

// ─── Fiches CRM ───────────────────────────────────────────────────────────────

export type CrmKind = "contact" | "organization" | "opportunity";

export async function getLinkedWork(actor: Actor, kind: CrmKind, id: string) {
  const where: Prisma.TaskWhereInput =
    kind === "contact"
      ? { contactId: id }
      : kind === "organization"
        ? // Une organisation voit ses tâches directes et celles de ses contacts.
          { OR: [{ organizationId: id }, { contact: { organizationId: id } }, { opportunity: { organizationId: id } }] }
        : { opportunityId: id };

  const exists =
    kind === "contact"
      ? await prisma.contact.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
      : kind === "organization"
        ? await prisma.organization.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
        : await prisma.opportunity.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } });
  if (!exists) throw new TaskAccessError("NOT_FOUND");

  const since = new Date(Date.now() - 90 * 86_400_000);
  const tasks = await loadTaskItems(
    actor,
    {
      AND: [
        visibleTaskWhere(actor),
        NOT_TEMPLATE_TASK,
        where,
        { OR: [{ status: { not: "DONE" } }, { completedAt: { gte: since } }] },
      ],
    },
    { orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: 300 },
  );

  const projectWhere: Prisma.ProjectWhereInput =
    kind === "contact" ? { contactId: id } : kind === "organization" ? { organizationId: id } : { opportunityId: id };
  const projects = await prisma.project.findMany({
    where: { AND: [readableProjectWhere(actor), projectWhere, { isTemplate: false }] },
    select: projectSummarySelect(actor),
  });
  return { tasks, projects: projects.map((p) => toProjectSummary(actor, p)) };
}

export async function getCrmRef(actor: Actor, kind: CrmKind, id: string): Promise<CrmRef | null> {
  if (kind === "contact") {
    const c = await prisma.contact.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true, firstName: true, lastName: true } });
    return c ? { id: c.id, label: contactLabel(c) } : null;
  }
  if (kind === "organization") {
    const o = await prisma.organization.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true, name: true } });
    return o ? { id: o.id, label: o.name } : null;
  }
  const o = await prisma.opportunity.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true, name: true } });
  return o ? { id: o.id, label: o.name } : null;
}

/** Recherche des fiches CRM pour le rattachement d'une tâche ou d'un projet. */
export async function searchCrm(actor: Actor, kind: CrmKind, term: string): Promise<CrmRef[]> {
  const q = term.trim();
  if (kind === "contact") {
    const rows = await prisma.contact.findMany({
      where: {
        workspaceId: actor.workspaceId,
        archivedAt: null,
        ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      },
      take: 10,
      orderBy: { updatedAt: "desc" },
      select: { id: true, firstName: true, lastName: true },
    });
    return rows.map((c) => ({ id: c.id, label: contactLabel(c) }));
  }
  if (kind === "organization") {
    const rows = await prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, archivedAt: null, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
      take: 10,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    });
    return rows.map((o) => ({ id: o.id, label: o.name }));
  }
  const rows = await prisma.opportunity.findMany({
    where: { workspaceId: actor.workspaceId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    take: 10,
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  return rows.map((o) => ({ id: o.id, label: o.name }));
}

/** Recherche rapide de tâches (dépendances, sélecteur de parente). */
export async function quickFindTasks(actor: Actor, term: string, excludeId?: string): Promise<TaskRef[]> {
  const q = term.trim();
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        visibleTaskWhere(actor),
        NOT_TEMPLATE_TASK,
        q ? { title: { contains: q, mode: "insensitive" } } : {},
        excludeId ? { NOT: { id: excludeId } } : {},
      ],
    },
    take: 12,
    orderBy: { updatedAt: "desc" },
    select: REF_SELECT,
  });
  return rows.map(toRef);
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function listNotifications(actor: Actor, archived = false): Promise<NotificationItem[]> {
  const rows = await prisma.notification.findMany({
    where: { userId: actor.id, workspaceId: actor.workspaceId, archivedAt: archived ? { not: null } : null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    actorId: n.actorId,
    taskId: n.taskId,
    projectId: n.projectId,
    actionKind: n.actionKind,
    readAt: n.readAt?.toISOString() ?? null,
    archivedAt: n.archivedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function getNotificationPreferences(actor: Actor): Promise<Record<string, boolean>> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: actor.id } });
  return Object.fromEntries(rows.map((r) => [r.type, r.inApp]));
}

// ─── Personnalisation d'un projet ─────────────────────────────────────────────

export async function getProjectSettings(actor: Actor, projectId: string) {
  await getProjectDetail(actor, projectId);
  const [rules, runs, forms, templates, projectTemplates] = await Promise.all([
    prisma.automationRule.findMany({
      where: { workspaceId: actor.workspaceId, OR: [{ projectId }, { projectId: null }] },
      orderBy: { createdAt: "asc" },
    }),
    prisma.automationRun.findMany({
      where: { workspaceId: actor.workspaceId, rule: { OR: [{ projectId }, { projectId: null }] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.taskForm.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    prisma.taskTemplate.findMany({
      where: { workspaceId: actor.workspaceId, OR: [{ projectId }, { projectId: null }] },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { AND: [readableProjectWhere(actor), { isTemplate: true }] },
      select: { id: true, name: true },
    }),
  ]);
  return {
    rules: rules
      .map((rule): AutomationRuleItem | null => {
        const parsed = ruleInputSchema.safeParse({
          name: rule.name,
          trigger: rule.trigger,
          triggerConfig: rule.triggerConfig,
          conditions: rule.conditions,
          actions: rule.actions,
          isEnabled: rule.isEnabled,
        });
        if (!parsed.success) return null;
        return {
          ...parsed.data,
          id: rule.id,
          projectId: rule.projectId,
          runCount: rule.runCount,
          lastRunAt: rule.lastRunAt?.toISOString() ?? null,
          createdById: rule.createdById,
        };
      })
      .filter((r): r is AutomationRuleItem => r !== null),
    runs: runs.map(
      (r): AutomationRunItem => ({ id: r.id, ruleId: r.ruleId, taskId: r.taskId, status: r.status, message: r.message, createdAt: r.createdAt.toISOString() }),
    ),
    forms: forms.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      sectionId: f.sectionId,
      isActive: f.isActive,
      submissions: f.submissions,
      fields: formInputSchema.shape.fields.parse(f.fields ?? {}),
    })),
    templates: templates.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      title: t.title,
      description: t.description,
      priority: t.priority,
      estimatedMinutes: t.estimatedMinutes,
      isApproval: t.isApproval,
      subtasks: Array.isArray(t.subtasks) ? (t.subtasks as string[]) : [],
      tagIds: t.tagIds,
    })),
    projectTemplates,
  };
}

export type ProjectSettings = Awaited<ReturnType<typeof getProjectSettings>>;

export async function getForm(actor: Actor, formId: string) {
  const form = await prisma.taskForm.findFirst({
    where: { id: formId, workspaceId: actor.workspaceId },
    include: { project: { select: { ...projectSummarySelect(actor) } } },
  });
  if (!form || !canReadProject(form.project)) throw new TaskAccessError("NOT_FOUND", "Formulaire introuvable.");
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    isActive: form.isActive && !form.project.archivedAt,
    project: toProjectSummary(actor, form.project),
    fields: formInputSchema.shape.fields.parse(form.fields ?? {}),
  };
}

export async function listForms(actor: Actor) {
  const forms = await prisma.taskForm.findMany({
    where: { workspaceId: actor.workspaceId, isActive: true, project: { AND: [readableProjectWhere(actor), { archivedAt: null }] } },
    select: { id: true, name: true, description: true, project: { select: { id: true, name: true, color: true, icon: true } } },
    orderBy: { name: "asc" },
  });
  return forms;
}

// ─── Synthèse multi-projets et charge ─────────────────────────────────────────

export async function getWorkload(actor: Actor, fromKey: string, weeks: number) {
  const from = startOfDay(fromKey, APP_TIME_ZONE);
  const toKeyStr = new Date(Date.parse(`${fromKey}T00:00:00Z`) + (weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
  const tasks = await loadTaskItems(
    actor,
    {
      AND: [
        visibleTaskWhere(actor),
        NOT_TEMPLATE_TASK,
        { status: { not: "DONE" }, assigneeId: { not: null } },
        { OR: [{ dueAt: { gte: from, lte: endOfDay(toKeyStr, APP_TIME_ZONE) } }, { dueAt: { lt: from } }] },
      ],
    },
    { take: 5000 },
  );
  return { tasks, from: fromKey, to: toKeyStr };
}

export function editableProjectIds(projects: ProjectSummary[]): string[] {
  return projects.filter((p) => p.canEdit && !p.isTemplate && !p.archived).map((p) => p.id);
}

export { canEditProjectContent };
