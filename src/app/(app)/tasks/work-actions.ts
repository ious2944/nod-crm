"use server";

// Server Actions du module de gestion de travail (V1.0).
//
// Rappel : ce fichier ne peut exporter QUE des fonctions asynchrones.
// Chaque action dérive l'acteur de la session (`runAction`), délègue au
// service — qui revérifie l'espace et les droits — et renvoie un
// `ActionResult` sérialisable. Aucune n'accepte de `workspaceId`.

import { runAction } from "@/lib/tasks/action-result";
import * as projects from "@/lib/tasks/project-service";
import * as service from "@/lib/tasks/service";
import * as settings from "@/lib/tasks/settings-service";
import type { CreateTaskInputV1 } from "@/lib/tasks/inputs";
import type { CustomFieldValue, ProjectRole, TaskPatch, TaskPatchField } from "@/lib/tasks/types";

const ctx = service.userContext;

// ─── Tâches ───────────────────────────────────────────────────────────────────

export async function createTaskAction(input: CreateTaskInputV1) {
  return runAction("task.create", (actor) => service.createTask(ctx(actor), input));
}

export async function updateTaskAction(
  taskId: string,
  patch: TaskPatch,
  base?: Partial<Record<TaskPatchField, unknown>>,
) {
  return runAction("task.edit", (actor) => service.updateTaskFields(ctx(actor), taskId, patch, { base }));
}

export async function deleteTaskAction(taskId: string) {
  return runAction("task.manage", (actor) => service.deleteTask(ctx(actor), taskId));
}

export async function restoreTaskAction(taskId: string) {
  return runAction("task.restore", (actor) => service.restoreTask(ctx(actor), taskId));
}

export async function purgeTaskAction(taskId: string) {
  return runAction("task.purge", (actor) => service.purgeTask(ctx(actor), taskId));
}

export async function duplicateTaskAction(taskId: string, includeSubtasks = true) {
  return runAction("task.manage", (actor) => service.duplicateTask(ctx(actor), taskId, { includeSubtasks }));
}

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  sectionId: string | null;
  beforeId?: string | null;
  afterId?: string | null;
}) {
  return runAction("task.manage", (actor) => service.moveTask(ctx(actor), input));
}

export async function addTaskToProjectAction(taskId: string, projectId: string, sectionId: string | null = null) {
  return runAction("task.manage", (actor) => service.addTaskToProject(ctx(actor), taskId, projectId, sectionId));
}

export async function removeTaskFromProjectAction(taskId: string, projectId: string) {
  return runAction("task.manage", (actor) => service.removeTaskFromProject(ctx(actor), taskId, projectId));
}

export async function moveSubtaskAction(taskId: string, beforeId: string | null, afterId: string | null) {
  return runAction("task.edit", (actor) => service.moveSubtask(ctx(actor), taskId, beforeId, afterId));
}

export async function setTaskParentAction(taskId: string, parentId: string | null) {
  return runAction("task.manage", (actor) => service.setTaskParent(ctx(actor), taskId, parentId));
}

/** `baseTagIds` : tags affichés au moment de la modification (seule la différence est appliquée). */
export async function setTaskTagsAction(taskId: string, tagIds: string[], baseTagIds?: string[]) {
  return runAction("task.edit", (actor) => service.setTaskTags(ctx(actor), taskId, tagIds, { base: baseTagIds }));
}

export async function setCustomFieldValueAction(taskId: string, fieldId: string, value: CustomFieldValue) {
  return runAction("task.edit", (actor) => service.setCustomFieldValue(ctx(actor), taskId, fieldId, value));
}

export async function addDependencyAction(blockedId: string, blockingId: string) {
  return runAction("task.edit", (actor) => service.addDependency(ctx(actor), blockedId, blockingId));
}

export async function removeDependencyAction(blockedId: string, blockingId: string) {
  return runAction("task.edit", (actor) => service.removeDependency(ctx(actor), blockedId, blockingId));
}

export async function setFollowerAction(taskId: string, userId: string, kind: "COLLABORATOR" | "FOLLOWER" | null) {
  return runAction("task.read", (actor) => service.setFollower(ctx(actor), taskId, userId, kind));
}

export async function addTimeEntryAction(taskId: string, entry: { minutes: number; date: string; note?: string | null }) {
  return runAction("task.edit", (actor) => service.addTimeEntry(ctx(actor), taskId, entry));
}

export async function deleteTimeEntryAction(entryId: string) {
  return runAction("task.read", (actor) => service.deleteTimeEntry(ctx(actor), entryId));
}

export async function addCommentAction(taskId: string, body: string) {
  return runAction("task.comment", (actor) => service.addComment(ctx(actor), taskId, body));
}

export async function editCommentAction(commentId: string, body: string) {
  return runAction("task.comment.own", (actor) => service.editComment(ctx(actor), commentId, body));
}

export async function deleteCommentAction(commentId: string) {
  return runAction("task.comment.own", (actor) => service.deleteComment(ctx(actor), commentId));
}

export async function toggleReactionAction(commentId: string, emoji: string) {
  return runAction("task.comment", (actor) => service.toggleReaction(ctx(actor), commentId, emoji));
}

export async function bulkUpdateAction(taskIds: string[], patch: TaskPatch) {
  return runAction("task.edit", (actor) => service.bulkUpdate(ctx(actor), taskIds, patch));
}

/** Modifications individuelles groupées (ex. décalage explicite des dépendantes). */
export async function bulkPatchAction(items: { id: string; patch: TaskPatch }[]) {
  return runAction("task.edit", async (actor) => {
    const result: Awaited<ReturnType<typeof service.bulkUpdate>> = { updated: [], failed: [] };
    for (const item of items.slice(0, 200)) {
      try {
        result.updated.push(await service.updateTaskFields(ctx(actor), item.id, item.patch));
      } catch (error) {
        result.failed.push({ id: item.id, error: error instanceof Error ? error.message : "Erreur." });
      }
    }
    return result;
  });
}

export async function bulkDeleteAction(taskIds: string[]) {
  return runAction("task.manage", (actor) => service.bulkDelete(ctx(actor), taskIds));
}

export async function bulkMoveAction(taskIds: string[], projectId: string, sectionId: string | null) {
  return runAction("task.manage", async (actor) => {
    const moved = [];
    const failed: { id: string; error: string }[] = [];
    for (const taskId of [...new Set(taskIds)].slice(0, 500)) {
      try {
        moved.push((await service.moveTask(ctx(actor), { taskId, projectId, sectionId })).task);
      } catch (error) {
        failed.push({ id: taskId, error: error instanceof Error ? error.message : "Erreur." });
      }
    }
    return { updated: moved, failed };
  });
}

export async function deleteAttachmentAction(attachmentId: string) {
  return runAction("task.edit", (actor) => settings.deleteAttachment(actor, attachmentId));
}

// ─── Projets ──────────────────────────────────────────────────────────────────

export async function createProjectAction(input: unknown) {
  return runAction("project.create", (actor) => projects.createProject(actor, input));
}

export async function updateProjectAction(projectId: string, patch: unknown, baseVersion?: number) {
  return runAction("project.manage", (actor) => projects.updateProject(actor, projectId, patch, baseVersion));
}

export async function duplicateProjectAction(projectId: string, options: { name?: string; includeTasks?: boolean; asTemplate?: boolean }) {
  return runAction("project.read", (actor) => projects.duplicateProject(actor, projectId, options));
}

export async function archiveProjectAction(projectId: string, archived: boolean) {
  return runAction("project.manage", (actor) => projects.setProjectArchived(actor, projectId, archived));
}

export async function deleteProjectAction(projectId: string) {
  return runAction("project.manage", (actor) => projects.deleteProject(actor, projectId));
}

export async function restoreProjectAction(projectId: string) {
  return runAction("project.restore", (actor) => projects.restoreProject(actor, projectId));
}

export async function previewProjectPurgeAction(projectId: string) {
  return runAction("project.purge", (actor) => projects.previewProjectPurge(actor, projectId));
}

/** `token` : empreinte du périmètre confirmé (voir `previewProjectPurgeAction`). */
export async function purgeProjectAction(projectId: string, token: string) {
  return runAction("project.purge", (actor) => projects.purgeProject(actor, projectId, token));
}

export async function setProjectMemberAction(projectId: string, userId: string, role: ProjectRole | null) {
  return runAction("project.manage", (actor) => projects.setProjectMember(actor, projectId, userId, role));
}

export async function setFavoriteAction(projectId: string, favorite: boolean) {
  return runAction("project.read", (actor) => projects.setFavorite(actor, projectId, favorite));
}

export async function createSectionAction(projectId: string, name: string, afterSectionId?: string | null) {
  return runAction("project.edit", (actor) => projects.createSection(actor, projectId, name, afterSectionId));
}

export async function renameSectionAction(sectionId: string, name: string) {
  return runAction("project.edit", (actor) => projects.renameSection(actor, sectionId, name));
}

export async function moveSectionAction(sectionId: string, beforeId: string | null, afterId: string | null) {
  return runAction("project.edit", (actor) => projects.moveSection(actor, sectionId, beforeId, afterId));
}

export async function deleteSectionAction(sectionId: string, targetSectionId: string | null) {
  return runAction("project.edit", (actor) => projects.deleteSection(actor, sectionId, targetSectionId));
}

export async function postStatusUpdateAction(projectId: string, input: unknown) {
  return runAction("project.edit", (actor) => projects.postStatusUpdate(actor, projectId, input));
}

export async function commentStatusUpdateAction(statusUpdateId: string, body: string) {
  return runAction("project.read", (actor) => projects.commentStatusUpdate(actor, statusUpdateId, body));
}

export async function setProjectFieldAction(projectId: string, fieldId: string, enabled: boolean) {
  return runAction("project.edit", (actor) => projects.setProjectField(actor, projectId, fieldId, enabled));
}

export async function importCsvAction(projectId: string, text: string) {
  return runAction("project.edit", (actor) => settings.importCsv(actor, projectId, text));
}

// ─── Réglages ─────────────────────────────────────────────────────────────────

export async function createTagAction(input: { name: string; color?: string }) {
  return runAction("workspace.tag.write", (actor) => settings.createTag(actor, input));
}

export async function updateTagAction(tagId: string, input: { name?: string; color?: string }) {
  return runAction("workspace.tag.write", (actor) => settings.updateTag(actor, tagId, input));
}

export async function deleteTagAction(tagId: string) {
  return runAction("workspace.tag.write", (actor) => settings.deleteTag(actor, tagId));
}

export async function saveCustomFieldAction(fieldId: string | null, input: unknown, projectId?: string | null) {
  return runAction("workspace.field.write", (actor) => settings.saveCustomField(actor, fieldId, input, projectId));
}

export async function deleteCustomFieldAction(fieldId: string) {
  return runAction("workspace.field.write", (actor) => settings.deleteCustomField(actor, fieldId));
}

export async function saveRuleAction(ruleId: string | null, projectId: string | null, input: unknown) {
  return runAction("workspace.rule.write", (actor) => settings.saveRule(actor, ruleId, projectId, input));
}

export async function deleteRuleAction(ruleId: string) {
  return runAction("workspace.rule.write", (actor) => settings.deleteRule(actor, ruleId));
}

export async function saveTaskTemplateAction(templateId: string | null, input: unknown) {
  return runAction("workspace.template.write", (actor) => settings.saveTaskTemplate(actor, templateId, input));
}

export async function deleteTaskTemplateAction(templateId: string) {
  return runAction("workspace.template.write", (actor) => settings.deleteTaskTemplate(actor, templateId));
}

export async function taskToTemplateAction(taskId: string, projectId: string | null) {
  return runAction("workspace.template.write", (actor) => settings.taskToTemplate(actor, taskId, projectId));
}

export async function saveFormAction(formId: string | null, projectId: string, input: unknown) {
  return runAction("project.edit", (actor) => settings.saveForm(actor, formId, projectId, input));
}

export async function deleteFormAction(formId: string) {
  return runAction("project.edit", (actor) => settings.deleteForm(actor, formId));
}

export async function submitFormAction(
  formId: string,
  input: { title: string; description?: string | null; dueDate?: string | null; priority?: string | null; assigneeId?: string | null; custom?: Record<string, unknown> },
) {
  return runAction("project.read", (actor) => settings.submitForm(actor, formId, input));
}

export async function saveViewAction(viewId: string | null, input: { name: string; scope: string; config: unknown }) {
  return runAction("user.view.write", (actor) => settings.saveView(actor, viewId, input));
}

export async function deleteViewAction(viewId: string) {
  return runAction("user.view.write", (actor) => settings.deleteView(actor, viewId));
}

export async function markNotificationsAction(ids: string[] | "all", change: { read?: boolean; archived?: boolean }) {
  return runAction("user.notification.write", (actor) => settings.markNotifications(actor, ids, change));
}

export async function setNotificationPreferenceAction(type: string, inApp: boolean) {
  return runAction("user.notification.write", (actor) => settings.setNotificationPreference(actor, type, inApp));
}

export async function setWeeklyCapacityAction(minutes: number | null) {
  return runAction("user.capacity.write", (actor) => settings.setWeeklyCapacity(actor, minutes));
}
