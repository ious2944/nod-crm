"use client";

import { Ban, Ellipsis, GripVertical, ListChecks, MessageSquare, Paperclip, Plus, Repeat } from "lucide-react";
import { memo, useState } from "react";

import type { TaskGroup } from "@/lib/tasks/query-engine";
import type { SectionItem, TaskItem } from "@/lib/tasks/types";

import { dropIndicator, useDragAndDrop } from "./drag";
import { TagList, useToday } from "./pickers";
import { useWorkApi } from "./store";
import type { SectionHandlers } from "./task-table";
import { useTaskMenu } from "./task-menu";
import { useTaskOps, type TaskOps } from "./task-ops";
import {
  ApprovalBadge,
  Avatar,
  CompleteToggle,
  DueText,
  EmptyBlock,
  ICON_BTN,
  InlineText,
  MenuButton,
  PriorityBadge,
  useContextMenu,
  useUser,
  type MenuEntry,
} from "./ui";

/**
 * Vue Tableau (Kanban). Colonnes = sections du projet, ou statuts. Déposer une
 * carte enregistre sa section (ou son statut) et sa position ; tout est
 * persistant et repris par les autres vues.
 */
export function BoardView({
  groups,
  projectId,
  mode,
  sections,
  sectionHandlers,
  canEdit,
  onQuickAdd,
}: {
  groups: TaskGroup[];
  projectId: string;
  mode: "section" | "status";
  sections: SectionItem[];
  sectionHandlers: SectionHandlers;
  canEdit: boolean;
  onQuickAdd: (group: TaskGroup, title: string) => Promise<void>;
}) {
  const ops = useTaskOps();
  const menu = useTaskMenu(ops, projectId);
  const context = useContextMenu();

  const dnd = useDragAndDrop({
    accepts: (item, target) => (item.type === "column" ? target.type === "column" : target.type === "card" || target.type === "lane"),
    onDrop: (item, target) => {
      if (item.type === "column") {
        const order = [...sections].sort((a, b) => a.position - b.position).filter((s) => s.id !== item.id);
        const index = order.findIndex((s) => s.id === target.id);
        const insertAt = target.position === "after" ? index + 1 : index;
        sectionHandlers.move(item.id, order[insertAt - 1]?.id ?? null, order[insertAt]?.id ?? null);
        return;
      }
      const task = groups.flatMap((g) => g.tasks).find((t) => t.id === item.id);
      if (!task) return;
      const group = target.type === "lane" ? groups.find((g) => g.key === target.id) : groups.find((g) => g.tasks.some((t) => t.id === target.id));
      if (!group) return;
      if (mode === "status") {
        if (group.patch?.status && group.patch.status !== task.status) void ops.update(task, { status: group.patch.status });
        return;
      }
      const list = group.tasks.filter((t) => t.id !== task.id);
      let index = target.type === "lane" ? list.length : list.findIndex((t) => t.id === target.id);
      if (target.position === "after") index += 1;
      const before = list[index - 1] ?? null;
      const after = list[index] ?? null;
      const pos = (t: TaskItem | null) => t?.memberships.find((m) => m.projectId === projectId)?.position ?? null;
      const a = pos(before);
      const b = pos(after);
      const position = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1024 : b !== null ? b - 1024 : 1024;
      void ops.move(task, projectId, group.sectionId ?? null, before?.id ?? null, after?.id ?? null, position);
    },
  });

  if (groups.length === 0) {
    return <EmptyBlock title="Aucune colonne" description="Ajoutez une section pour commencer à organiser les tâches." />;
  }

  return (
    <div data-scroll className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-3 sm:p-4">
      {groups.map((group) => {
        const section = mode === "section" && group.sectionId ? sections.find((s) => s.id === group.sectionId) : undefined;
        return (
          <section
            key={group.key}
            aria-label={group.label}
            data-drop={section ? "column" : undefined}
            data-drop-id={section?.id}
            data-drop-axis="x"
            className={`flex max-h-full w-[280px] shrink-0 flex-col rounded-lg bg-surface-muted/60 ${section ? dropIndicator(dnd.over, "column", section.id) : ""}`}
          >
            <header className="group/col flex items-center gap-1 px-2 pb-1 pt-2">
              {section && canEdit && (
                <span
                  aria-hidden
                  onPointerDown={(e) => dnd.start(e, { type: "column", id: section.id, label: section.name })}
                  className="cursor-grab touch-none text-muted opacity-0 group-hover/col:opacity-100"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              )}
              {section && canEdit ? (
                <InlineText value={section.name} label="Nom de la colonne" onSave={(name) => sectionHandlers.rename(section, name)} className="min-w-0 flex-1 text-[13px] font-semibold" inputClassName="py-0.5 text-[13px] font-semibold text-ink" />
              ) : (
                <h3 className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold text-ink">{group.label}</h3>
              )}
              <span className="text-[12px] tabular-nums text-muted">{group.tasks.length}</span>
              {section && canEdit && (
                <MenuButton
                  label={`Actions de la colonne ${section.name}`}
                  className={`${ICON_BTN} opacity-0 focus:opacity-100 group-hover/col:opacity-100`}
                  items={[
                    { label: "Ajouter une colonne à droite", onSelect: () => sectionHandlers.addAfter(section) },
                    { label: "Supprimer la colonne", danger: true, onSelect: () => sectionHandlers.remove(section) },
                  ]}
                >
                  <Ellipsis className="h-4 w-4" />
                </MenuButton>
              )}
            </header>
            <div data-drop="lane" data-drop-id={group.key} data-drop-mode="zone" className={`min-h-16 flex-1 space-y-2 overflow-y-auto px-2 pb-2 ${group.tasks.length === 0 ? dropIndicator(dnd.over, "lane", group.key) : ""}`}>
              {group.tasks.map((task) => (
                <BoardCard
                  key={task.id}
                  task={task}
                  ops={ops}
                  dnd={dnd}
                  draggable={canEdit && task.canEdit}
                  onContext={(e) => context.open(e, menu.items(task, { x: e.clientX, y: e.clientY }))}
                  menuItems={() => menu.items(task)}
                />
              ))}
              {canEdit && <CardQuickAdd onSubmit={(title) => onQuickAdd(group, title)} />}
            </div>
          </section>
        );
      })}
      {mode === "section" && canEdit && (
        <button type="button" onClick={() => sectionHandlers.addAfter(sections[sections.length - 1] ?? null)} className="flex h-10 w-[240px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-[13px] font-medium text-muted hover:bg-surface-muted hover:text-ink">
          <Plus className="h-4 w-4" /> Ajouter une colonne
        </button>
      )}
      {dnd.overlay}
      {context.element}
      {menu.element}
    </div>
  );
}

const BoardCard = memo(function BoardCard({
  task,
  ops,
  dnd,
  draggable,
  onContext,
  menuItems,
}: {
  task: TaskItem;
  ops: TaskOps;
  dnd: ReturnType<typeof useDragAndDrop>;
  draggable: boolean;
  onContext: (e: React.MouseEvent) => void;
  menuItems: () => MenuEntry[];
}) {
  const { openTask } = useWorkApi();
  const today = useToday();
  const user = useUser(task.assigneeId);
  const done = task.status === "DONE";
  return (
    <article
      tabIndex={0}
      aria-label={task.title}
      data-drop="card"
      data-drop-id={task.id}
      onPointerDown={(e) => draggable && dnd.start(e, { type: "card", id: task.id, label: task.title })}
      onClick={(e) => {
        if (dnd.wasDragged() || (e.target as HTMLElement).closest("button")) return;
        openTask(task.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void ops.toggleComplete(task);
        else if (e.key === "Enter") openTask(task.id);
      }}
      onContextMenu={onContext}
      className={`group/card cursor-pointer select-none rounded-md border border-border-subtle bg-surface p-2.5 shadow-card outline-none transition-shadow hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-accent ${dnd.dragging?.id === task.id ? "opacity-40" : ""} ${dropIndicator(dnd.over, "card", task.id)}`}
      style={{ touchAction: draggable ? "manipulation" : undefined }}
    >
      <div className="flex items-start gap-2">
        <CompleteToggle done={done} disabled={!task.canEdit || task.id.startsWith("tmp-")} onToggle={() => void ops.toggleComplete(task)} label={task.title} size={16} milestone={task.isMilestone} />
        <p className={`min-w-0 flex-1 text-[13px] leading-snug ${done ? "text-muted line-through" : "text-ink"}`}>{task.title}</p>
        <MenuButton label={`Actions pour « ${task.title} »`} items={menuItems} className={`${ICON_BTN} -mr-1 -mt-1 h-6 w-6 opacity-0 focus:opacity-100 group-hover/card:opacity-100`}>
          <Ellipsis className="h-3.5 w-3.5" />
        </MenuButton>
      </div>
      {(task.tagIds.length > 0 || task.priority !== "NORMAL" || task.isApproval) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <PriorityBadge priority={task.priority} compact />
          {task.isApproval && <ApprovalBadge status={task.approvalStatus} />}
          <TagList ids={task.tagIds} max={2} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <Avatar user={user} size={20} />
        <DueText due={task.dueDate} start={task.startDate} time={task.dueTime} done={done} today={today} className="text-[11px]" />
        <span className="flex-1" />
        {task.openBlockerCount > 0 && <Ban aria-label="Bloquée" className="h-3 w-3 text-critical-fg" />}
        {task.recurrence && <Repeat aria-label="Récurrente" className="h-3 w-3" />}
        {task.subtaskCount > 0 && (
          <span className="inline-flex items-center gap-0.5" aria-label={`${task.subtaskDoneCount} sur ${task.subtaskCount} sous-tâches`}>
            <ListChecks className="h-3 w-3" />
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5" aria-label={`${task.commentCount} commentaire(s)`}>
            <MessageSquare className="h-3 w-3" />
            {task.commentCount}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5" aria-label={`${task.attachmentCount} pièce(s) jointe(s)`}>
            <Paperclip className="h-3 w-3" />
            {task.attachmentCount}
          </span>
        )}
      </div>
    </article>
  );
});

function CardQuickAdd({ onSubmit }: { onSubmit: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted hover:bg-surface hover:text-ink">
        <Plus className="h-3.5 w-3.5" /> Ajouter une tâche
      </button>
    );
  }
  return (
    <div className="rounded-md border border-accent bg-surface p-2 shadow-card">
      <textarea
        autoFocus
        rows={2}
        value={value}
        maxLength={300}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!value.trim()) setOpen(false);
        }}
        onKeyDown={async (e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setValue("");
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const title = value.trim();
            if (!title) return;
            setValue("");
            await onSubmit(title);
          }
        }}
        placeholder="Nom de la tâche, puis Entrée"
        aria-label="Nom de la nouvelle tâche"
        className="w-full resize-none bg-transparent text-[13px] text-ink outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
