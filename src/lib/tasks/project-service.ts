import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ENTITY_TYPES } from "@/lib/audit/types";
import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";

import {
  canEditProjectContent,
  canManageProject,
  canReadProject,
  projectAccessSelect,
  TaskAccessError,
  TaskValidationError,
  type Actor,
} from "./access";
import { DEFAULT_SECTIONS, PROJECT_STATUS_LABELS } from "./constants";
import { evenPositions, keyDiff, positionBetween, POSITION_STEP } from "./graph";
import {
  commentBodySchema,
  projectInputSchema,
  projectPatchSchema,
  sectionNameSchema,
  statusUpdateSchema,
} from "./inputs";
import { notify } from "./notify";
import { publishChange } from "./realtime";
import { assertCrmLinks } from "./service";
import type { ProjectRole } from "./types";

/**
 * Projets, sections, membres, favoris, points d'avancement, modèles.
 *
 * Règle d'or : un projet `PRIVATE` est **introuvable** pour un non-membre —
 * même message qu'un identifiant inexistant, pour ne rien révéler.
 */

async function loadProject(actor: Actor, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId },
    select: { ...projectAccessSelect(actor), name: true, version: true },
  });
  if (!project || !canReadProject(project)) throw new TaskAccessError("NOT_FOUND", "Projet introuvable.");
  return project;
}

export async function requireProjectRead(actor: Actor, projectId: string) {
  return loadProject(actor, projectId);
}

export async function requireProjectEdit(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  if (!canEditProjectContent(project, actor)) {
    throw new TaskAccessError("FORBIDDEN", project.archivedAt ? "Ce projet est archivé." : "Vous ne pouvez pas modifier ce projet.");
  }
  return project;
}

export async function requireProjectManage(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  if (!canManageProject(project, actor)) {
    throw new TaskAccessError("FORBIDDEN", "Seul le propriétaire du projet peut faire cela.");
  }
  return project;
}

const toDate = (key: string | null | undefined) => (key ? startOfDay(key, APP_TIME_ZONE) : null);

function changed(actor: Actor, projectIds: string[], kind = "project") {
  return publishChange({ w: actor.workspaceId, a: actor.id, p: projectIds, k: kind });
}

async function auditProject(actor: Actor, action: "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE" | "DELETE", id: string) {
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action, entityType: AUDIT_ENTITY_TYPES.PROJECT, entityId: id });
}

async function validMemberIds(actor: Actor, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, workspaceId: actor.workspaceId, isActive: true },
    select: { id: true },
  });
  if (users.length !== unique.length) throw new TaskValidationError("Un des membres n'existe pas dans votre espace.");
  return unique;
}

// ─── Création, copie depuis un modèle ─────────────────────────────────────────

/**
 * Copie le contenu d'un projet (sections, tâches, sous-tâches, tags, champs,
 * règles, modèles de tâches) dans un autre. Les échéances sont décalées pour
 * conserver les écarts relatifs à la date de début des deux projets.
 */
async function copyProjectContent(
  tx: Prisma.TransactionClient,
  actor: Actor,
  sourceId: string,
  targetId: string,
  options: { shiftDays: number; keepAssignees: boolean; includeCompleted: boolean },
) {
  const shift = (date: Date | null) => {
    if (!date) return null;
    if (!options.shiftDays) return date;
    const key = dayKey(date, APP_TIME_ZONE);
    const moved = new Date(Date.parse(`${key}T00:00:00Z`) + options.shiftDays * 86_400_000).toISOString().slice(0, 10);
    return startOfDay(moved, APP_TIME_ZONE);
  };

  const sections = await tx.projectSection.findMany({ where: { projectId: sourceId }, orderBy: { position: "asc" } });
  const sectionMap = new Map<string, string>();
  for (const section of sections) {
    const created = await tx.projectSection.create({
      data: { projectId: targetId, workspaceId: actor.workspaceId, name: section.name, position: section.position },
      select: { id: true },
    });
    sectionMap.set(section.id, created.id);
  }

  const memberships = await tx.taskProject.findMany({
    where: { projectId: sourceId, ...(options.includeCompleted ? {} : { task: { status: { not: "DONE" } } }) },
    include: {
      task: {
        include: {
          tags: true,
          customValues: true,
          subtasks: { orderBy: { subtaskPosition: "asc" } },
        },
      },
    },
    orderBy: { position: "asc" },
  });

  const taskMap = new Map<string, string>();
  for (const membership of memberships) {
    const source = membership.task;
    const created = await tx.task.create({
      data: {
        workspaceId: actor.workspaceId,
        title: source.title,
        notes: source.notes,
        priority: source.priority,
        status: options.includeCompleted ? source.status : "TODO",
        completedAt: options.includeCompleted ? source.completedAt : null,
        assigneeId: options.keepAssignees ? source.assigneeId : null,
        createdById: actor.id,
        dueAt: shift(source.dueAt),
        dueTime: source.dueTime,
        startAt: shift(source.startAt),
        isMilestone: source.isMilestone,
        isApproval: source.isApproval,
        approvalStatus: source.isApproval ? "PENDING" : null,
        recurrence: source.recurrence ?? Prisma.DbNull,
        estimatedMinutes: source.estimatedMinutes,
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
          create: {
            projectId: targetId,
            workspaceId: actor.workspaceId,
            sectionId: membership.sectionId ? (sectionMap.get(membership.sectionId) ?? null) : null,
            position: membership.position,
          },
        },
      },
      select: { id: true },
    });
    taskMap.set(source.id, created.id);
    if (source.subtasks.length) {
      await tx.task.createMany({
        data: source.subtasks.map((sub) => ({
          workspaceId: actor.workspaceId,
          title: sub.title,
          notes: sub.notes,
          priority: sub.priority,
          assigneeId: options.keepAssignees ? sub.assigneeId : null,
          createdById: actor.id,
          parentId: created.id,
          subtaskPosition: sub.subtaskPosition,
          dueAt: shift(sub.dueAt),
          startAt: shift(sub.startAt),
          estimatedMinutes: sub.estimatedMinutes,
        })),
      });
    }
  }

  // Dépendances internes au projet copié.
  const deps = await tx.taskDependency.findMany({
    where: { blockingId: { in: [...taskMap.keys()] }, blockedId: { in: [...taskMap.keys()] } },
  });
  if (deps.length) {
    await tx.taskDependency.createMany({
      data: deps.map((d) => ({
        blockingId: taskMap.get(d.blockingId)!,
        blockedId: taskMap.get(d.blockedId)!,
        workspaceId: actor.workspaceId,
      })),
      skipDuplicates: true,
    });
  }

  const fields = await tx.projectCustomField.findMany({ where: { projectId: sourceId } });
  if (fields.length) {
    await tx.projectCustomField.createMany({
      data: fields.map((f) => ({ projectId: targetId, fieldId: f.fieldId, position: f.position })),
    });
  }

  const remapIds = (value: Prisma.JsonValue): Prisma.InputJsonValue => {
    const text = JSON.stringify(value ?? null);
    let out = text;
    for (const [from, to] of sectionMap) out = out.split(from).join(to);
    return JSON.parse(out) as Prisma.InputJsonValue;
  };
  const rules = await tx.automationRule.findMany({ where: { projectId: sourceId } });
  for (const rule of rules) {
    await tx.automationRule.create({
      data: {
        workspaceId: actor.workspaceId,
        projectId: targetId,
        name: rule.name,
        isEnabled: rule.isEnabled,
        trigger: rule.trigger,
        triggerConfig: remapIds(rule.triggerConfig),
        conditions: remapIds(rule.conditions),
        actions: remapIds(rule.actions),
        createdById: actor.id,
      },
    });
  }

  const templates = await tx.taskTemplate.findMany({ where: { projectId: sourceId } });
  for (const template of templates) {
    await tx.taskTemplate.create({
      data: {
        workspaceId: actor.workspaceId,
        projectId: targetId,
        name: template.name,
        title: template.title,
        description: template.description,
        priority: template.priority,
        estimatedMinutes: template.estimatedMinutes,
        isApproval: template.isApproval,
        subtasks: template.subtasks ?? [],
        tagIds: template.tagIds,
        createdById: actor.id,
      },
    });
  }
}

export async function createProject(actor: Actor, raw: unknown): Promise<string> {
  const parsed = projectInputSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Projet invalide.");
  const input = parsed.data;
  if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
    throw new TaskValidationError("La date de début doit précéder l'échéance.");
  }
  const ownerId = input.ownerId ?? actor.id;
  const members = await validMemberIds(actor, [ownerId, actor.id, ...(input.memberIds ?? [])]);
  await assertCrmLinks(actor, input);

  let template: { id: string; startAt: Date | null; color: string; icon: string; description: string | null } | null = null;
  if (input.templateId) {
    const source = await prisma.project.findFirst({
      where: { id: input.templateId, workspaceId: actor.workspaceId },
      select: { ...projectAccessSelect(actor), startAt: true, color: true, icon: true, description: true },
    });
    if (!source || !canReadProject(source)) throw new TaskValidationError("Modèle introuvable.");
    template = source;
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        workspaceId: actor.workspaceId,
        name: input.name,
        description: input.description ?? template?.description ?? null,
        color: input.color ?? template?.color ?? "indigo",
        icon: input.icon ?? template?.icon ?? "folder",
        ownerId,
        createdById: actor.id,
        startAt: toDate(input.startDate),
        dueAt: toDate(input.dueDate),
        visibility: input.visibility ?? "WORKSPACE",
        status: input.status ?? "ON_TRACK",
        contactId: input.contactId ?? null,
        organizationId: input.organizationId ?? null,
        opportunityId: input.opportunityId ?? null,
        members: {
          create: members.map((userId) => ({
            userId,
            workspaceId: actor.workspaceId,
            role: (userId === ownerId ? "OWNER" : "EDITOR") as ProjectRole,
          })),
        },
      },
      select: { id: true },
    });

    if (template) {
      const today = dayKey(new Date(), APP_TIME_ZONE);
      const targetStart = input.startDate ?? today;
      const sourceStart = template.startAt ? dayKey(template.startAt, APP_TIME_ZONE) : null;
      await copyProjectContent(tx, actor, template.id, created.id, {
        shiftDays: sourceStart ? keyDiff(sourceStart, targetStart) : 0,
        keepAssignees: false,
        includeCompleted: false,
      });
    } else {
      const positions = evenPositions(DEFAULT_SECTIONS.length);
      await tx.projectSection.createMany({
        data: DEFAULT_SECTIONS.map((name, i) => ({
          projectId: created.id,
          workspaceId: actor.workspaceId,
          name,
          position: positions[i],
        })),
      });
    }
    return created;
  });

  await auditProject(actor, "CREATE", project.id);
  await notify({
    workspaceId: actor.workspaceId,
    recipients: members,
    actorId: actor.id,
    type: "PROJECT_MEMBER",
    title: `Vous avez été ajouté au projet « ${input.name} »`,
    projectId: project.id,
  });
  await changed(actor, [project.id]);
  return project.id;
}

export async function updateProject(actor: Actor, projectId: string, raw: unknown, baseVersion?: number): Promise<void> {
  const project = await requireProjectManage(actor, projectId);
  const parsed = projectPatchSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Modification invalide.");
  const input = parsed.data;
  if (input.ownerId) await validMemberIds(actor, [input.ownerId]);
  await assertCrmLinks(actor, input);
  if (baseVersion !== undefined && baseVersion !== project.version) {
    throw new TaskValidationError("Ce projet a été modifié entre-temps. Rechargez la page.");
  }

  const data: Prisma.ProjectUpdateManyMutationInput & { ownerId?: string | null } = { version: { increment: 1 } };
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.color !== undefined) data.color = input.color;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.status !== undefined) data.status = input.status;
  if (input.startDate !== undefined) data.startAt = toDate(input.startDate);
  if (input.dueDate !== undefined) data.dueAt = toDate(input.dueDate);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.project.updateMany({
      where: { id: projectId, workspaceId: actor.workspaceId, version: project.version },
      data,
    });
    if (count !== 1) throw new TaskValidationError("Ce projet a été modifié entre-temps. Rechargez la page.");
    const links: Prisma.ProjectUncheckedUpdateInput = {};
    if (input.ownerId !== undefined) links.ownerId = input.ownerId;
    if (input.contactId !== undefined) links.contactId = input.contactId;
    if (input.organizationId !== undefined) links.organizationId = input.organizationId;
    if (input.opportunityId !== undefined) links.opportunityId = input.opportunityId;
    if (Object.keys(links).length) await tx.project.update({ where: { id: projectId }, data: links });
    if (input.ownerId) {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: input.ownerId } },
        create: { projectId, userId: input.ownerId, workspaceId: actor.workspaceId, role: "OWNER" },
        update: { role: "OWNER" },
      });
    }
  });
  await auditProject(actor, "UPDATE", projectId);
  await changed(actor, [projectId]);
}

export async function duplicateProject(
  actor: Actor,
  projectId: string,
  options: { name?: string; asTemplate?: boolean; includeTasks?: boolean } = {},
): Promise<string> {
  const source = await requireProjectRead(actor, projectId);
  const full = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const name = (options.name?.trim() || `${source.name} (copie)`).slice(0, 120);

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        workspaceId: actor.workspaceId,
        name,
        description: full.description,
        color: full.color,
        icon: full.icon,
        ownerId: actor.id,
        createdById: actor.id,
        startAt: full.startAt,
        dueAt: full.dueAt,
        visibility: full.visibility,
        isTemplate: options.asTemplate ?? false,
        contactId: full.contactId,
        organizationId: full.organizationId,
        opportunityId: full.opportunityId,
        members: { create: [{ userId: actor.id, workspaceId: actor.workspaceId, role: "OWNER" }] },
      },
      select: { id: true },
    });
    if (options.includeTasks !== false) {
      await copyProjectContent(tx, actor, projectId, created.id, {
        shiftDays: 0,
        keepAssignees: !options.asTemplate,
        includeCompleted: false,
      });
    } else {
      const sections = await tx.projectSection.findMany({ where: { projectId } });
      await tx.projectSection.createMany({
        data: sections.map((s) => ({ projectId: created.id, workspaceId: actor.workspaceId, name: s.name, position: s.position })),
      });
    }
    return created.id;
  });

  await auditProject(actor, "CREATE", id);
  await changed(actor, [id]);
  return id;
}

export async function setProjectArchived(actor: Actor, projectId: string, archived: boolean): Promise<void> {
  await requireProjectManage(actor, projectId);
  await prisma.project.updateMany({
    where: { id: projectId, workspaceId: actor.workspaceId },
    data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
  });
  await auditProject(actor, archived ? "ARCHIVE" : "RESTORE", projectId);
  await changed(actor, [projectId]);
}

/**
 * Supprime un projet. Les tâches qui n'appartiennent qu'à lui sont supprimées
 * avec lui ; celles qui appartiennent aussi à d'autres projets sont conservées
 * (elles perdent seulement cette appartenance).
 */
export async function deleteProject(actor: Actor, projectId: string): Promise<{ deletedTasks: number; keptTasks: number }> {
  await requireProjectManage(actor, projectId);
  const memberships = await prisma.taskProject.findMany({
    where: { projectId },
    select: { taskId: true, task: { select: { _count: { select: { projects: true } } } } },
  });
  const exclusive = memberships.filter((m) => m.task._count.projects === 1).map((m) => m.taskId);
  const attachments = await prisma.taskAttachment.findMany({
    where: { OR: [{ taskId: { in: exclusive } }, { task: { parentId: { in: exclusive } } }] },
    select: { storageKey: true },
  });

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { id: { in: exclusive }, workspaceId: actor.workspaceId } }),
    prisma.project.deleteMany({ where: { id: projectId, workspaceId: actor.workspaceId } }),
  ]);
  for (const { storageKey } of attachments) await objectStore.remove(storageKey).catch(() => {});
  await auditProject(actor, "DELETE", projectId);
  await changed(actor, [projectId], "project_deleted");
  return { deletedTasks: exclusive.length, keptTasks: memberships.length - exclusive.length };
}

// ─── Membres et favoris ───────────────────────────────────────────────────────

export async function setProjectMember(actor: Actor, projectId: string, userId: string, role: ProjectRole | null): Promise<void> {
  const project = await requireProjectManage(actor, projectId);
  await validMemberIds(actor, [userId]);
  if (role === null) {
    if (project.ownerId === userId) throw new TaskValidationError("Le responsable du projet ne peut pas être retiré.");
    await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  } else {
    const existing = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, workspaceId: actor.workspaceId, role },
      update: { role },
    });
    if (!existing) {
      await notify({
        workspaceId: actor.workspaceId,
        recipients: [userId],
        actorId: actor.id,
        type: "PROJECT_MEMBER",
        title: `Vous avez été ajouté au projet « ${project.name} »`,
        projectId,
      });
    }
  }
  await prisma.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
  await changed(actor, [projectId]);
}

export async function setFavorite(actor: Actor, projectId: string, favorite: boolean): Promise<void> {
  await requireProjectRead(actor, projectId);
  if (favorite) {
    await prisma.projectFavorite.upsert({
      where: { userId_projectId: { userId: actor.id, projectId } },
      create: { userId: actor.id, projectId },
      update: {},
    });
  } else {
    await prisma.projectFavorite.deleteMany({ where: { userId: actor.id, projectId } });
  }
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function createSection(
  actor: Actor,
  projectId: string,
  rawName: string,
  afterSectionId?: string | null,
): Promise<{ id: string; position: number }> {
  await requireProjectEdit(actor, projectId);
  const name = sectionNameSchema.safeParse(rawName);
  if (!name.success) throw new TaskValidationError(name.error.issues[0]?.message ?? "Nom invalide.");

  let position: number;
  if (afterSectionId) {
    const anchor = await prisma.projectSection.findFirst({ where: { id: afterSectionId, projectId }, select: { position: true } });
    const next = anchor
      ? await prisma.projectSection.findFirst({
          where: { projectId, position: { gt: anchor.position } },
          orderBy: { position: "asc" },
          select: { position: true },
        })
      : null;
    position = anchor ? (positionBetween(anchor.position, next?.position ?? null) ?? anchor.position + 0.001) : POSITION_STEP;
  } else {
    const agg = await prisma.projectSection.aggregate({ where: { projectId }, _max: { position: true } });
    position = (agg._max.position ?? 0) + POSITION_STEP;
  }
  const section = await prisma.projectSection.create({
    data: { projectId, workspaceId: actor.workspaceId, name: name.data, position },
    select: { id: true, position: true },
  });
  await changed(actor, [projectId], "section");
  return section;
}

async function requireSection(actor: Actor, sectionId: string) {
  const section = await prisma.projectSection.findFirst({
    where: { id: sectionId, workspaceId: actor.workspaceId },
    select: { id: true, projectId: true, position: true },
  });
  if (!section) throw new TaskAccessError("NOT_FOUND", "Section introuvable.");
  await requireProjectEdit(actor, section.projectId);
  return section;
}

export async function renameSection(actor: Actor, sectionId: string, rawName: string): Promise<void> {
  const section = await requireSection(actor, sectionId);
  const name = sectionNameSchema.safeParse(rawName);
  if (!name.success) throw new TaskValidationError(name.error.issues[0]?.message ?? "Nom invalide.");
  await prisma.projectSection.update({ where: { id: sectionId }, data: { name: name.data } });
  await changed(actor, [section.projectId], "section");
}

export async function moveSection(
  actor: Actor,
  sectionId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<{ id: string; position: number }[]> {
  const section = await requireSection(actor, sectionId);
  const position = async (id: string | null) =>
    id
      ? ((await prisma.projectSection.findFirst({ where: { id, projectId: section.projectId }, select: { position: true } }))
          ?.position ?? null)
      : null;
  let next = positionBetween(await position(beforeId), await position(afterId));
  if (next === null) {
    const all = await prisma.projectSection.findMany({ where: { projectId: section.projectId }, orderBy: { position: "asc" } });
    const positions = evenPositions(all.length);
    await prisma.$transaction(all.map((s, i) => prisma.projectSection.update({ where: { id: s.id }, data: { position: positions[i] } })));
    next = positionBetween(await position(beforeId), await position(afterId)) ?? POSITION_STEP;
  }
  await prisma.projectSection.update({ where: { id: sectionId }, data: { position: next } });
  await changed(actor, [section.projectId], "section");
  const sections = await prisma.projectSection.findMany({
    where: { projectId: section.projectId },
    select: { id: true, position: true },
  });
  return sections;
}

/**
 * Supprime une section. `mode = "keep"` : ses tâches passent dans
 * `targetSectionId` (ou « Sans section ») ; `mode = "delete"` : les tâches qui
 * n'appartiennent qu'à ce projet sont supprimées, les autres retirées du projet.
 */
export async function deleteSection(
  actor: Actor,
  sectionId: string,
  mode: "keep" | "delete",
  targetSectionId: string | null = null,
): Promise<void> {
  const section = await requireSection(actor, sectionId);
  if (targetSectionId) {
    const target = await prisma.projectSection.findFirst({ where: { id: targetSectionId, projectId: section.projectId } });
    if (!target || target.id === sectionId) throw new TaskValidationError("Section de destination invalide.");
  }
  const memberships = await prisma.taskProject.findMany({
    where: { sectionId },
    select: { taskId: true, task: { select: { _count: { select: { projects: true } } } } },
  });

  await prisma.$transaction(async (tx) => {
    if (mode === "keep") {
      const agg = await tx.taskProject.aggregate({ where: { projectId: section.projectId, sectionId: targetSectionId }, _max: { position: true } });
      let position = agg._max.position ?? 0;
      for (const m of memberships) {
        position += POSITION_STEP;
        await tx.taskProject.update({
          where: { taskId_projectId: { taskId: m.taskId, projectId: section.projectId } },
          data: { sectionId: targetSectionId, position },
        });
      }
    } else {
      const exclusive = memberships.filter((m) => m.task._count.projects === 1).map((m) => m.taskId);
      await tx.task.deleteMany({ where: { id: { in: exclusive }, workspaceId: actor.workspaceId } });
      await tx.taskProject.deleteMany({ where: { sectionId } });
    }
    await tx.projectSection.delete({ where: { id: sectionId } });
  });
  await changed(actor, [section.projectId], "section");
}

// ─── Points d'avancement ──────────────────────────────────────────────────────

export async function postStatusUpdate(actor: Actor, projectId: string, raw: unknown): Promise<string> {
  const project = await requireProjectEdit(actor, projectId);
  const parsed = statusUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Point d'avancement invalide.");
  const update = await prisma.$transaction(async (tx) => {
    const created = await tx.projectStatusUpdate.create({
      data: {
        projectId,
        workspaceId: actor.workspaceId,
        authorId: actor.id,
        status: parsed.data.status,
        title: parsed.data.title,
        body: parsed.data.body ?? null,
      },
      select: { id: true },
    });
    await tx.project.update({ where: { id: projectId }, data: { status: parsed.data.status, version: { increment: 1 } } });
    return created;
  });
  const members = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
  await notify({
    workspaceId: actor.workspaceId,
    recipients: members.map((m) => m.userId),
    actorId: actor.id,
    type: "PROJECT_STATUS",
    title: `${project.name} — ${PROJECT_STATUS_LABELS[parsed.data.status]} : ${parsed.data.title}`,
    projectId,
  });
  await changed(actor, [projectId]);
  return update.id;
}

export async function commentStatusUpdate(actor: Actor, statusUpdateId: string, rawBody: string): Promise<void> {
  const update = await prisma.projectStatusUpdate.findFirst({
    where: { id: statusUpdateId, workspaceId: actor.workspaceId },
    select: { projectId: true, authorId: true, title: true },
  });
  if (!update) throw new TaskAccessError("NOT_FOUND");
  await requireProjectRead(actor, update.projectId);
  const parsed = commentBodySchema.safeParse(rawBody);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Commentaire invalide.");
  await prisma.comment.create({
    data: { workspaceId: actor.workspaceId, statusUpdateId, authorId: actor.id, body: parsed.data },
  });
  await notify({
    workspaceId: actor.workspaceId,
    recipients: [update.authorId],
    actorId: actor.id,
    type: "COMMENT",
    title: `Commentaire sur le point d'avancement « ${update.title} »`,
    projectId: update.projectId,
  });
  await changed(actor, [update.projectId]);
}

// ─── Champs du projet ─────────────────────────────────────────────────────────

export async function setProjectField(actor: Actor, projectId: string, fieldId: string, enabled: boolean): Promise<void> {
  await requireProjectEdit(actor, projectId);
  const field = await prisma.customField.findFirst({ where: { id: fieldId, workspaceId: actor.workspaceId }, select: { id: true } });
  if (!field) throw new TaskValidationError("Champ introuvable.");
  if (enabled) {
    const agg = await prisma.projectCustomField.aggregate({ where: { projectId }, _max: { position: true } });
    await prisma.projectCustomField.upsert({
      where: { projectId_fieldId: { projectId, fieldId } },
      create: { projectId, fieldId, position: (agg._max.position ?? 0) + POSITION_STEP },
      update: {},
    });
  } else {
    await prisma.projectCustomField.deleteMany({ where: { projectId, fieldId } });
  }
  await changed(actor, [projectId]);
}
