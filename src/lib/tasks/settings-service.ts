import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ENTITY_TYPES } from "@/lib/audit/types";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";

import { TaskAccessError, TaskValidationError, type Actor } from "./access";
import { ruleInputSchema } from "./automation-model";
import { MAX_ATTACHMENT_BYTES, NOTIFICATION_TYPES } from "./constants";
import {
  mapHeader,
  parseCsv,
  parseCsvDate,
  parseCsvMinutes,
  parseCsvPriority,
  parseCsvStatus,
} from "./csv";
import {
  customFieldInputSchema,
  formInputSchema,
  line,
  multiline,
  savedViewSchema,
  tagInputSchema,
  taskTemplateSchema,
} from "./inputs";
import { notify } from "./notify";
import { requireProjectEdit, requireProjectRead } from "./project-service";
import { viewConfigSchema } from "./query-engine";
import { publishChange } from "./realtime";
import { createTask, requireTaskEdit, requireTaskRead, userContext } from "./service";

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function createTag(actor: Actor, raw: unknown): Promise<{ id: string; name: string; color: string }> {
  const parsed = tagInputSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Tag invalide.");
  const tag = await prisma.tag.upsert({
    where: { workspaceId_name: { workspaceId: actor.workspaceId, name: parsed.data.name } },
    create: { workspaceId: actor.workspaceId, name: parsed.data.name, color: parsed.data.color ?? "slate" },
    update: {},
    select: { id: true, name: true, color: true },
  });
  await publishChange({ w: actor.workspaceId, a: actor.id, k: "context" });
  return tag;
}

export async function updateTag(actor: Actor, tagId: string, raw: unknown): Promise<void> {
  const parsed = tagInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Tag invalide.");
  const { count } = await prisma.tag.updateMany({ where: { id: tagId, workspaceId: actor.workspaceId }, data: parsed.data });
  if (!count) throw new TaskAccessError("NOT_FOUND");
  await publishChange({ w: actor.workspaceId, a: actor.id, k: "context" });
}

export async function deleteTag(actor: Actor, tagId: string): Promise<void> {
  const { count } = await prisma.tag.deleteMany({ where: { id: tagId, workspaceId: actor.workspaceId } });
  if (!count) throw new TaskAccessError("NOT_FOUND");
  await publishChange({ w: actor.workspaceId, a: actor.id, k: "context" });
}

// ─── Champs personnalisés ─────────────────────────────────────────────────────

export async function saveCustomField(actor: Actor, fieldId: string | null, raw: unknown, projectId?: string | null): Promise<string> {
  const parsed = customFieldInputSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Champ invalide.");
  const input = parsed.data;
  const isSelect = input.type === "SINGLE_SELECT" || input.type === "MULTI_SELECT";
  if (isSelect && !(input.options?.length)) throw new TaskValidationError("Ajoutez au moins une option.");
  const options = isSelect
    ? (input.options ?? []).map((o) => ({ id: o.id ?? randomUUID(), label: o.label, color: o.color ?? "slate" }))
    : [];

  let id = fieldId;
  if (fieldId) {
    const existing = await prisma.customField.findFirst({ where: { id: fieldId, workspaceId: actor.workspaceId } });
    if (!existing) throw new TaskAccessError("NOT_FOUND");
    if (existing.type !== input.type) throw new TaskValidationError("Le type d'un champ existant ne peut pas changer.");
    await prisma.customField.update({ where: { id: fieldId }, data: { name: input.name, options } });
    // Options supprimées : on retire leurs valeurs pour ne pas laisser d'orphelins.
    const kept = new Set(options.map((o) => o.id));
    const values = await prisma.taskCustomFieldValue.findMany({ where: { fieldId }, select: { taskId: true, optionIds: true } });
    for (const value of values) {
      const next = value.optionIds.filter((o) => kept.has(o));
      if (next.length !== value.optionIds.length) {
        if (next.length) await prisma.taskCustomFieldValue.update({ where: { taskId_fieldId: { taskId: value.taskId, fieldId } }, data: { optionIds: next } });
        else await prisma.taskCustomFieldValue.delete({ where: { taskId_fieldId: { taskId: value.taskId, fieldId } } });
      }
    }
  } else {
    const created = await prisma.customField.create({
      data: { workspaceId: actor.workspaceId, name: input.name, type: input.type, options },
      select: { id: true },
    });
    id = created.id;
    if (projectId) {
      await requireProjectEdit(actor, projectId);
      await prisma.projectCustomField.create({ data: { projectId, fieldId: id, position: Date.now() / 1000 } });
    }
  }
  await recordAudit({
    workspaceId: actor.workspaceId,
    userId: actor.id,
    action: fieldId ? "UPDATE" : "CREATE",
    entityType: AUDIT_ENTITY_TYPES.CUSTOM_FIELD,
    entityId: id,
  });
  await publishChange({ w: actor.workspaceId, a: actor.id, k: "context" });
  return id!;
}

export async function deleteCustomField(actor: Actor, fieldId: string): Promise<void> {
  const { count } = await prisma.customField.deleteMany({ where: { id: fieldId, workspaceId: actor.workspaceId } });
  if (!count) throw new TaskAccessError("NOT_FOUND");
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action: "DELETE", entityType: AUDIT_ENTITY_TYPES.CUSTOM_FIELD, entityId: fieldId });
  await publishChange({ w: actor.workspaceId, a: actor.id, k: "context" });
}

// ─── Règles d'automatisation ──────────────────────────────────────────────────

async function assertRuleReferences(actor: Actor, projectId: string | null, input: ReturnType<typeof ruleInputSchema.parse>) {
  const sectionIds = new Set<string>();
  const tagIds = new Set<string>();
  const userIds = new Set<string>();
  if (input.triggerConfig.sectionId) sectionIds.add(input.triggerConfig.sectionId);
  for (const c of input.conditions) {
    if (c.kind === "in_section") sectionIds.add(c.sectionId);
    if (c.kind === "has_tag") tagIds.add(c.tagId);
    if (c.kind === "assignee_is" && c.userId) userIds.add(c.userId);
  }
  for (const a of input.actions) {
    if (a.kind === "move_to_section") sectionIds.add(a.sectionId);
    if (a.kind === "add_tag") tagIds.add(a.tagId);
    if (a.kind === "set_assignee" && a.userId) userIds.add(a.userId);
    if (a.kind === "notify" && a.target === "user") {
      if (!a.userId) throw new TaskValidationError("Choisissez le destinataire de la notification.");
      userIds.add(a.userId);
    }
  }
  if (sectionIds.size) {
    if (!projectId) throw new TaskValidationError("Une règle d'espace ne peut pas viser une section.");
    const n = await prisma.projectSection.count({ where: { id: { in: [...sectionIds] }, projectId } });
    if (n !== sectionIds.size) throw new TaskValidationError("Section introuvable dans ce projet.");
  }
  if (tagIds.size) {
    const n = await prisma.tag.count({ where: { id: { in: [...tagIds] }, workspaceId: actor.workspaceId } });
    if (n !== tagIds.size) throw new TaskValidationError("Tag introuvable.");
  }
  if (userIds.size) {
    const n = await prisma.user.count({ where: { id: { in: [...userIds] }, workspaceId: actor.workspaceId } });
    if (n !== userIds.size) throw new TaskValidationError("Utilisateur introuvable.");
  }
}

export async function saveRule(actor: Actor, ruleId: string | null, projectId: string | null, raw: unknown): Promise<string> {
  const parsed = ruleInputSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Règle invalide.");
  const input = parsed.data;

  let scope = projectId;
  if (ruleId) {
    const existing = await prisma.automationRule.findFirst({ where: { id: ruleId, workspaceId: actor.workspaceId } });
    if (!existing) throw new TaskAccessError("NOT_FOUND");
    scope = existing.projectId;
  }
  if (scope) await requireProjectEdit(actor, scope);
  await assertRuleReferences(actor, scope, input);

  const data = {
    name: input.name,
    trigger: input.trigger,
    triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
    conditions: input.conditions as Prisma.InputJsonValue,
    actions: input.actions as Prisma.InputJsonValue,
    isEnabled: input.isEnabled,
  };
  let id = ruleId;
  if (ruleId) {
    await prisma.automationRule.update({ where: { id: ruleId }, data });
  } else {
    id = (
      await prisma.automationRule.create({
        data: { ...data, workspaceId: actor.workspaceId, projectId: scope, createdById: actor.id },
        select: { id: true },
      })
    ).id;
  }
  await recordAudit({
    workspaceId: actor.workspaceId,
    userId: actor.id,
    action: ruleId ? "UPDATE" : "CREATE",
    entityType: AUDIT_ENTITY_TYPES.AUTOMATION_RULE,
    entityId: id,
  });
  return id!;
}

export async function deleteRule(actor: Actor, ruleId: string): Promise<void> {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, workspaceId: actor.workspaceId } });
  if (!rule) throw new TaskAccessError("NOT_FOUND");
  if (rule.projectId) await requireProjectEdit(actor, rule.projectId);
  await prisma.automationRule.delete({ where: { id: ruleId } });
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action: "DELETE", entityType: AUDIT_ENTITY_TYPES.AUTOMATION_RULE, entityId: ruleId });
}

// ─── Modèles de tâches ────────────────────────────────────────────────────────

export async function saveTaskTemplate(actor: Actor, templateId: string | null, raw: unknown): Promise<string> {
  const parsed = taskTemplateSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Modèle invalide.");
  const input = parsed.data;
  if (input.projectId) await requireProjectEdit(actor, input.projectId);
  if (input.tagIds?.length) {
    const n = await prisma.tag.count({ where: { id: { in: input.tagIds }, workspaceId: actor.workspaceId } });
    if (n !== input.tagIds.length) throw new TaskValidationError("Tag introuvable.");
  }
  const data = {
    name: input.name,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "NORMAL",
    estimatedMinutes: input.estimatedMinutes ?? null,
    isApproval: input.isApproval ?? false,
    subtasks: input.subtasks ?? [],
    tagIds: input.tagIds ?? [],
  };
  if (templateId) {
    const { count } = await prisma.taskTemplate.updateMany({ where: { id: templateId, workspaceId: actor.workspaceId }, data });
    if (!count) throw new TaskAccessError("NOT_FOUND");
    return templateId;
  }
  const created = await prisma.taskTemplate.create({
    data: { ...data, workspaceId: actor.workspaceId, projectId: input.projectId ?? null, createdById: actor.id },
    select: { id: true },
  });
  return created.id;
}

export async function deleteTaskTemplate(actor: Actor, templateId: string): Promise<void> {
  const template = await prisma.taskTemplate.findFirst({ where: { id: templateId, workspaceId: actor.workspaceId } });
  if (!template) throw new TaskAccessError("NOT_FOUND");
  if (template.projectId) await requireProjectEdit(actor, template.projectId);
  await prisma.taskTemplate.delete({ where: { id: templateId } });
}

/** Enregistre une tâche existante comme modèle (titre, description, sous-tâches). */
export async function taskToTemplate(actor: Actor, taskId: string, projectId: string | null): Promise<string> {
  await requireTaskRead(userContext(actor), taskId);
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      title: true,
      notes: true,
      priority: true,
      estimatedMinutes: true,
      isApproval: true,
      tags: { select: { tagId: true } },
      subtasks: { orderBy: { subtaskPosition: "asc" }, select: { title: true } },
    },
  });
  return saveTaskTemplate(actor, null, {
    name: task.title.slice(0, 120),
    title: task.title,
    description: task.notes,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    isApproval: task.isApproval,
    subtasks: task.subtasks.map((s) => s.title),
    tagIds: task.tags.map((t) => t.tagId),
    projectId,
  });
}

// ─── Formulaires internes ─────────────────────────────────────────────────────

export async function saveForm(actor: Actor, formId: string | null, projectId: string, raw: unknown): Promise<string> {
  await requireProjectEdit(actor, projectId);
  const parsed = formInputSchema.safeParse(raw);
  if (!parsed.success) throw new TaskValidationError(parsed.error.issues[0]?.message ?? "Formulaire invalide.");
  const input = parsed.data;
  if (input.sectionId) {
    const s = await prisma.projectSection.findFirst({ where: { id: input.sectionId, projectId } });
    if (!s) throw new TaskValidationError("Section introuvable.");
  }
  if (input.fields.fieldIds.length) {
    const n = await prisma.customField.count({ where: { id: { in: input.fields.fieldIds }, workspaceId: actor.workspaceId } });
    if (n !== input.fields.fieldIds.length) throw new TaskValidationError("Champ introuvable.");
  }
  const data = {
    name: input.name,
    description: input.description ?? null,
    sectionId: input.sectionId ?? null,
    isActive: input.isActive ?? true,
    fields: input.fields as Prisma.InputJsonValue,
  };
  if (formId) {
    const { count } = await prisma.taskForm.updateMany({ where: { id: formId, projectId, workspaceId: actor.workspaceId }, data });
    if (!count) throw new TaskAccessError("NOT_FOUND");
    return formId;
  }
  const created = await prisma.taskForm.create({
    data: { ...data, workspaceId: actor.workspaceId, projectId },
    select: { id: true },
  });
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action: "CREATE", entityType: AUDIT_ENTITY_TYPES.TASK_FORM, entityId: created.id });
  return created.id;
}

export async function deleteForm(actor: Actor, formId: string): Promise<void> {
  const form = await prisma.taskForm.findFirst({ where: { id: formId, workspaceId: actor.workspaceId } });
  if (!form) throw new TaskAccessError("NOT_FOUND");
  await requireProjectEdit(actor, form.projectId);
  await prisma.taskForm.delete({ where: { id: formId } });
}

/**
 * Envoi d'un formulaire : crée une tâche dans le projet. Le demandeur doit
 * pouvoir *lire* le projet (formulaire interne) ; la tâche est créée au nom
 * du système de formulaire, le demandeur en devient abonné.
 */
export async function submitForm(
  actor: Actor,
  formId: string,
  raw: { title: string; description?: string | null; dueDate?: string | null; priority?: string | null; assigneeId?: string | null; custom?: Record<string, unknown> },
): Promise<string> {
  const form = await prisma.taskForm.findFirst({
    where: { id: formId, workspaceId: actor.workspaceId, isActive: true },
    select: { id: true, name: true, projectId: true, sectionId: true, fields: true, project: { select: { ownerId: true, archivedAt: true } } },
  });
  if (!form) throw new TaskAccessError("NOT_FOUND", "Formulaire introuvable ou désactivé.");
  if (form.project.archivedAt) throw new TaskValidationError("Ce projet est archivé.");
  await requireProjectRead(actor, form.projectId);
  const fields = formInputSchema.shape.fields.parse(form.fields ?? {});

  const custom: Record<string, unknown> = {};
  for (const fieldId of fields.fieldIds) {
    if (raw.custom && fieldId in raw.custom) custom[fieldId] = raw.custom[fieldId];
  }

  // La création se fait dans le contexte d'une règle « formulaire » : le
  // demandeur peut ne pas avoir le droit d'écrire dans le projet.
  const ctx = { actor, trusted: true };
  const task = await createTask(ctx, {
    title: raw.title,
    description: fields.description ? (raw.description ?? null) : null,
    projectId: form.projectId,
    sectionId: form.sectionId,
    dueDate: fields.dueDate ? (raw.dueDate ?? null) : null,
    priority: fields.priority && raw.priority ? (raw.priority as "LOW") : undefined,
    assigneeId: fields.assignee ? (raw.assigneeId ?? null) : null,
    custom: custom as Record<string, string>,
  });
  await prisma.taskFollower.createMany({ data: [{ taskId: task.id, userId: actor.id, kind: "FOLLOWER" }], skipDuplicates: true });
  await prisma.taskForm.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } });
  await notify({
    workspaceId: actor.workspaceId,
    recipients: [form.project.ownerId],
    actorId: actor.id,
    type: "FORM_SUBMISSION",
    title: `Nouvelle demande via « ${form.name} » : ${task.title}`,
    taskId: task.id,
  });
  return task.id;
}

// ─── Vues enregistrées ────────────────────────────────────────────────────────

export async function saveView(actor: Actor, viewId: string | null, raw: { name: string; scope: string; config: unknown }): Promise<string> {
  const meta = savedViewSchema.safeParse({ name: raw.name, scope: raw.scope });
  if (!meta.success) throw new TaskValidationError(meta.error.issues[0]?.message ?? "Vue invalide.");
  const config = viewConfigSchema.safeParse(raw.config);
  if (!config.success) throw new TaskValidationError("Configuration de vue invalide.");
  if (meta.data.scope.startsWith("project:")) await requireProjectRead(actor, meta.data.scope.slice(8));
  const data = { name: meta.data.name, scope: meta.data.scope, config: config.data as Prisma.InputJsonValue };
  if (viewId) {
    const { count } = await prisma.savedView.updateMany({ where: { id: viewId, userId: actor.id }, data });
    if (!count) throw new TaskAccessError("NOT_FOUND");
    return viewId;
  }
  return (
    await prisma.savedView.create({ data: { ...data, userId: actor.id, workspaceId: actor.workspaceId }, select: { id: true } })
  ).id;
}

export async function deleteView(actor: Actor, viewId: string): Promise<void> {
  await prisma.savedView.deleteMany({ where: { id: viewId, userId: actor.id } });
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function markNotifications(
  actor: Actor,
  ids: string[] | "all",
  change: { read?: boolean; archived?: boolean },
): Promise<void> {
  const data: Prisma.NotificationUpdateManyMutationInput = {};
  if (change.read !== undefined) data.readAt = change.read ? new Date() : null;
  if (change.archived !== undefined) data.archivedAt = change.archived ? new Date() : null;
  await prisma.notification.updateMany({
    where: { userId: actor.id, workspaceId: actor.workspaceId, ...(ids === "all" ? {} : { id: { in: ids.slice(0, 500) } }) },
    data,
  });
  await publishChange({ w: actor.workspaceId, a: actor.id, u: [actor.id], k: "notification" });
}

export async function setNotificationPreference(actor: Actor, type: string, inApp: boolean): Promise<void> {
  if (!(type in NOTIFICATION_TYPES)) throw new TaskValidationError("Type de notification inconnu.");
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: actor.id, type } },
    create: { userId: actor.id, type, inApp },
    update: { inApp },
  });
}

// ─── Import CSV ───────────────────────────────────────────────────────────────

export interface ImportReport {
  created: number;
  skipped: { line: number; reason: string }[];
}

const MAX_IMPORT_ROWS = 2000;

export async function importCsv(actor: Actor, projectId: string, text: string): Promise<ImportReport> {
  await requireProjectEdit(actor, projectId);
  if (text.length > 5_000_000) throw new TaskValidationError("Fichier trop volumineux (5 Mo maximum).");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new TaskValidationError("Le fichier ne contient aucune ligne de tâche.");
  const mapping = mapHeader(rows[0]);
  if (mapping.title === undefined) {
    throw new TaskValidationError("Colonne « Nom » (ou « Titre ») introuvable dans l'en-tête.");
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new TaskValidationError(`${MAX_IMPORT_ROWS} lignes maximum par import.`);

  const [users, sections, tags] = await Promise.all([
    prisma.user.findMany({ where: { workspaceId: actor.workspaceId, isActive: true }, select: { id: true, email: true, displayName: true } }),
    prisma.projectSection.findMany({ where: { projectId }, select: { id: true, name: true } }),
    prisma.tag.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, name: true } }),
  ]);
  const norm = (s: string) => s.trim().toLowerCase();
  const userBy = new Map<string, string>();
  for (const u of users) {
    userBy.set(norm(u.email), u.id);
    if (u.displayName) userBy.set(norm(u.displayName), u.id);
  }
  const sectionBy = new Map(sections.map((s) => [norm(s.name), s.id]));
  const tagBy = new Map(tags.map((t) => [norm(t.name), t.id]));

  const report: ImportReport = { created: 0, skipped: [] };
  const ctx = userContext(actor);
  const cell = (row: string[], key: keyof typeof mapping) => (mapping[key] !== undefined ? (row[mapping[key]!] ?? "").trim() : "");

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const title = line(300).safeParse(cell(row, "title"));
    if (!title.success || !title.data) {
      report.skipped.push({ line: index + 1, reason: "Nom manquant." });
      continue;
    }
    try {
      const sectionName = cell(row, "section");
      let sectionId = sectionName ? (sectionBy.get(norm(sectionName)) ?? null) : null;
      if (sectionName && !sectionId) {
        const agg = await prisma.projectSection.aggregate({ where: { projectId }, _max: { position: true } });
        const created = await prisma.projectSection.create({
          data: { projectId, workspaceId: actor.workspaceId, name: sectionName.slice(0, 120), position: (agg._max.position ?? 0) + 1024 },
          select: { id: true },
        });
        sectionId = created.id;
        sectionBy.set(norm(sectionName), created.id);
      }
      const tagIds: string[] = [];
      for (const name of cell(row, "tags").split(/[,|]/).map((t) => t.trim()).filter(Boolean)) {
        let tagId = tagBy.get(norm(name));
        if (!tagId) {
          tagId = (await createTag(actor, { name })).id;
          tagBy.set(norm(name), tagId);
        }
        tagIds.push(tagId);
      }
      const assignee = cell(row, "assignee");
      const description = multiline(20_000).safeParse(cell(row, "description"));
      const dueDate = parseCsvDate(cell(row, "dueDate"));
      const startDate = parseCsvDate(cell(row, "startDate"));
      await createTask(ctx, {
        title: title.data,
        description: description.success && description.data ? description.data : null,
        projectId,
        sectionId,
        assigneeId: assignee ? (userBy.get(norm(assignee)) ?? null) : null,
        dueDate,
        startDate: startDate && dueDate && startDate > dueDate ? null : startDate,
        status: parseCsvStatus(cell(row, "status")) ?? undefined,
        priority: parseCsvPriority(cell(row, "priority")) ?? undefined,
        estimatedMinutes: parseCsvMinutes(cell(row, "estimate")),
        tagIds,
      });
      report.created += 1;
    } catch (error) {
      report.skipped.push({ line: index + 1, reason: error instanceof Error ? error.message : "Ligne invalide." });
    }
  }
  return report;
}

// ─── Pièces jointes ───────────────────────────────────────────────────────────

/**
 * Types acceptés : liste fermée, contrôlée sur l'extension **et** sur la
 * signature binaire quand le format en a une. Un exécutable renommé en `.pdf`
 * est refusé.
 */
const ATTACHMENT_TYPES: Record<string, { mime: string; magic?: number[][] }> = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  gif: { mime: "image/gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  txt: { mime: "text/plain" },
  csv: { mime: "text/csv" },
  md: { mime: "text/markdown" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  odt: { mime: "application/vnd.oasis.opendocument.text", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  zip: { mime: "application/zip", magic: [[0x50, 0x4b, 0x03, 0x04]] },
};

export const ACCEPTED_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);

export function validateAttachment(fileName: string, bytes: Uint8Array): { ext: string; mime: string } {
  if (bytes.byteLength === 0) throw new TaskValidationError("Le fichier est vide.");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new TaskValidationError("Fichier trop volumineux (10 Mo maximum).");
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const type = ATTACHMENT_TYPES[ext];
  if (!type) throw new TaskValidationError(`Type de fichier non accepté (${ACCEPTED_EXTENSIONS.join(", ")}).`);
  if (type.magic && !type.magic.some((sig) => sig.every((byte, i) => bytes[i] === byte))) {
    throw new TaskValidationError("Le contenu du fichier ne correspond pas à son extension.");
  }
  if (!type.magic) {
    // Texte : refuser tout octet NUL (binaire déguisé).
    const sample = bytes.subarray(0, 8192);
    if (sample.includes(0)) throw new TaskValidationError("Le contenu du fichier ne correspond pas à son extension.");
  }
  return { ext, mime: type.mime };
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .trim()
    .slice(-150);
  return cleaned || "fichier";
}

export async function addAttachment(actor: Actor, taskId: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const ctx = userContext(actor);
  await requireTaskEdit(ctx, taskId);
  const { ext, mime } = validateAttachment(fileName, bytes);
  const id = randomUUID();
  const storageKey = `task-files/${id}.${ext}`;
  await objectStore.put(storageKey, bytes);
  try {
    await prisma.$transaction([
      prisma.taskAttachment.create({
        data: {
          id,
          taskId,
          workspaceId: actor.workspaceId,
          storageKey,
          fileName: safeFileName(fileName),
          mimeType: mime,
          sizeBytes: bytes.byteLength,
          uploadedById: actor.id,
        },
      }),
      prisma.taskActivity.create({
        data: { workspaceId: actor.workspaceId, taskId, actorId: actor.id, kind: "attachment_added", field: "Pièce jointe", newValue: safeFileName(fileName) },
      }),
      prisma.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } }),
    ]);
  } catch (error) {
    await objectStore.remove(storageKey).catch(() => {});
    throw error;
  }
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action: "CREATE", entityType: AUDIT_ENTITY_TYPES.TASK_ATTACHMENT, entityId: id });
  await publishChange({ w: actor.workspaceId, a: actor.id, t: [taskId], k: "task" });
  return id;
}

export async function deleteAttachment(actor: Actor, attachmentId: string): Promise<void> {
  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: attachmentId, workspaceId: actor.workspaceId },
    select: { id: true, taskId: true, storageKey: true, fileName: true },
  });
  if (!attachment) throw new TaskAccessError("NOT_FOUND");
  await requireTaskEdit(userContext(actor), attachment.taskId);
  await prisma.$transaction([
    prisma.taskAttachment.delete({ where: { id: attachmentId } }),
    prisma.taskActivity.create({
      data: { workspaceId: actor.workspaceId, taskId: attachment.taskId, actorId: actor.id, kind: "attachment_removed", field: "Pièce jointe", oldValue: attachment.fileName },
    }),
    prisma.task.update({ where: { id: attachment.taskId }, data: { version: { increment: 1 } } }),
  ]);
  await objectStore.remove(attachment.storageKey).catch(() => {});
  await recordAudit({ workspaceId: actor.workspaceId, userId: actor.id, action: "DELETE", entityType: AUDIT_ENTITY_TYPES.TASK_ATTACHMENT, entityId: attachmentId });
  await publishChange({ w: actor.workspaceId, a: actor.id, t: [attachment.taskId], k: "task" });
}

/** Lecture d'une pièce jointe : uniquement si la tâche est lisible. */
export async function readAttachment(actor: Actor, attachmentId: string) {
  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: attachmentId, workspaceId: actor.workspaceId },
    select: { taskId: true, storageKey: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  if (!attachment) throw new TaskAccessError("NOT_FOUND");
  await requireTaskRead(userContext(actor), attachment.taskId);
  const bytes = await objectStore.read(attachment.storageKey);
  if (!bytes) throw new TaskAccessError("NOT_FOUND");
  return { ...attachment, bytes };
}
