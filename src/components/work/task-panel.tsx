"use client";

import {
  Ban,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  Clock,

  Diamond,
  Ellipsis,
  ExternalLink,
  FileText,
  FolderInput,
  Link as LinkIcon,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Sparkles,
  Trash,
  Upload,
  X,
} from "lucide-react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addCommentAction,
  addDependencyAction,
  addTimeEntryAction,
  deleteAttachmentAction,
  deleteCommentAction,
  deleteTimeEntryAction,
  editCommentAction,
  removeDependencyAction,
  setFollowerAction,
  setTaskParentAction,
  taskToTemplateAction,
  toggleReactionAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { MAX_ATTACHMENT_BYTES, REACTION_EMOJIS } from "@/lib/tasks/constants";
import { dateConflicts } from "@/lib/tasks/graph";
import { formatBytes, minutesLabel, parseDuration, relativeTime } from "@/lib/tasks/format";
import { describeRecurrence } from "@/lib/tasks/recurrence";
import { toggleChecklistItem } from "@/lib/tasks/rich-text";
import type { ActivityItem, CommentItem, CrmRef, CustomFieldDef, TaskDetail, TaskItem, TaskRef } from "@/lib/tasks/types";

import {
  CRM_LABELS,
  CrmPickerPanel,
  CustomFieldEditor,
  DatePicker,
  PriorityPicker,
  ProjectSectionPanel,
  StatusPicker,
  TagList,
  TagPickerPanel,
  TaskFinderPanel,
  UserPicker,
  UserPickerPanel,
  useToday,
} from "./pickers";
import { RichText, RichTextEditor } from "./rich-text";
import { fetchJson, useWork, useWorkApi } from "./store";
import { useTaskMenu } from "./task-menu";
import { useTaskOps } from "./task-ops";
import {
  ApprovalBadge,
  Avatar,
  AvatarStack,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CompleteToggle,
  DueText,
  ErrorBlock,
  ICON_BTN,
  INPUT,
  InlineText,
  LoadingRows,
  MenuButton,
  Popover,
  ProjectIcon,
  Spinner,
  useUser,
} from "./ui";

export function TaskPanelHost() {
  return (
    <Suspense fallback={null}>
      <PanelFromUrl />
    </Suspense>
  );
}

function PanelFromUrl() {
  const params = useSearchParams();
  const taskId = params.get("task");
  const { ensureContext } = useWorkApi();
  useEffect(() => {
    if (taskId) ensureContext();
  }, [taskId, ensureContext]);
  if (!taskId || !/^[0-9a-f-]{36}$/.test(taskId)) return null;
  return <TaskPanel key={taskId} taskId={taskId} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 py-1">
      <span className="pt-1.5 text-[12px] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const FIELD_BTN = "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] text-ink hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent";

function TaskPanel({ taskId }: { taskId: string }) {
  const { store, closeTask, openTask, run, afterMutation } = useWorkApi();
  const ops = useTaskOps();
  const menu = useTaskMenu(ops, null);
  const today = useToday();
  const context = useWork((s) => s.context);
  const live = useWork((s) => s.tasks[taskId]);
  const remote = useWork((s) => (s.remoteTaskIds.includes(taskId) ? s.remoteTick : 0));
  const allTasks = useWork((s) => s.tasks);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"comments" | "activity" | "time">("comments");
  const [editingDescription, setEditingDescription] = useState(false);
  const editingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<TaskDetail>(`/api/tasks/items/${taskId}`);
      setDetail((prev) => (editingRef.current && prev ? { ...data, description: prev.description } : data));
      store.upsertTasks([data.task, ...data.subtasks], { skipPending: true });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [store, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changement par un autre utilisateur, ou mutation locale qui a fait évoluer la tâche.
  const liveVersion = live?.version;
  useEffect(() => {
    if (remote) void load();
  }, [remote, load]);
  useEffect(() => {
    if (detail && liveVersion !== undefined && liveVersion !== detail.task.version && !store.pending.has(taskId)) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion]);

  // Échap ferme le panneau (sauf depuis un champ ou un menu ouvert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [role='dialog'][aria-label]:not([data-panel])")) return;
      closeTask();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeTask]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const task: TaskItem | undefined = live ?? detail?.task;
  const subtasks = useMemo(
    () => Object.values(allTasks).filter((t) => t.parentId === taskId).sort((a, b) => a.subtaskPosition - b.subtaskPosition),
    [allTasks, taskId],
  );

  const fieldsForTask: CustomFieldDef[] = useMemo(() => {
    if (!context || !task) return [];
    const enabled = new Set<string>();
    for (const m of task.memberships) for (const id of store.state.projects[m.projectId]?.customFieldIds ?? []) enabled.add(id);
    for (const [id, value] of Object.entries(task.custom)) if (value !== null && value !== undefined) enabled.add(id);
    return context.fields.filter((f) => enabled.has(f.id));
  }, [context, task, store.state.projects]);

  if (error && !detail) {
    return (
      <PanelShell onClose={closeTask} panelRef={panelRef}>
        <ErrorBlock message={error} onRetry={() => void load()} />
      </PanelShell>
    );
  }
  if (!detail || !task || !context) {
    return (
      <PanelShell onClose={closeTask} panelRef={panelRef}>
        <LoadingRows rows={8} />
      </PanelShell>
    );
  }

  const canEdit = task.canEdit;
  const update = (patch: Parameters<typeof ops.update>[1]) => void ops.update(task, patch);
  const me = context.me.id;
  const following = detail.followers.some((f) => f.userId === me);
  const allSubtasksDone = task.status !== "DONE" && subtasks.length > 0 && subtasks.every((s) => s.status === "DONE");
  const openBlockers = detail.blockedBy.filter((b) => b.status !== "DONE");
  const conflicts = dateConflicts(task, detail.blockedBy);

  const saveDescription = async (next: string) => {
    const base = detail.description;
    if ((next.trim() || null) === (base?.trim() || null)) return;
    setDetail({ ...detail, description: next });
    const result = await updateTaskAction(task.id, { description: next.trim() ? next : null }, { description: base });
    if (!result.ok) {
      setDetail((d) => (d ? { ...d, description: base } : d));
      store.toast(result.code === "CONFLICT" ? "info" : "error", result.code === "CONFLICT" ? "La description a été modifiée par quelqu'un d'autre entre-temps. La dernière version est affichée ; votre texte n'a pas été enregistré." : result.error);
      if (result.code === "CONFLICT") void load();
      return;
    }
    store.upsertTasks([result.data]);
    afterMutation();
  };

  const refresh = async <T,>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => {
    const result = await run(call, success);
    if (result !== null) await load();
    return result;
  };

  return (
    <PanelShell onClose={closeTask} panelRef={panelRef}>
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => void ops.toggleComplete(task)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
            task.status === "DONE" ? "border-done-fg bg-done-bg text-done-fg" : "border-border-strong text-ink hover:border-done-fg hover:text-done-fg"
          }`}
        >
          <Check className="h-3.5 w-3.5" /> {task.status === "DONE" ? "Terminée" : "Marquer comme terminée"}
        </button>
        {task.isApproval && canEdit && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => update({ approvalStatus: "APPROVED" })} className={`rounded-md px-2 py-1 text-[12px] font-medium ${task.approvalStatus === "APPROVED" ? "bg-done-bg text-done-fg" : "text-muted hover:bg-surface-muted"}`}>
              Approuver
            </button>
            <button type="button" onClick={() => update({ approvalStatus: "CHANGES_REQUESTED" })} className={`rounded-md px-2 py-1 text-[12px] font-medium ${task.approvalStatus === "CHANGES_REQUESTED" ? "bg-late-bg text-late-fg" : "text-muted hover:bg-surface-muted"}`}>
              Demander des modifications
            </button>
            {task.approvalStatus !== "PENDING" && (
              <button type="button" onClick={() => update({ approvalStatus: "PENDING" })} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-surface-muted">
                Remettre à valider
              </button>
            )}
          </div>
        )}
        <span className="flex-1" />
        <AttachButton taskId={task.id} disabled={!canEdit} onUploaded={load} />
        <button type="button" className={ICON_BTN} aria-label="Copier le lien" title="Copier le lien" onClick={() => void ops.copyLink(task)}>
          <LinkIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={ICON_BTN}
          aria-label={following ? "Ne plus suivre" : "Suivre la tâche"}
          title={following ? "Ne plus suivre" : "Suivre la tâche"}
          onClick={() => void refresh(() => setFollowerAction(task.id, me, following ? null : "FOLLOWER"))}
        >
          {following ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </button>
        <MenuButton
          label="Plus d'actions"
          items={() => [
            ...menu.items(task).filter((i) => i.separator || (i.label !== "Ouvrir les détails" && i.label !== "Copier le lien")),
            { separator: true },
            {
              label: "Enregistrer comme modèle",
              icon: FileText,
              onSelect: () => void run(() => taskToTemplateAction(task.id, task.memberships[0]?.projectId ?? null), "Modèle de tâche enregistré."),
            },
            ...(task.parentId
              ? [{ label: "Convertir en tâche indépendante", icon: FolderInput, disabled: !task.canManage, onSelect: () => void refresh(() => setTaskParentAction(task.id, null)) }]
              : []),
          ]}
        >
          <Ellipsis className="h-4 w-4" />
        </MenuButton>
        <NextLink href={`/tasks/t/${task.id}`} className={ICON_BTN} aria-label="Ouvrir en pleine page" title="Lien direct">
          <ExternalLink className="h-4 w-4" />
        </NextLink>
        <button type="button" className={ICON_BTN} aria-label="Fermer le panneau" title="Fermer (Échap)" onClick={closeTask}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 px-5 py-4">
          {!canEdit && <p className="rounded-md bg-surface-muted px-3 py-2 text-[12px] text-muted">Lecture seule : vous pouvez commenter mais pas modifier cette tâche.</p>}
          {canEdit && !task.canManage && <p className="rounded-md bg-surface-muted px-3 py-2 text-[12px] text-muted">Vous pouvez modifier cette tâche, mais seul un éditeur du projet peut la réaffecter, la partager, la déplacer ou la supprimer.</p>}
          {openBlockers.length > 0 && (
            <p className="flex items-center gap-2 rounded-md bg-critical-bg px-3 py-2 text-[12px] text-critical-fg">
              <Ban className="h-3.5 w-3.5" /> Bloquée par {openBlockers.length} tâche(s) non terminée(s).
            </p>
          )}
          {conflicts.length > 0 && (
            <p className="rounded-md bg-late-bg px-3 py-2 text-[12px] text-late-fg">
              Incohérence de dates : cette tâche commence avant la fin d&apos;une tâche qui la bloque.
            </p>
          )}
          {allSubtasksDone && canEdit && (
            <div className="flex items-center gap-3 rounded-md bg-done-bg px-3 py-2 text-[12px] text-done-fg">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="flex-1">Toutes les sous-tâches sont terminées. Terminer cette tâche ?</span>
              <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void ops.toggleComplete(task)}>
                Terminer
              </button>
            </div>
          )}
          {detail.recurrenceNextId && (
            <button type="button" onClick={() => openTask(detail.recurrenceNextId!)} className="flex items-center gap-2 text-[12px] text-accent hover:underline">
              <Repeat className="h-3.5 w-3.5" /> Voir l&apos;occurrence suivante
            </button>
          )}

          {detail.parent && (
            <button type="button" onClick={() => openTask(detail.parent!.id)} className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
              {detail.parent.title} <ChevronRight className="h-3 w-3" />
            </button>
          )}

          <div className="flex items-start gap-2">
            {task.isMilestone && <Diamond aria-label="Jalon" className="mt-2 h-4 w-4 shrink-0 text-accent" />}
            <InlineText
              value={task.title}
              label="Titre de la tâche"
              disabled={!canEdit}
              multiline
              onSave={(title) => update({ title })}
              className="text-[20px] font-semibold"
              inputClassName="resize-none py-1 text-[20px] font-semibold leading-tight text-ink"
            />
          </div>

          {/* Champs */}
          <div className="divide-y divide-border-subtle/0">
            <Row label="Responsable">
              <AssigneeField task={task} disabled={!task.canManage} onChange={(assigneeId) => update({ assigneeId })} />
            </Row>
            <Row label="Dates">
              <DatePicker
                value={{ dueDate: task.dueDate, startDate: task.startDate, dueTime: task.dueTime }}
                onChange={(v) => update({ dueDate: v.dueDate, startDate: v.startDate, dueTime: v.dueTime })}
                disabled={!canEdit}
                className={FIELD_BTN}
                recurrence={task.recurrence}
                onRecurrence={(recurrence) => update({ recurrence })}
              >
                {task.dueDate || task.startDate ? (
                  <DueText due={task.dueDate} start={task.startDate} time={task.dueTime} done={task.status === "DONE"} today={today} className="text-[13px]" />
                ) : (
                  <span className="text-muted">Aucune échéance</span>
                )}
                {task.recurrence && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                    <Repeat className="h-3 w-3" /> {describeRecurrence(task.recurrence)}
                  </span>
                )}
              </DatePicker>
            </Row>
            {!task.parentId && (
              <Row label="Projets">
                <ProjectsField task={task} detail={detail} disabled={!task.canManage} ops={ops} reload={load} />
              </Row>
            )}
            <Row label="Dépendances">
              <DependenciesField task={task} detail={detail} disabled={!canEdit} refresh={refresh} />
            </Row>
            <Row label="Statut">
              <StatusPicker value={task.status} onChange={(status) => update({ status })} disabled={!canEdit} className={FIELD_BTN} />
            </Row>
            <Row label="Priorité">
              <PriorityPicker value={task.priority} onChange={(priority) => update({ priority })} disabled={!canEdit} className={FIELD_BTN} />
            </Row>
            <Row label="Type">
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[13px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" disabled={!canEdit} checked={task.isMilestone} onChange={(e) => update({ isMilestone: e.target.checked })} className="accent-[var(--nod-accent)]" />
                  Jalon
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" disabled={!canEdit} checked={task.isApproval} onChange={(e) => update({ isApproval: e.target.checked })} className="accent-[var(--nod-accent)]" />
                  Validation
                </label>
                {task.isApproval && <ApprovalBadge status={task.approvalStatus} />}
              </div>
            </Row>
            <Row label="Tags">
              <TagsField task={task} disabled={!canEdit} ops={ops} />
            </Row>
            <Row label="Temps">
              <TimeField task={task} detail={detail} disabled={!canEdit} update={update} refresh={refresh} />
            </Row>
            {fieldsForTask.map((field) => (
              <Row key={field.id} label={field.name}>
                <div className="pt-0.5">
                  <CustomFieldEditor field={field} value={task.custom[field.id]} disabled={!canEdit} onChange={(value) => void ops.setCustom(task, field.id, value)} anchorClassName={FIELD_BTN} />
                </div>
              </Row>
            ))}
            {(["contact", "organization", "opportunity"] as const).map((kind) => (
              <Row key={kind} label={CRM_LABELS[kind]}>
                <CrmField kind={kind} value={detail[kind]} disabled={!canEdit} onChange={async (ref) => {
                  const key = `${kind}Id` as "contactId" | "organizationId" | "opportunityId";
                  setDetail({ ...detail, [kind]: ref });
                  await ops.update(task, { [key]: ref?.id ?? null });
                }} />
              </Row>
            ))}
            {detail.followUp && (
              <Row label="Suivi">
                <NextLink href="/follow-ups" className="inline-block truncate pt-1.5 text-[13px] text-accent hover:underline">
                  {detail.followUp.label}
                </NextLink>
              </Row>
            )}
            <Row label="Collaborateurs">
              <FollowersField detail={detail} disabled={!task.canManage} kind="COLLABORATOR" onChange={(userId, on) => refresh(() => setFollowerAction(task.id, userId, on ? "COLLABORATOR" : null))} />
            </Row>
          </div>

          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-muted">Description</h3>
            {editingDescription ? (
              <DescriptionEditor
                initial={detail.description ?? ""}
                onDone={async (next) => {
                  editingRef.current = false;
                  setEditingDescription(false);
                  if (next !== null) await saveDescription(next);
                }}
              />
            ) : (
              <div
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onClick={(e) => {
                  if (!canEdit || (e.target as HTMLElement).closest("a, input")) return;
                  editingRef.current = true;
                  setEditingDescription(true);
                }}
                onKeyDown={(e) => {
                  if (canEdit && e.key === "Enter") {
                    editingRef.current = true;
                    setEditingDescription(true);
                  }
                }}
                className={`min-h-16 rounded-md px-2 py-1.5 ${canEdit ? "cursor-text hover:bg-surface-muted/60" : ""}`}
              >
                {detail.description ? (
                  <RichText source={detail.description} onToggleCheck={canEdit ? (ordinal) => void saveDescription(toggleChecklistItem(detail.description!, ordinal)) : undefined} />
                ) : (
                  <p className="text-[13px] text-muted/70">{canEdit ? "Ajoutez une description, une liste de contrôle, des liens…" : "Aucune description."}</p>
                )}
              </div>
            )}
          </div>

          {/* Sous-tâches */}
          {!task.parentId && <SubtasksBlock parent={task} subtasks={subtasks} disabled={!canEdit} />}

          {/* Pièces jointes */}
          {detail.attachments.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[12px] font-semibold text-muted">Pièces jointes</h3>
              <ul className="space-y-1">
                {detail.attachments.map((a) => (
                  <li key={a.id} className="group flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5">
                    {a.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt="" className="h-9 w-9 rounded object-cover" />
                    ) : (
                      <Paperclip className="h-4 w-4 text-muted" />
                    )}
                    <a href={a.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-[13px] text-ink hover:text-accent">
                      {a.fileName}
                    </a>
                    <span className="text-[11px] text-muted">{formatBytes(a.sizeBytes)}</span>
                    <a href={`${a.url}?download=1`} className="text-[11px] text-muted hover:text-ink">
                      Télécharger
                    </a>
                    {canEdit && (
                      <button type="button" aria-label={`Supprimer ${a.fileName}`} className={`${ICON_BTN} opacity-0 group-hover:opacity-100 focus:opacity-100`} onClick={() => void refresh(() => deleteAttachmentAction(a.id), "Pièce jointe supprimée.")}>
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Onglets du bas */}
        <div className="border-t border-border-subtle bg-bg/40">
          <div role="tablist" aria-label="Activité" className="flex gap-1 px-4 pt-2">
            {([
              ["comments", `Commentaires (${detail.comments.length})`],
              ["activity", "Historique"],
              ["time", "Temps passé"],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-t-md px-3 py-1.5 text-[12px] font-medium ${tab === key ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="px-5 py-3">
            {tab === "comments" && <CommentsBlock taskId={task.id} comments={detail.comments} canComment={detail.canComment} refresh={refresh} />}
            {tab === "activity" && <ActivityBlock items={detail.activity} />}
            {tab === "time" && <TimeEntriesBlock detail={detail} refresh={refresh} />}
          </div>
        </div>
      </div>

      {/* Abonnés */}
      <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-2 text-[12px] text-muted">
        <span>Abonnés</span>
        <FollowersField detail={detail} disabled={!task.canManage} kind="ALL" onChange={(userId, on) => refresh(() => setFollowerAction(task.id, userId, on ? "FOLLOWER" : null))} />
        <span className="flex-1" />
        <button type="button" className="font-medium text-ink hover:text-accent" onClick={() => void refresh(() => setFollowerAction(task.id, me, following ? null : "FOLLOWER"))}>
          {following ? "Ne plus suivre" : "Suivre"}
        </button>
      </div>
      {menu.element}
    </PanelShell>
  );
}

function PanelShell({ children, onClose, panelRef }: { children: React.ReactNode; onClose: () => void; panelRef: React.RefObject<HTMLElement | null> }) {
  return (
    <>
      <button type="button" aria-label="Fermer le panneau" tabIndex={-1} onClick={onClose} className="fixed inset-0 z-30 bg-black/20 md:hidden" />
      <aside
        ref={panelRef}
        tabIndex={-1}
        data-panel
        role="dialog"
        aria-label="Détail de la tâche"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border-subtle bg-surface shadow-dialog outline-none md:w-[min(600px,calc(100vw-280px))] nod-rise"
      >
        {children}
      </aside>
    </>
  );
}

/* ─── Champs ──────────────────────────────────────────────────────────────── */

function AssigneeField({ task, disabled, onChange }: { task: TaskItem; disabled: boolean; onChange: (id: string | null) => void }) {
  const user = useUser(task.assigneeId);
  return (
    <UserPicker value={task.assigneeId} onChange={onChange} disabled={disabled} className={FIELD_BTN}>
      <Avatar user={user} size={22} />
      <span className={user ? "" : "text-muted"}>{user?.name ?? "Non affectée"}</span>
    </UserPicker>
  );
}

function ProjectsField({ task, detail, disabled, ops, reload }: { task: TaskItem; detail: TaskDetail; disabled: boolean; ops: ReturnType<typeof useTaskOps>; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-1">
      {detail.projects.map((p) => (
        <div key={p.id} className="group flex flex-wrap items-center gap-1.5">
          <NextLink href={`/tasks/projects/${p.id}?task=${task.id}`} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ink hover:bg-surface-muted">
            <ProjectIcon icon={p.icon} color={p.color} size={16} />
            {p.name}
          </NextLink>
          <select
            aria-label={`Section dans ${p.name}`}
            disabled={disabled}
            value={task.memberships.find((m) => m.projectId === p.id)?.sectionId ?? ""}
            onChange={async (e) => {
              await ops.move(task, p.id, e.target.value || null);
              await reload();
            }}
            className="rounded border-none bg-transparent py-0.5 text-[12px] text-muted hover:bg-surface-muted"
          >
            <option value="">Sans section</option>
            {p.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {!disabled && (
            <button type="button" aria-label={`Retirer de ${p.name}`} className={`${ICON_BTN} h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100`} onClick={async () => { await ops.removeFromProject(task, p.id); await reload(); }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <>
          <button ref={ref} type="button" onClick={() => setOpen(true)} className={`${FIELD_BTN} text-muted`}>
            <Plus className="h-3.5 w-3.5" /> {detail.projects.length ? "Ajouter à un autre projet" : "Ajouter à un projet"}
          </button>
          <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Ajouter à un projet">
            <ProjectSectionPanel
              title="Ajouter à"
              excludeProjectIds={task.memberships.map((m) => m.projectId)}
              onPick={async (projectId, sectionId) => {
                setOpen(false);
                await ops.addToProject(task, projectId, sectionId);
                await reload();
              }}
            />
          </Popover>
        </>
      )}
    </div>
  );
}

function RefLink({ task, onRemove, disabled }: { task: TaskRef; onRemove: () => void; disabled: boolean }) {
  const { openTask } = useWorkApi();
  const today = useToday();
  return (
    <span className="group inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-muted px-2 py-0.5 text-[12px]">
      <button type="button" onClick={() => openTask(task.id)} className={`truncate hover:text-accent ${task.status === "DONE" ? "text-muted line-through" : "text-ink"}`}>
        {task.title}
      </button>
      <DueText due={task.dueDate} done={task.status === "DONE"} today={today} />
      {!disabled && (
        <button type="button" aria-label={`Retirer la dépendance ${task.title}`} onClick={onRemove} className="text-muted opacity-60 hover:text-ink group-hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function DependenciesField({ task, detail, disabled, refresh }: { task: TaskItem; detail: TaskDetail; disabled: boolean; refresh: <T>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null> }) {
  const [adding, setAdding] = useState<"blockedBy" | "blocking" | null>(null);
  const blockedRef = useRef<HTMLButtonElement>(null);
  const blockingRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-1.5 pt-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-muted">Bloquée par</span>
        {detail.blockedBy.map((b) => (
          <RefLink key={b.id} task={b} disabled={disabled} onRemove={() => void refresh(() => removeDependencyAction(task.id, b.id))} />
        ))}
        {!disabled && (
          <button ref={blockedRef} type="button" onClick={() => setAdding("blockedBy")} className="rounded px-1 text-muted hover:bg-surface-muted hover:text-ink">
            + Ajouter
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 text-muted">Bloque</span>
        {detail.blocking.map((b) => (
          <RefLink key={b.id} task={b} disabled={disabled} onRemove={() => void refresh(() => removeDependencyAction(b.id, task.id))} />
        ))}
        {!disabled && (
          <button ref={blockingRef} type="button" onClick={() => setAdding("blocking")} className="rounded px-1 text-muted hover:bg-surface-muted hover:text-ink">
            + Ajouter
          </button>
        )}
      </div>
      <Popover open={adding !== null} anchor={adding === "blocking" ? blockingRef : blockedRef} onClose={() => setAdding(null)} label="Choisir une tâche">
        <TaskFinderPanel
          excludeId={task.id}
          placeholder={adding === "blocking" ? "Tâche bloquée par celle-ci" : "Tâche qui bloque celle-ci"}
          onPick={(other) => {
            const mode = adding;
            setAdding(null);
            void refresh(() => (mode === "blocking" ? addDependencyAction(other.id, task.id) : addDependencyAction(task.id, other.id)));
          }}
        />
      </Popover>
    </div>
  );
}

function TagsField({ task, disabled, ops }: { task: TaskItem; disabled: boolean; ops: ReturnType<typeof useTaskOps> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} onClick={() => setOpen(true)} className={FIELD_BTN}>
        {task.tagIds.length ? <TagList ids={task.tagIds} max={8} /> : <span className="text-muted">Aucun tag</span>}
      </button>
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Tags">
        <TagPickerPanel value={task.tagIds} onChange={(ids) => void ops.setTags(task, ids)} />
      </Popover>
    </>
  );
}

function TimeField({ task, detail, disabled, update, refresh }: { task: TaskItem; detail: TaskDetail; disabled: boolean; update: (p: { estimatedMinutes: number | null }) => void; refresh: <T>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const today = useToday();
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const ratio = task.estimatedMinutes ? Math.min(1, task.spentMinutes / task.estimatedMinutes) : 0;
  void detail;
  return (
    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[13px]">
      <span className="text-muted">Estimé</span>
      <span className="inline-block w-20">
        <InlineText
          value={task.estimatedMinutes ? minutesLabel(task.estimatedMinutes) : ""}
          placeholder="—"
          label="Temps estimé"
          disabled={disabled}
          maxLength={12}
          onSave={(text) => {
            const minutes = parseDuration(text.replace(/\s/g, ""));
            if (minutes !== null) update({ estimatedMinutes: minutes });
          }}
          inputClassName="tabular-nums"
        />
      </span>
      <span className="text-muted">Passé</span>
      <span className="tabular-nums">{minutesLabel(task.spentMinutes)}</span>
      {task.estimatedMinutes ? (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted" aria-label={`${Math.round(ratio * 100)} % du temps estimé`}>
          <span className={`block h-full ${task.spentMinutes > task.estimatedMinutes ? "bg-critical-fg" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
        </span>
      ) : null}
      {!disabled && (
        <>
          <button ref={ref} type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-muted hover:text-ink">
            <Clock className="h-3.5 w-3.5" /> Saisir du temps
          </button>
          <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Saisir du temps">
            <form
              className="w-64 space-y-2 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const minutes = parseDuration(duration.replace(/\s/g, ""));
                if (!minutes) return;
                const ok = await refresh(() => addTimeEntryAction(task.id, { minutes, date, note: note || null }), "Temps enregistré.");
                if (ok) {
                  setOpen(false);
                  setDuration("");
                  setNote("");
                }
              }}
            >
              <input data-autofocus value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Durée : 45, 1h30…" aria-label="Durée" className={INPUT} />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={INPUT} />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif)" aria-label="Note" maxLength={200} className={INPUT} />
              <button type="submit" className={`${BTN_PRIMARY} w-full`}>
                Enregistrer
              </button>
            </form>
          </Popover>
        </>
      )}
    </div>
  );
}

function CrmField({ kind, value, disabled, onChange }: { kind: keyof typeof CRM_LABELS; value: CrmRef | null; disabled: boolean; onChange: (ref: CrmRef | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const href = value ? (kind === "contact" ? `/contacts/${value.id}` : kind === "organization" ? `/organizations/${value.id}` : `/commerce/${value.id}`) : null;
  return (
    <div className="group flex items-center gap-1">
      {value && href ? (
        <NextLink href={href} className="truncate rounded-md px-1.5 py-1 text-[13px] text-accent hover:underline">
          {value.label}
        </NextLink>
      ) : (
        !disabled && (
          <button ref={ref} type="button" onClick={() => setOpen(true)} className={`${FIELD_BTN} text-muted`}>
            <Plus className="h-3.5 w-3.5" /> Rattacher
          </button>
        )
      )}
      {value && !disabled && (
        <>
          <button ref={ref} type="button" aria-label="Changer" onClick={() => setOpen(true)} className={`${ICON_BTN} h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100`}>
            <Pencil className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Détacher" onClick={() => onChange(null)} className={`${ICON_BTN} h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100`}>
            <X className="h-3 w-3" />
          </button>
        </>
      )}
      {!value && disabled && <span className="pt-1.5 text-[13px] text-muted/60">—</span>}
      <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label={CRM_LABELS[kind]}>
        <CrmPickerPanel
          kind={kind}
          onPick={(picked) => {
            setOpen(false);
            onChange(picked);
          }}
        />
      </Popover>
    </div>
  );
}

function FollowersField({ detail, disabled, kind, onChange }: { detail: TaskDetail; disabled: boolean; kind: "COLLABORATOR" | "ALL"; onChange: (userId: string, on: boolean) => Promise<unknown> }) {
  const users = useWork((s) => s.context?.users ?? []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const ids = detail.followers.filter((f) => kind === "ALL" || f.kind === "COLLABORATOR").map((f) => f.userId);
  const list = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => Boolean(u));
  return (
    <div className="flex items-center gap-1.5">
      {list.length ? <AvatarStack users={list} max={6} size={22} /> : kind === "COLLABORATOR" && <span className="pt-1 text-[13px] text-muted">Aucun</span>}
      {!disabled && (
        <>
          <button ref={ref} type="button" aria-label={kind === "COLLABORATOR" ? "Gérer les collaborateurs" : "Gérer les abonnés"} onClick={() => setOpen(true)} className={`${ICON_BTN} h-6 w-6 rounded-full border border-dashed border-border-strong`}>
            <Plus className="h-3 w-3" />
          </button>
          <Popover open={open} anchor={ref} onClose={() => setOpen(false)} label="Personnes">
            <UserPickerPanel multiple allowNone={false} selected={ids} onSelect={(id) => id && void onChange(id, !ids.includes(id))} />
          </Popover>
        </>
      )}
    </div>
  );
}

function DescriptionEditor({ initial, onDone }: { initial: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-2">
      <RichTextEditor
        value={value}
        onChange={setValue}
        autoFocus
        label="Description"
        minRows={5}
        placeholder="Décrivez la tâche… (Markdown : **gras**, *italique*, - [ ] liste de contrôle, @mention)"
        onSubmit={() => onDone(value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone(null);
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" className={BTN_SECONDARY} onClick={() => onDone(null)}>
          Annuler
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={() => onDone(value)}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/* ─── Sous-tâches ─────────────────────────────────────────────────────────── */

function SubtasksBlock({ parent, subtasks, disabled }: { parent: TaskItem; subtasks: TaskItem[]; disabled: boolean }) {
  const ops = useTaskOps();
  const { openTask } = useWorkApi();
  const today = useToday();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const done = subtasks.filter((s) => s.status === "DONE").length;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[12px] font-semibold text-muted">Sous-tâches</h3>
        {subtasks.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted">
            {done}/{subtasks.length}
          </span>
        )}
      </div>
      <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
        {subtasks.map((sub) => (
          <SubtaskRow key={sub.id} task={sub} ops={ops} today={today} onOpen={() => openTask(sub.id)} />
        ))}
        {adding && (
          <li className="flex items-center gap-2 px-2 py-1.5">
            <CompleteToggle done={false} disabled onToggle={() => {}} label="Nouvelle sous-tâche" size={16} />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => !title.trim() && setAdding(false)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAdding(false);
                  setTitle("");
                }
                if (e.key === "Enter" && title.trim()) {
                  e.preventDefault();
                  const value = title.trim();
                  setTitle("");
                  await ops.create({ title: value, parentId: parent.id });
                }
              }}
              placeholder="Nom de la sous-tâche, puis Entrée"
              aria-label="Nouvelle sous-tâche"
              maxLength={300}
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/60"
            />
          </li>
        )}
      </ul>
      {!disabled && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:bg-surface-muted hover:text-ink">
          <Plus className="h-3.5 w-3.5" /> Ajouter une sous-tâche
        </button>
      )}
    </div>
  );
}

function SubtaskRow({ task, ops, today, onOpen }: { task: TaskItem; ops: ReturnType<typeof useTaskOps>; today: string; onOpen: () => void }) {
  const user = useUser(task.assigneeId);
  return (
    <li className="group flex items-center gap-2 px-2 py-1">
      <CompleteToggle done={task.status === "DONE"} disabled={!task.canEdit || task.id.startsWith("tmp-")} onToggle={() => void ops.toggleComplete(task)} label={task.title} size={16} />
      <div className={`min-w-0 flex-1 ${task.status === "DONE" ? "text-muted line-through" : ""}`}>
        <InlineText value={task.title} label="Nom de la sous-tâche" disabled={!task.canEdit} onSave={(title) => void ops.update(task, { title })} className="block truncate text-[13px]" inputClassName="py-0.5 text-[13px]" />
      </div>
      <UserPicker value={task.assigneeId} onChange={(assigneeId) => void ops.update(task, { assigneeId })} disabled={!task.canManage} className="rounded-full">
        <Avatar user={user} size={20} />
      </UserPicker>
      <DatePicker value={{ dueDate: task.dueDate, startDate: task.startDate, dueTime: task.dueTime }} onChange={(v) => void ops.update(task, { dueDate: v.dueDate, startDate: v.startDate, dueTime: v.dueTime })} disabled={!task.canEdit} className="min-w-12 rounded px-1 py-0.5 text-left hover:bg-surface-muted" label="Échéance de la sous-tâche">
        {task.dueDate ? <DueText due={task.dueDate} done={task.status === "DONE"} today={today} /> : <span className="text-[12px] text-muted/50 opacity-0 group-hover:opacity-100">Date</span>}
      </DatePicker>
      <StatusPicker value={task.status} onChange={(status) => void ops.update(task, { status })} disabled={!task.canEdit} className="hidden sm:inline-flex" />
      <button type="button" onClick={onOpen} aria-label={`Ouvrir ${task.title}`} className={`${ICON_BTN} h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100`}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/* ─── Pièces jointes ──────────────────────────────────────────────────────── */

function AttachButton({ taskId, disabled, onUploaded }: { taskId: string; disabled: boolean; onUploaded: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { store } = useWorkApi();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          store.toast("error", `« ${file.name} » dépasse 10 Mo.`);
          continue;
        }
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(`/api/tasks/items/${taskId}/attachments`, { method: "POST", body });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          store.toast("error", data.error ?? `Envoi de « ${file.name} » impossible.`);
        }
      }
      await onUploaded();
    } catch {
      store.toast("error", "Connexion au serveur impossible : fichier non envoyé.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
      <button type="button" disabled={disabled || busy} className={ICON_BTN} aria-label="Joindre un fichier" title="Joindre un fichier (10 Mo max.)" onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Upload className="h-4 w-4" />}
      </button>
    </>
  );
}

/* ─── Commentaires ────────────────────────────────────────────────────────── */

function CommentsBlock({ taskId, comments, canComment, refresh }: { taskId: string; comments: CommentItem[]; canComment: boolean; refresh: <T>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null> }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const value = draft;
    setDraft("");
    const ok = await refresh(() => addCommentAction(taskId, value));
    if (ok === null) setDraft(value);
    setSending(false);
  };
  return (
    <div className="space-y-3">
      {comments.length === 0 && <p className="text-[12px] text-muted">Aucun commentaire pour l&apos;instant.</p>}
      <ul className="space-y-3">
        {comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} refresh={refresh} />
        ))}
      </ul>
      {canComment && (
        <div className="space-y-1.5">
          <RichTextEditor value={draft} onChange={setDraft} label="Nouveau commentaire" placeholder="Écrire un commentaire… @ pour mentionner" minRows={2} onSubmit={send} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">Ctrl + Entrée pour envoyer</span>
            <button type="button" disabled={!draft.trim() || sending} onClick={send} className={BTN_PRIMARY}>
              {sending && <Spinner className="h-3.5 w-3.5 text-white" />} Commenter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment, refresh }: { comment: CommentItem; refresh: <T>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null> }) {
  const author = useUser(comment.authorId);
  const me = useWork((s) => s.context?.me.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [picker, setPicker] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const mine = comment.authorId === me;
  return (
    <li className="group flex gap-2.5">
      <Avatar user={author} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="font-semibold text-ink">{author?.name ?? (comment.authorId ? "Utilisateur" : "Automatisation")}</span>
          <time dateTime={comment.createdAt} className="text-muted">
            {relativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && <span className="text-muted">(modifié)</span>}
          {mine && !editing && (
            <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <button type="button" onClick={() => setEditing(true)} className="text-muted hover:text-ink">
                Modifier
              </button>
              <button type="button" onClick={() => void refresh(() => deleteCommentAction(comment.id))} className="text-muted hover:text-critical-fg">
                Supprimer
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <RichTextEditor value={draft} onChange={setDraft} label="Modifier le commentaire" autoFocus minRows={2} onSubmit={async () => { if (await refresh(() => editCommentAction(comment.id, draft)) !== null) setEditing(false); }} />
            <div className="flex justify-end gap-1.5">
              <button type="button" className={BTN_SECONDARY} onClick={() => { setEditing(false); setDraft(comment.body); }}>
                Annuler
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={async () => { if (await refresh(() => editCommentAction(comment.id, draft)) !== null) setEditing(false); }}>
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <RichText source={comment.body} className="mt-0.5" />
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {comment.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              aria-pressed={me ? r.userIds.includes(me) : false}
              aria-label={`${r.emoji} ${r.userIds.length}`}
              onClick={() => void refresh(() => toggleReactionAction(comment.id, r.emoji))}
              className={`rounded-full border px-1.5 text-[12px] ${me && r.userIds.includes(me) ? "border-accent bg-accent-soft" : "border-border-subtle"}`}
            >
              {r.emoji} {r.userIds.length}
            </button>
          ))}
          <button ref={ref} type="button" aria-label="Ajouter une réaction" onClick={() => setPicker(true)} className="rounded-full px-1.5 text-[12px] text-muted opacity-0 hover:bg-surface-muted group-hover:opacity-100 focus:opacity-100">
            ☺+
          </button>
          <Popover open={picker} anchor={ref} onClose={() => setPicker(false)} label="Réactions">
            <div className="flex gap-1 p-1.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => { setPicker(false); void refresh(() => toggleReactionAction(comment.id, emoji)); }} className="rounded p-1 text-[16px] hover:bg-surface-muted" aria-label={`Réagir ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </Popover>
        </div>
      </div>
    </li>
  );
}

/* ─── Historique et temps ─────────────────────────────────────────────────── */

const KIND_LABELS: Record<string, string> = {
  created: "a créé la tâche",
  completed: "a terminé la tâche",
  reopened: "a rouvert la tâche",
  moved: "a déplacé la tâche",
  project_added: "a ajouté la tâche au projet",
  project_removed: "a retiré la tâche du projet",
  tag_added: "a ajouté le tag",
  tag_removed: "a retiré le tag",
  dependency_added: "a ajouté une dépendance",
  dependency_removed: "a retiré une dépendance",
  subtask_added: "a ajouté une sous-tâche",
  subtask_removed: "a supprimé une sous-tâche",
  attachment_added: "a joint un fichier",
  attachment_removed: "a supprimé une pièce jointe",
  duplicated: "a dupliqué la tâche depuis",
  recurrence_created: "occurrence créée automatiquement",
  recurrence_spawned: "a généré l'occurrence suivante, due le",
  follower_added: "a ajouté",
  follower_removed: "a retiré",
  time_logged: "a saisi du temps",
  time_removed: "a supprimé une saisie de temps",
  made_subtask: "a converti en sous-tâche",
  made_task: "a converti en tâche indépendante",
};

const CITING_KINDS = new Set(["dependency_added", "dependency_removed", "duplicated"]);

function ActivityBlock({ items }: { items: ActivityItem[] }) {
  const users = useWork((s) => s.context?.users ?? []);
  if (items.length === 0) return <p className="text-[12px] text-muted">Aucun historique.</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((item) => {
        const actor = users.find((u) => u.id === item.actorId);
        const who = actor?.name ?? (item.automationRuleId ? "Règle d'automatisation" : "Système");
        let what: string;
        if (item.kind === "field") {
          what = `a modifié ${item.field?.toLowerCase()}${item.oldValue ? ` : « ${item.oldValue} » →` : " :"} ${item.newValue ? `« ${item.newValue} »` : "(vide)"}`;
        } else {
          const label = KIND_LABELS[item.kind] ?? item.kind;
          const value = item.newValue ?? item.oldValue;
          // Tâche citée que la personne ne peut pas lire : le serveur a retiré son titre.
          const hidden = !value && CITING_KINDS.has(item.kind) ? `${label} (tâche non accessible)` : label;
          what = item.kind === "moved" ? `${label} : ${item.oldValue} → ${item.newValue}` : value ? `${label} « ${value} »` : hidden;
        }
        return (
          <li key={item.id} className="flex gap-2 text-[12px]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
            <span className="min-w-0 flex-1 text-muted">
              <span className="font-medium text-ink">{who}</span> {what}
              {item.automationRuleId && actor && " (règle)"}
              <time dateTime={item.createdAt} className="ml-1.5 text-muted/70">
                {relativeTime(item.createdAt)}
              </time>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TimeEntriesBlock({ detail, refresh }: { detail: TaskDetail; refresh: <T>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: string) => Promise<T | null> }) {
  const users = useWork((s) => s.context?.users ?? []);
  const me = useWork((s) => s.context?.me.id);
  if (detail.timeEntries.length === 0) return <p className="text-[12px] text-muted">Aucune saisie. Utilisez « Saisir du temps » dans les champs ci-dessus.</p>;
  return (
    <ul className="space-y-1 text-[12px]">
      {detail.timeEntries.map((entry) => (
        <li key={entry.id} className="group flex items-center gap-2">
          <span className="w-20 tabular-nums text-muted">{entry.spentDate.split("-").reverse().join("/")}</span>
          <span className="w-16 font-medium tabular-nums">{minutesLabel(entry.minutes)}</span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {users.find((u) => u.id === entry.userId)?.name ?? "—"}
            {entry.note && ` · ${entry.note}`}
          </span>
          {(entry.userId === me || detail.task.canEdit) && (
            <button type="button" aria-label="Supprimer la saisie" onClick={() => void refresh(() => deleteTimeEntryAction(entry.id))} className={`${ICON_BTN} h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100`}>
              <Trash className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}


