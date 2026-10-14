"use client";

import {
  Ban,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  GripVertical,
  MessageSquare,
  Paperclip,
  Plus,
  Repeat,
  CornerDownRight,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties } from "react";

import { moveSubtaskAction } from "@/app/(app)/tasks/work-actions";

import { STATUS_LABELS } from "@/lib/tasks/constants";
import { minutesLabel, parseDuration, shortDate } from "@/lib/tasks/format";
import type { TaskGroup } from "@/lib/tasks/query-engine";
import type { CustomFieldDef, SectionItem, TaskItem, TaskPatch } from "@/lib/tasks/types";

import { NAME_MIN, type ColumnDef } from "./columns";
import { dropIndicator, useDragAndDrop, type DragItem, type DropTarget } from "./drag";
import {
  CustomFieldEditor,
  DatePicker,
  MiniCalendar,
  PriorityPicker,
  StatusPicker,
  TagList,
  TagPickerPanel,
  UserPicker,
  useToday,
} from "./pickers";
import { useWork, useWorkApi } from "./store";
import { useTaskMenu } from "./task-menu";
import { useTaskOps, type TaskOps } from "./task-ops";
import {
  ApprovalBadge,
  Avatar,
  ColorChip,
  CompleteToggle,
  ConfirmModal,
  DueText,
  ICON_BTN,
  InlineText,
  MenuButton,
  Popover,
  ProjectIcon,
  useContextMenu,
  useUser,
  type MenuEntry,
} from "./ui";

export interface SectionHandlers {
  rename: (section: SectionItem, name: string) => void;
  remove: (section: SectionItem) => void;
  addAfter: (section: SectionItem | null) => void;
  move: (sectionId: string, beforeId: string | null, afterId: string | null) => void;
}

interface Props {
  groups: TaskGroup[];
  projectId: string | null;
  columns: ColumnDef[];
  widths: Record<string, number>;
  onResize: (columnId: string, width: number) => void;
  /** Ordre manuel + regroupement par section + droits : glisser-déposer actif. */
  canReorder: boolean;
  canEditProject: boolean;
  groupBySection: boolean;
  sections?: SectionItem[];
  sectionHandlers?: SectionHandlers;
  onQuickAdd: (group: TaskGroup, title: string) => Promise<void>;
  emptyLabel?: string;
  fields: CustomFieldDef[];
  /** Ligne « Ajouter une tâche » sous chaque groupe (désactivée en recherche). */
  allowQuickAdd?: boolean;
}

const PAGE = 150;
const ROW_STYLE: CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 36px" };

export function TaskTable({
  groups,
  projectId,
  columns,
  widths,
  onResize,
  canReorder,
  canEditProject,
  groupBySection,
  sections,
  sectionHandlers,
  onQuickAdd,
  emptyLabel,
  fields,
  allowQuickAdd = true,
}: Props) {
  const ops = useTaskOps();
  const menu = useTaskMenu(ops, projectId);
  const context = useContextMenu();
  const { openTask, mutateTask } = useWorkApi();
  const allTasks = useWork((s) => s.tasks);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const lastClicked = useRef<string | null>(null);
  const panelTaskId = useSearchParams().get("task");

  const subtasksOf = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of Object.values(allTasks)) {
      if (!task.parentId) continue;
      const list = map.get(task.parentId) ?? [];
      list.push(task);
      map.set(task.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.subtaskPosition - b.subtaskPosition);
    return map;
  }, [allTasks]);

  const flatIds = useMemo(() => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.tasks.map((t) => t.id))), [groups, collapsed]);

  // La sélection ne garde que des tâches encore affichées.
  const selected = useMemo(() => {
    const visible = new Set(flatIds);
    const next = new Set([...rawSelected].filter((id) => visible.has(id) || allTasks[id]?.parentId));
    return next.size === rawSelected.size ? rawSelected : next;
  }, [rawSelected, flatIds, allTasks]);

  const template = useMemo(
    () => `minmax(${NAME_MIN}px, 1fr) ${columns.map((c) => `${widths[c.id] ?? c.width}px`).join(" ")} 36px`,
    [columns, widths],
  );
  const minWidth = NAME_MIN + columns.reduce((sum, c) => sum + (widths[c.id] ?? c.width), 0) + 36 + 40;

  // ── Glisser-déposer des tâches et des sections ──
  const dnd = useDragAndDrop({
    accepts: (item, target) => {
      if (item.type === "section") return target.type === "section";
      if (item.type === "subtask") return target.type === "subtask" && target.data.parent === allTasks[item.id]?.parentId;
      return target.type === "row" || target.type === "group";
    },
    onDrop: (item, target) => {
      if (item.type === "section") {
        if (!sectionHandlers || !sections) return;
        const order = [...sections].sort((a, b) => a.position - b.position).filter((s) => s.id !== item.id);
        const index = order.findIndex((s) => s.id === target.id);
        const insertAt = target.position === "after" ? index + 1 : index;
        sectionHandlers.move(item.id, order[insertAt - 1]?.id ?? null, order[insertAt]?.id ?? null);
        return;
      }
      if (item.type === "subtask") {
        const parent = allTasks[item.id]?.parentId;
        const siblings = (parent ? subtasksOf.get(parent) ?? [] : []).filter((t) => t.id !== item.id);
        const index = siblings.findIndex((t) => t.id === target.id);
        const insertAt = target.position === "after" ? index + 1 : index;
        const before = siblings[insertAt - 1] ?? null;
        const after = siblings[insertAt] ?? null;
        const position = before && after ? (before.subtaskPosition + after.subtaskPosition) / 2 : before ? before.subtaskPosition + 1024 : after ? after.subtaskPosition - 1024 : 1024;
        void mutateTask(item.id, { subtaskPosition: position }, () => moveSubtaskAction(item.id, before?.id ?? null, after?.id ?? null));
        return;
      }
      if (!projectId) return;
      const moving = (item.ids ?? [item.id]).map((id) => allTasks[id]).filter(Boolean);
      const group = target.type === "group" ? groups.find((g) => g.key === target.id) : groups.find((g) => g.tasks.some((t) => t.id === target.id));
      if (!group) return;
      const list = group.tasks.filter((t) => !moving.some((m) => m.id === t.id));
      let index = target.type === "group" ? list.length : list.findIndex((t) => t.id === target.id);
      if (target.position === "after") index += 1;
      const sectionId = group.sectionId ?? null;
      let before = list[index - 1] ?? null;
      const after = list[index] ?? null;
      const pos = (t: TaskItem | null) => t?.memberships.find((m) => m.projectId === projectId)?.position ?? null;
      for (const task of moving) {
        const a = pos(before);
        const b = pos(after);
        const position = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1024 : b !== null ? b - 1024 : 1024;
        void ops.move(task, projectId, sectionId, before?.id ?? null, after?.id ?? null, position);
        before = { ...task, memberships: [{ projectId, sectionId, position }] };
      }
    },
  });

  const toggleSelect = useCallback(
    (taskId: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, forceToggle = false) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (event.shiftKey && lastClicked.current) {
          const a = flatIds.indexOf(lastClicked.current);
          const b = flatIds.indexOf(taskId);
          if (a !== -1 && b !== -1) {
            for (const id of flatIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
            return next;
          }
        }
        if (forceToggle || event.metaKey || event.ctrlKey) {
          if (next.has(taskId)) next.delete(taskId);
          else next.add(taskId);
        } else {
          next.clear();
          next.add(taskId);
        }
        return next;
      });
      lastClicked.current = taskId;
    },
    [flatIds],
  );

  const focusRow = (taskId: string) => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-id="${taskId}"]`)?.focus());
  };

  const moveByKeyboard = (task: TaskItem, delta: -1 | 1) => {
    if (!projectId || !canReorder) return;
    const group = groups.find((g) => g.tasks.some((t) => t.id === task.id));
    if (!group) return;
    const index = group.tasks.findIndex((t) => t.id === task.id);
    const target = group.tasks[index + delta];
    if (!target) return;
    const list = group.tasks.filter((t) => t.id !== task.id);
    const targetIndex = list.findIndex((t) => t.id === target.id) + (delta === 1 ? 1 : 0);
    const before = list[targetIndex - 1] ?? null;
    const after = list[targetIndex] ?? null;
    const pos = (t: TaskItem | null) => t?.memberships.find((m) => m.projectId === projectId)?.position ?? null;
    const a = pos(before);
    const b = pos(after);
    const position = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1024 : b !== null ? b - 1024 : 1024;
    void ops.move(task, projectId, group.sectionId ?? null, before?.id ?? null, after?.id ?? null, position);
    focusRow(task.id);
  };

  const onRowKey = (event: React.KeyboardEvent, task: TaskItem) => {
    if (event.target !== event.currentTarget) return;
    const index = flatIds.indexOf(task.id);
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (task.canEdit) void ops.toggleComplete(task);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openTask(task.id);
    } else if (event.key === " ") {
      event.preventDefault();
      toggleSelect(task.id, { shiftKey: event.shiftKey, metaKey: true, ctrlKey: false }, true);
    } else if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      moveByKeyboard(task, 1);
    } else if (event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      moveByKeyboard(task, -1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatIds[index + 1]) focusRow(flatIds[index + 1]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatIds[index - 1]) focusRow(flatIds[index - 1]);
    } else if (event.key === "Delete" && task.canManage) {
      event.preventDefault();
      menu.askDelete(task);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      context.open({ clientX: rect.left + 40, clientY: rect.bottom, preventDefault: () => event.preventDefault() }, menu.items(task, { x: rect.left + 40, y: rect.bottom }));
    }
  };

  const selectedTasks = [...selected].map((id) => allTasks[id]).filter((t): t is TaskItem => Boolean(t));

  return (
    <div className="relative min-h-0 flex-1">
      <div data-scroll className="h-full overflow-auto pb-24" role="grid" aria-label="Liste des tâches" aria-multiselectable="true">
        <div style={{ minWidth }}>
          {/* En-tête de colonnes */}
          <div role="row" className="sticky top-0 z-[5] grid border-b border-border-subtle bg-surface text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: template, paddingLeft: 40 }}>
            <div role="columnheader" className="px-2 py-2">Nom</div>
            {columns.map((column) => (
              <ColumnHeader key={column.id} column={column} width={widths[column.id] ?? column.width} onResize={onResize} />
            ))}
            <div />
          </div>

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            const section = groupBySection && group.sectionId ? sections?.find((s) => s.id === group.sectionId) : undefined;
            const limit = limits[group.key] ?? PAGE;
            const visible = group.tasks.slice(0, limit);
            const doneCount = group.tasks.filter((t) => t.status === "DONE").length;
            return (
              <section key={group.key} aria-label={group.label} className="border-b border-border-subtle/60">
                {/* En-tête de groupe / section */}
                <div
                  data-drop={section ? "section" : undefined}
                  data-drop-id={section?.id}
                  className={`group/section sticky top-[33px] z-[4] flex items-center gap-1 bg-bg/95 py-1.5 pl-2 pr-3 backdrop-blur-sm ${section ? dropIndicator(dnd.over, "section", section.id) : ""}`}
                >
                  {section && canEditProject && sectionHandlers ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Déplacer la section ${section.name}`}
                      onPointerDown={(e) => dnd.start(e, { type: "section", id: section.id, label: section.name })}
                      className="cursor-grab touch-none text-muted opacity-0 group-hover/section:opacity-100"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Déplier ${group.label}` : `Replier ${group.label}`}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    className={ICON_BTN}
                  >
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {section && canEditProject && sectionHandlers ? (
                    <InlineText
                      value={section.name}
                      label="Nom de la section"
                      onSave={(name) => sectionHandlers.rename(section, name)}
                      className="text-[14px] font-semibold"
                      inputClassName="max-w-xs py-0.5 text-[14px] font-semibold text-ink"
                    />
                  ) : (
                    <h3 className="px-1 text-[14px] font-semibold text-ink">{group.label}</h3>
                  )}
                  <span className="ml-1 text-[12px] tabular-nums text-muted">
                    {group.tasks.length}
                    {doneCount > 0 && doneCount < group.tasks.length && ` · ${doneCount} terminée(s)`}
                  </span>
                  <span className="flex-1" />
                  {section && canEditProject && sectionHandlers && (
                    <MenuButton
                      label={`Actions de la section ${section.name}`}
                      className={`${ICON_BTN} opacity-0 focus:opacity-100 group-hover/section:opacity-100`}
                      items={[
                        { label: "Ajouter une section en dessous", onSelect: () => sectionHandlers.addAfter(section) },
                        { label: "Supprimer la section", danger: true, onSelect: () => sectionHandlers.remove(section) },
                      ]}
                    >
                      <Ellipsis className="h-4 w-4" />
                    </MenuButton>
                  )}
                </div>

                {!isCollapsed && (
                  <div role="rowgroup" data-drop="group" data-drop-id={group.key} data-drop-mode={group.tasks.length === 0 ? "zone" : undefined} className={group.tasks.length === 0 ? `min-h-2 ${dropIndicator(dnd.over, "group", group.key)}` : ""}>
                    {visible.map((task) => (
                      <TaskRowBlock
                        key={task.id}
                        task={task}
                        template={template}
                        columns={columns}
                        fields={fields}
                        projectId={projectId}
                        selected={selected.has(task.id)}
                        selectionActive={selected.size > 0}
                        active={panelTaskId === task.id}
                        expanded={expanded.has(task.id)}
                        subtasks={subtasksOf.get(task.id)}
                        onToggleExpand={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          })
                        }
                        onSelect={toggleSelect}
                        onKey={onRowKey}
                        onContext={(e, t) => context.open(e, menu.items(t, { x: e.clientX, y: e.clientY }))}
                        menuItems={menu.items}
                        dnd={dnd}
                        canDrag={canReorder}
                        selectedIds={selected}
                        ops={ops}
                      />
                    ))}
                    {group.tasks.length > limit && (
                      <button type="button" onClick={() => setLimits((l) => ({ ...l, [group.key]: limit + PAGE }))} className="ml-10 py-2 text-[12px] font-medium text-accent hover:underline">
                        Afficher {Math.min(PAGE, group.tasks.length - limit)} tâche(s) de plus ({group.tasks.length - limit} restantes)
                      </button>
                    )}
                    {allowQuickAdd && (canEditProject || !projectId) && <QuickAdd onSubmit={(title) => onQuickAdd(group, title)} />}
                  </div>
                )}
              </section>
            );
          })}

          {groupBySection && canEditProject && sectionHandlers && (
            <button type="button" onClick={() => sectionHandlers.addAfter(null)} className="m-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted hover:bg-surface-muted hover:text-ink">
              <Plus className="h-4 w-4" /> Ajouter une section
            </button>
          )}
          {groups.length === 0 && emptyLabel && <p className="px-10 py-10 text-[13px] text-muted">{emptyLabel}</p>}
        </div>
      </div>

      {selectedTasks.length > 0 && (
        <BulkBar tasks={selectedTasks} projectId={projectId} sections={sections} ops={ops} onClear={() => setSelected(new Set())} />
      )}
      {dnd.overlay}
      {context.element}
      {menu.element}
    </div>
  );
}

/* ─── En-tête de colonne redimensionnable ─────────────────────────────────── */

function ColumnHeader({ column, width, onResize }: { column: ColumnDef; width: number; onResize: (id: string, w: number) => void }) {
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const move = (e: PointerEvent) => onResize(column.id, Math.max(column.min, Math.min(600, width + e.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div role="columnheader" className="relative flex items-center border-l border-border-subtle/60 px-2 py-2">
      <span className="truncate">{column.label}</span>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Redimensionner la colonne ${column.label}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onResize(column.id, Math.max(column.min, width - 16));
          if (e.key === "ArrowRight") onResize(column.id, Math.min(600, width + 16));
        }}
        onPointerDown={startResize}
        className="absolute -right-1 top-0 z-[1] h-full w-2 cursor-col-resize touch-none hover:bg-accent/40 focus:bg-accent/40"
      />
    </div>
  );
}

/* ─── Ligne de tâche ──────────────────────────────────────────────────────── */

interface RowProps {
  task: TaskItem;
  template: string;
  columns: ColumnDef[];
  fields: CustomFieldDef[];
  projectId: string | null;
  selected: boolean;
  selectionActive: boolean;
  active: boolean;
  expanded: boolean;
  subtasks: TaskItem[] | undefined;
  onToggleExpand: () => void;
  onSelect: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, force?: boolean) => void;
  onKey: (e: React.KeyboardEvent, task: TaskItem) => void;
  onContext: (e: React.MouseEvent, task: TaskItem) => void;
  menuItems: (task: TaskItem, point?: { x: number; y: number }) => MenuEntry[];
  dnd: ReturnType<typeof useDragAndDrop>;
  canDrag: boolean;
  selectedIds: Set<string>;
  ops: TaskOps;
}

function TaskRowBlock(props: RowProps) {
  const { task, expanded, subtasks } = props;
  const [adding, setAdding] = useState(false);
  return (
    <>
      <TaskRow {...props} />
      {expanded && (
        <div role="rowgroup" aria-label={`Sous-tâches de ${task.title}`}>
          {(subtasks ?? []).map((sub) => (
            <TaskRow {...props} key={sub.id} task={sub} depth={1} expanded={false} subtasks={undefined} selected={props.selectedIds.has(sub.id)} />
          ))}
          {task.canEdit &&
            (adding ? (
              <QuickAdd
                depth={1}
                autoFocus
                onCancel={() => setAdding(false)}
                onSubmit={async (title) => {
                  await props.ops.create({ title, parentId: task.id });
                }}
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="ml-[72px] flex items-center gap-1 py-1 text-[12px] text-muted hover:text-ink">
                <Plus className="h-3.5 w-3.5" /> Ajouter une sous-tâche
              </button>
            ))}
        </div>
      )}
    </>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  template,
  columns,
  fields,
  projectId,
  selected,
  selectionActive,
  active,
  expanded,
  onToggleExpand,
  onSelect,
  onKey,
  onContext,
  menuItems,
  dnd,
  canDrag,
  selectedIds,
  ops,
  depth = 0,
}: RowProps & { depth?: number }) {
  const { openTask } = useWorkApi();
  const done = task.status === "DONE";
  const isSub = depth > 0;
  const dragType = isSub ? "subtask" : "row";
  const draggable = isSub ? task.canEdit : canDrag && task.canEdit;
  const update = (patch: TaskPatch) => void ops.update(task, patch);

  return (
    <div
      role="row"
      tabIndex={0}
      data-row-id={task.id}
      aria-selected={selected}
      data-drop={dragType}
      data-drop-id={task.id}
      data-parent={task.parentId ?? undefined}
      onKeyDown={(e) => onKey(e, task)}
      onContextMenu={(e) => onContext(e, task)}
      onPointerDown={(e) => {
        if (draggable && e.pointerType !== "touch") {
          const ids = selectedIds.has(task.id) && selectedIds.size > 1 ? [...selectedIds] : undefined;
          dnd.start(e, { type: dragType, id: task.id, label: task.title, ids } satisfies DragItem);
        }
      }}
      onClick={(e) => {
        if (dnd.wasDragged()) return;
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect(task.id, e);
          return;
        }
        const target = e.target as HTMLElement;
        if (target.closest("button, input, a, [role='checkbox'], textarea")) return;
        openTask(task.id);
      }}
      style={ROW_STYLE}
      className={`group/row relative grid min-h-9 cursor-default border-b border-border-subtle/50 text-[13px] outline-none transition-colors focus-visible:bg-accent-soft/60 ${
        selected ? "bg-accent-soft" : active ? "bg-surface-muted" : "bg-surface hover:bg-surface-muted/60"
      } ${dnd.dragging?.id === task.id ? "opacity-40" : ""} ${dropIndicator(dnd.over, dragType, task.id)}`}
    >
      <div className="absolute inset-y-0 left-0 flex w-10 items-center justify-end gap-0.5 pr-1">
        {draggable && (
          <span
            aria-hidden
            onPointerDown={(e) => {
              e.stopPropagation();
              dnd.start(e, { type: dragType, id: task.id, label: task.title });
            }}
            className="cursor-grab touch-none text-muted opacity-0 group-hover/row:opacity-100"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        <input
          type="checkbox"
          aria-label={`Sélectionner « ${task.title} »`}
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(task.id, { shiftKey: (e.nativeEvent as MouseEvent).shiftKey, metaKey: true, ctrlKey: false }, true)}
          className={`h-3.5 w-3.5 accent-[var(--nod-accent)] ${selected || selectionActive ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover/row:opacity-100"}`}
        />
      </div>
      <div style={{ gridTemplateColumns: template, paddingLeft: 40 }} className="col-span-full grid items-center">
        {/* Nom */}
        <div role="gridcell" className="flex min-w-0 items-center gap-1.5 py-1 pr-2" style={{ paddingLeft: 4 + depth * 28 }}>
          {!isSub && task.subtaskCount > 0 ? (
            <button type="button" aria-expanded={expanded} aria-label={expanded ? "Masquer les sous-tâches" : "Afficher les sous-tâches"} onClick={onToggleExpand} className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-muted hover:text-ink">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-5 shrink-0">{isSub && <CornerDownRight className="h-3 w-3 text-muted/60" />}</span>
          )}
          <CompleteToggle done={done} disabled={!task.canEdit || task.id.startsWith("tmp-")} onToggle={() => void ops.toggleComplete(task)} label={task.title} milestone={task.isMilestone} />
          <div className={`min-w-0 flex-1 ${done ? "text-muted line-through decoration-muted/60" : "text-ink"}`}>
            <InlineText value={task.title} label="Nom de la tâche" disabled={!task.canEdit} onSave={(title) => update({ title })} className="block truncate px-1" inputClassName="truncate py-0.5" />
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
            {task.openBlockerCount > 0 && (
              <span title={`Bloquée par ${task.openBlockerCount} tâche(s)`} className="inline-flex items-center gap-0.5 text-critical-fg">
                <Ban className="h-3 w-3" />
              </span>
            )}
            {task.isApproval && <ApprovalBadge status={task.approvalStatus} />}
            {task.recurrence && <Repeat aria-label="Tâche récurrente" className="h-3 w-3" />}
            {task.subtaskCount > 0 && (
              <button type="button" onClick={onToggleExpand} className="tabular-nums hover:text-ink" aria-label={`${task.subtaskDoneCount} sur ${task.subtaskCount} sous-tâches terminées`}>
                {task.subtaskDoneCount}/{task.subtaskCount}
              </button>
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
          </span>
          <button type="button" onClick={() => openTask(task.id)} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted opacity-0 hover:bg-surface-muted hover:text-ink focus:opacity-100 group-hover/row:opacity-100">
            Détails <ChevronRight className="inline h-3 w-3" />
          </button>
        </div>
        {columns.map((column) => (
          <div key={column.id} role="gridcell" className="flex h-full min-w-0 items-center border-l border-border-subtle/40 px-2">
            <Cell column={column} task={task} fields={fields} update={update} ops={ops} projectId={projectId} />
          </div>
        ))}
        <div role="gridcell" className="flex items-center justify-center">
          <MenuButton label={`Actions pour « ${task.title} »`} items={() => menuItems(task)} className={`${ICON_BTN} opacity-0 focus:opacity-100 group-hover/row:opacity-100`}>
            <Ellipsis className="h-4 w-4" />
          </MenuButton>
        </div>
      </div>
    </div>
  );
});

/* ─── Cellules éditables ──────────────────────────────────────────────────── */

const CELL_BTN = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent";

function AssigneeCell({ task, update }: { task: TaskItem; update: (p: TaskPatch) => void }) {
  const user = useUser(task.assigneeId);
  return (
    <UserPicker value={task.assigneeId} onChange={(assigneeId) => update({ assigneeId })} disabled={!task.canEdit} className={CELL_BTN}>
      <Avatar user={user} size={20} />
      <span className={`truncate ${user ? "text-ink" : "text-muted/60"}`}>{user?.name ?? ""}</span>
    </UserPicker>
  );
}

function StartCell({ task, update, today }: { task: TaskItem; update: (p: TaskPatch) => void; today: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={!task.canEdit} aria-label="Date de début" onClick={() => setOpen((v) => !v)} className={CELL_BTN}>
        <span className="text-[12px] text-muted">{task.startDate ? shortDate(task.startDate, today) : ""}</span>
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Date de début">
        <div className="w-64 p-3">
          <MiniCalendar
            value={task.startDate}
            today={today}
            onPick={(key) => {
              setOpen(false);
              update(task.dueDate && key > task.dueDate ? { startDate: key, dueDate: key } : { startDate: key });
            }}
          />
          <button type="button" className="mt-2 text-[12px] text-muted hover:text-ink" onClick={() => { setOpen(false); update({ startDate: null }); }}>
            Effacer
          </button>
        </div>
      </Popover>
    </>
  );
}

function TagsCell({ task, ops }: { task: TaskItem; ops: TaskOps }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={!task.canEdit} aria-label="Tags" onClick={() => setOpen((v) => !v)} className={`${CELL_BTN} overflow-hidden`}>
        <TagList ids={task.tagIds} max={2} />
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Tags">
        <TagPickerPanel value={task.tagIds} onChange={(ids) => void ops.setTags(task, ids)} />
      </Popover>
    </>
  );
}

function ProjectsCell({ task }: { task: TaskItem }) {
  const projects = useWork((s) => s.context?.projects ?? []);
  const list = task.memberships.map((m) => projects.find((p) => p.id === m.projectId)).filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {list.slice(0, 2).map((p) => (
        <ColorChip key={p!.id} color={p!.color}>
          <ProjectIcon icon={p!.icon} color={p!.color} size={12} />
          <span className="truncate">{p!.name}</span>
        </ColorChip>
      ))}
      {list.length > 2 && <span className="text-[11px] text-muted">+{list.length - 2}</span>}
    </span>
  );
}

function EstimateCell({ task, update }: { task: TaskItem; update: (p: TaskPatch) => void }) {
  return (
    <InlineText
      value={task.estimatedMinutes ? minutesLabel(task.estimatedMinutes) : ""}
      placeholder=""
      label="Temps estimé"
      disabled={!task.canEdit}
      onSave={(text) => {
        const minutes = parseDuration(text.replace(/\s/g, ""));
        if (minutes !== null) update({ estimatedMinutes: minutes });
      }}
      className="text-[12px] tabular-nums text-muted"
      inputClassName="text-[12px] tabular-nums"
      maxLength={12}
    />
  );
}

function Cell({ column, task, fields, update, ops }: { column: ColumnDef; task: TaskItem; fields: CustomFieldDef[]; update: (p: TaskPatch) => void; ops: TaskOps; projectId: string | null }) {
  const today = useToday();
  switch (column.id) {
    case "assignee":
      return <AssigneeCell task={task} update={update} />;
    case "due":
      return (
        <DatePicker
          value={{ dueDate: task.dueDate, startDate: task.startDate, dueTime: task.dueTime }}
          onChange={(v) => update({ dueDate: v.dueDate, startDate: v.startDate, dueTime: v.dueTime })}
          disabled={!task.canEdit}
          className={CELL_BTN}
          label="Échéance"
          recurrence={task.recurrence}
          onRecurrence={(recurrence) => update({ recurrence })}
        >
          <DueText due={task.dueDate} time={task.dueTime} done={task.status === "DONE"} today={today} />
        </DatePicker>
      );
    case "start":
      return <StartCell task={task} update={update} today={today} />;
    case "status":
      return <StatusPicker value={task.status} onChange={(status) => update({ status })} disabled={!task.canEdit} className={CELL_BTN} />;
    case "priority":
      return <PriorityPicker value={task.priority} onChange={(priority) => update({ priority })} disabled={!task.canEdit} className={CELL_BTN} />;
    case "tags":
      return <TagsCell task={task} ops={ops} />;
    case "projects":
      return <ProjectsCell task={task} />;
    case "estimate":
      return <EstimateCell task={task} update={update} />;
    case "spent":
      return <span className="text-[12px] tabular-nums text-muted">{task.spentMinutes ? minutesLabel(task.spentMinutes) : ""}</span>;
    case "created":
      return <span className="text-[12px] text-muted">{shortDate(task.createdAt.slice(0, 10), today)}</span>;
    default: {
      if (!column.id.startsWith("field:")) return null;
      const field = fields.find((f) => f.id === column.id.slice(6));
      if (!field) return null;
      return <CustomFieldEditor field={field} value={task.custom[field.id]} onChange={(value) => void ops.setCustom(task, field.id, value)} disabled={!task.canEdit} anchorClassName={CELL_BTN} />;
    }
  }
}

/* ─── Ajout rapide ────────────────────────────────────────────────────────── */

export function QuickAdd({
  onSubmit,
  depth = 0,
  autoFocus = false,
  onCancel,
  placeholder = "Ajouter une tâche…",
}: {
  onSubmit: (title: string) => Promise<unknown> | void;
  depth?: number;
  autoFocus?: boolean;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(autoFocus);
  return (
    <div className="flex items-center gap-2 py-1 pr-3" style={{ paddingLeft: 44 + depth * 28 + 30 }}>
      <Plus className={`h-3.5 w-3.5 shrink-0 ${focused ? "text-accent" : "text-muted/60"}`} />
      <input
        value={value}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (!value.trim()) onCancel?.();
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
            onCancel?.();
          }
          if (e.key === "Enter" && value.trim()) {
            e.preventDefault();
            const title = value.trim();
            setValue("");
            await onSubmit(title);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={300}
        className="w-full bg-transparent py-1 text-[13px] text-ink outline-none placeholder:text-muted/60"
      />
    </div>
  );
}

/* ─── Actions groupées ────────────────────────────────────────────────────── */

function BulkBar({ tasks, projectId, sections, ops, onClear }: { tasks: TaskItem[]; projectId: string | null; sections?: SectionItem[]; ops: TaskOps; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const editable = tasks.filter((t) => t.canEdit);
  const users = useWork((s) => s.context?.users ?? []);
  const today = useToday();
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef<HTMLButtonElement>(null);
  const btn = "rounded-md px-2.5 py-1.5 text-[12px] font-medium text-bg/90 hover:bg-white/10";

  const statusItems: MenuEntry[] = (["TODO", "IN_PROGRESS", "WAITING", "DONE"] as const).map((s) => ({ label: STATUS_LABELS[s], onSelect: () => void ops.bulkUpdate(editable, { status: s }) }));
  const priorityItems: MenuEntry[] = (["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => ({ label: { URGENT: "Urgente", HIGH: "Haute", NORMAL: "Normale", LOW: "Basse" }[p], onSelect: () => void ops.bulkUpdate(editable, { priority: p }) }));
  const assigneeItems: MenuEntry[] = [
    { label: "Personne", onSelect: () => void ops.bulkUpdate(editable, { assigneeId: null }) },
    ...users.filter((u) => u.isActive).map((u) => ({ label: u.name, onSelect: () => void ops.bulkUpdate(editable, { assigneeId: u.id }) })),
  ];
  const sectionItems: MenuEntry[] =
    projectId && sections
      ? [...sections].sort((a, b) => a.position - b.position).map((s) => ({ label: s.name, onSelect: () => void ops.bulkMove(editable.filter((t) => !t.parentId), projectId, s.id) }))
      : [];

  return (
    <div role="toolbar" aria-label="Actions groupées" className="absolute inset-x-0 bottom-3 z-20 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-xl bg-ink px-2 py-1.5 text-bg shadow-dialog nod-rise">
      <span className="px-2 text-[12px] font-semibold">{tasks.length} sélectionnée(s)</span>
      <button type="button" className={btn} onClick={() => void ops.bulkUpdate(editable, { status: "DONE" })}>
        Terminer
      </button>
      <MenuButton label="Changer le statut" items={statusItems} className={btn} align="start">
        Statut
      </MenuButton>
      <MenuButton label="Changer la priorité" items={priorityItems} className={btn} align="start">
        Priorité
      </MenuButton>
      <MenuButton label="Changer le responsable" items={assigneeItems} className={btn} align="start">
        Responsable
      </MenuButton>
      <button ref={dateRef} type="button" className={btn} onClick={() => setDateOpen(true)}>
        Échéance
      </button>
      <Popover open={dateOpen} anchor={dateRef} onClose={() => setDateOpen(false)} label="Échéance">
        <div className="w-64 p-3">
          <MiniCalendar value={null} today={today} onPick={(key) => { setDateOpen(false); void ops.bulkUpdate(editable, { dueDate: key }); }} />
          <button type="button" className="mt-2 text-[12px] text-muted hover:text-ink" onClick={() => { setDateOpen(false); void ops.bulkUpdate(editable, { dueDate: null }); }}>
            Retirer l&apos;échéance
          </button>
        </div>
      </Popover>
      {sectionItems.length > 0 && (
        <MenuButton label="Déplacer vers une section" items={sectionItems} className={btn} align="start">
          Section
        </MenuButton>
      )}
      <button type="button" className={`${btn} text-red-300`} onClick={() => setConfirm(true)}>
        Supprimer
      </button>
      <button type="button" aria-label="Désélectionner" className={btn} onClick={onClear}>
        ✕
      </button>
      {confirm && (
        <BulkDeleteConfirm
          count={editable.length}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await ops.bulkDelete(editable);
            setConfirm(false);
            onClear();
          }}
        />
      )}
    </div>
  );
}

function BulkDeleteConfirm({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  return (
    <ConfirmInline
      title={`Supprimer ${count} tâche(s) ?`}
      pending={pending}
      onClose={onClose}
      onConfirm={async () => {
        setPending(true);
        await onConfirm();
        setPending(false);
      }}
    />
  );
}

function ConfirmInline({ title, pending, onClose, onConfirm }: { title: string; pending: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmModal open title={title} description="Les tâches, leurs sous-tâches, commentaires et pièces jointes seront supprimés définitivement." confirmLabel={pending ? "Suppression…" : "Supprimer"} onClose={onClose} onConfirm={onConfirm} />
  );
}

export type { DropTarget };
