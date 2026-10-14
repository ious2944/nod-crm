"use client";

import { useCallback } from "react";

import {
  addTaskToProjectAction,
  bulkDeleteAction,
  bulkMoveAction,
  bulkUpdateAction,
  createTaskAction,
  deleteTaskAction,
  duplicateTaskAction,
  moveTaskAction,
  removeTaskFromProjectAction,
  setCustomFieldValueAction,
  setTaskTagsAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import type { CreateTaskInputV1 } from "@/lib/tasks/inputs";
import type { CustomFieldValue, TaskItem, TaskPatch } from "@/lib/tasks/types";

import { baseOf, useWorkApi } from "./store";

/**
 * Opérations sur les tâches, partagées par toutes les vues. Chacune est
 * optimiste et réversible (voir `mutateTask`).
 */

let tempCounter = 0;

function patchToItem(patch: TaskPatch): Partial<TaskItem> {
  const item: Partial<TaskItem> = { ...(patch as Partial<TaskItem>) };
  delete (item as Record<string, unknown>).description;
  if (patch.status) item.completedAt = patch.status === "DONE" ? new Date().toISOString() : null;
  if ("description" in patch) item.hasDescription = Boolean(patch.description?.trim());
  return item;
}

export function useTaskOps() {
  const { store, mutateTask, run, afterMutation } = useWorkApi();

  const update = useCallback(
    (task: TaskItem, patch: TaskPatch) =>
      mutateTask(task.id, patchToItem(patch), () => updateTaskAction(task.id, patch, baseOf(task, patch))),
    [mutateTask],
  );

  const toggleComplete = useCallback(
    async (task: TaskItem) => {
      const done = task.status !== "DONE";
      const result = await update(task, { status: done ? "DONE" : "TODO" });
      if (result && done) {
        store.toast("success", `« ${task.title} » terminée.`, {
          label: "Annuler",
          run: () => {
            const current = store.state.tasks[task.id];
            if (current) void update(current, { status: task.status === "DONE" ? "TODO" : task.status });
          },
        });
        if (task.recurrence) {
          // L'occurrence suivante vient d'être créée côté serveur.
          for (const reloader of store.reloaders.values()) void reloader.reload().catch(() => {});
        }
      }
      return result;
    },
    [store, update],
  );

  const create = useCallback(
    async (input: CreateTaskInputV1, optimistic?: Partial<TaskItem>) => {
      const tempId = `tmp-${Date.now()}-${tempCounter++}`;
      const me = store.state.context?.me.id ?? null;
      const now = new Date().toISOString();
      const temp: TaskItem = {
        id: tempId,
        title: input.title,
        status: input.status ?? "TODO",
        priority: input.priority ?? "NORMAL",
        assigneeId: input.assigneeId !== undefined ? input.assigneeId : !input.projectId && !input.parentId ? me : null,
        createdById: me,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        startDate: input.startDate ?? null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        parentId: input.parentId ?? null,
        subtaskPosition: Number.MAX_SAFE_INTEGER,
        isMilestone: input.isMilestone ?? false,
        isApproval: input.isApproval ?? false,
        approvalStatus: input.isApproval ? "PENDING" : null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        spentMinutes: 0,
        tagIds: input.tagIds ?? [],
        custom: (input.custom as Record<string, CustomFieldValue>) ?? {},
        memberships: input.projectId ? [{ projectId: input.projectId, sectionId: input.sectionId ?? null, position: Number.MAX_SAFE_INTEGER }] : [],
        subtaskCount: 0,
        subtaskDoneCount: 0,
        commentCount: 0,
        attachmentCount: 0,
        blockedByIds: [],
        blockingIds: [],
        openBlockerCount: 0,
        recurrence: null,
        hasDescription: Boolean(input.description),
        excerpt: "",
        contactId: input.contactId ?? null,
        organizationId: input.organizationId ?? null,
        opportunityId: input.opportunityId ?? null,
        followUpId: null,
        version: 0,
        canEdit: true,
        canManage: true,
        ...optimistic,
      };
      store.upsertTasks([temp]);
      if (input.parentId) {
        const parent = store.state.tasks[input.parentId];
        if (parent) store.patchTask(parent.id, { subtaskCount: parent.subtaskCount + 1 });
      }
      try {
        const result = await createTaskAction(input);
        store.removeTasks([tempId]);
        if (!result.ok) {
          if (input.parentId) {
            const parent = store.state.tasks[input.parentId];
            if (parent) store.patchTask(parent.id, { subtaskCount: Math.max(0, parent.subtaskCount - 1) });
          }
          store.toast("error", result.error);
          return null;
        }
        store.upsertTasks([result.data]);
        afterMutation();
        return result.data;
      } catch {
        store.removeTasks([tempId]);
        store.toast("error", "Connexion au serveur impossible. La tâche n'a pas été créée.");
        return null;
      }
    },
    [afterMutation, store],
  );

  const remove = useCallback(
    async (task: TaskItem) => {
      const snapshot = { ...store.state.tasks };
      store.removeTasks([task.id]);
      const result = await run(() => deleteTaskAction(task.id));
      if (!result) {
        store.set({ tasks: snapshot });
        return false;
      }
      if (task.parentId) {
        const parent = store.state.tasks[task.parentId];
        if (parent) store.patchTask(parent.id, { subtaskCount: Math.max(0, parent.subtaskCount - 1), subtaskDoneCount: Math.max(0, parent.subtaskDoneCount - (task.status === "DONE" ? 1 : 0)) });
      }
      store.toast("success", "Tâche supprimée.");
      return true;
    },
    [run, store],
  );

  const duplicate = useCallback(
    async (task: TaskItem) => {
      const copy = await run(() => duplicateTaskAction(task.id, true), "Tâche dupliquée.");
      if (copy) store.upsertTasks([copy]);
      return copy;
    },
    [run, store],
  );

  const move = useCallback(
    async (task: TaskItem, projectId: string, sectionId: string | null, beforeId?: string | null, afterId?: string | null, position?: number) => {
      const others = task.memberships.filter((m) => m.projectId !== projectId);
      const optimistic = { memberships: [...others, { projectId, sectionId, position: position ?? task.memberships.find((m) => m.projectId === projectId)?.position ?? Number.MAX_SAFE_INTEGER }] };
      const result = await mutateTask(task.id, optimistic, async () => {
        const res = await moveTaskAction({ taskId: task.id, projectId, sectionId, beforeId, afterId });
        if (!res.ok) return res;
        if (res.data.renumbered) {
          for (const entry of res.data.renumbered) {
            const t = store.state.tasks[entry.taskId];
            if (t) store.patchTask(t.id, { memberships: t.memberships.map((m) => (m.projectId === projectId ? { ...m, position: entry.position } : m)) });
          }
        }
        return { ok: true, data: res.data.task };
      });
      return result;
    },
    [mutateTask, store],
  );

  const addToProject = useCallback(
    (task: TaskItem, projectId: string, sectionId: string | null) =>
      mutateTask(task.id, { memberships: [...task.memberships, { projectId, sectionId, position: Number.MAX_SAFE_INTEGER }] }, () =>
        addTaskToProjectAction(task.id, projectId, sectionId),
      ),
    [mutateTask],
  );

  const removeFromProject = useCallback(
    (task: TaskItem, projectId: string) =>
      mutateTask(task.id, { memberships: task.memberships.filter((m) => m.projectId !== projectId) }, () =>
        removeTaskFromProjectAction(task.id, projectId),
      ),
    [mutateTask],
  );

  const setTags = useCallback(
    (task: TaskItem, tagIds: string[]) => mutateTask(task.id, { tagIds }, () => setTaskTagsAction(task.id, tagIds)),
    [mutateTask],
  );

  const setCustom = useCallback(
    (task: TaskItem, fieldId: string, value: CustomFieldValue) =>
      mutateTask(task.id, { custom: { ...task.custom, [fieldId]: value } }, () => setCustomFieldValueAction(task.id, fieldId, value)),
    [mutateTask],
  );

  const copyLink = useCallback(
    async (task: TaskItem) => {
      const url = `${window.location.origin}/tasks/t/${task.id}`;
      try {
        await navigator.clipboard.writeText(url);
        store.toast("success", "Lien copié dans le presse-papiers.");
      } catch {
        store.toast("info", url);
      }
    },
    [store],
  );

  const bulkUpdate = useCallback(
    async (tasks: TaskItem[], patch: TaskPatch) => {
      const snapshot = tasks.map((t) => ({ ...t }));
      for (const task of tasks) store.patchTask(task.id, patchToItem(patch));
      const result = await run(() => bulkUpdateAction(tasks.map((t) => t.id), patch));
      if (!result) {
        store.upsertTasks(snapshot);
        return;
      }
      store.upsertTasks(result.updated);
      const failed = snapshot.filter((t) => result.failed.some((f) => f.id === t.id));
      if (failed.length) {
        store.upsertTasks(failed);
        store.toast("error", `${failed.length} tâche(s) non modifiée(s) : ${result.failed[0].error}`);
      } else {
        store.toast("success", `${result.updated.length} tâche(s) modifiée(s).`);
      }
    },
    [run, store],
  );

  const bulkDelete = useCallback(
    async (tasks: TaskItem[]) => {
      const snapshot = { ...store.state.tasks };
      store.removeTasks(tasks.map((t) => t.id));
      const result = await run(() => bulkDeleteAction(tasks.map((t) => t.id)));
      if (!result) {
        store.set({ tasks: snapshot });
        return;
      }
      if (result.failed.length) {
        const restore = tasks.filter((t) => result.failed.some((f) => f.id === t.id));
        store.upsertTasks(restore);
        store.toast("error", `${result.failed.length} tâche(s) non supprimée(s) : ${result.failed[0].error}`);
      } else {
        store.toast("success", `${result.deleted.length} tâche(s) supprimée(s).`);
      }
    },
    [run, store],
  );

  const bulkMove = useCallback(
    async (tasks: TaskItem[], projectId: string, sectionId: string | null) => {
      const result = await run(() => bulkMoveAction(tasks.map((t) => t.id), projectId, sectionId));
      if (!result) return;
      store.upsertTasks(result.updated);
      if (result.failed.length) store.toast("error", `${result.failed.length} tâche(s) non déplacée(s) : ${result.failed[0].error}`);
      else store.toast("success", `${result.updated.length} tâche(s) déplacée(s).`);
    },
    [run, store],
  );

  return { update, toggleComplete, create, remove, duplicate, move, addToProject, removeFromProject, setTags, setCustom, copyLink, bulkUpdate, bulkDelete, bulkMove };
}

export type TaskOps = ReturnType<typeof useTaskOps>;
