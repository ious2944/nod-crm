"use client";

import { CheckSquare, ChevronRight, FolderPlus, Plus } from "lucide-react";
import NextLink from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CrmRef, ProjectSummary, TaskItem } from "@/lib/tasks/types";

import { NewTaskModal, ProjectFormModal } from "./project-dialogs";
import { useToday } from "./pickers";
import { fetchJson, useWork, useWorkApi } from "./store";
import { useTaskOps } from "./task-ops";
import { Avatar, BTN_GHOST, BTN_SECONDARY, CompleteToggle, DueText, ErrorBlock, LoadingRows, PriorityBadge, ProjectIcon, useUser } from "./ui";

type Kind = "contact" | "organization" | "opportunity";

const FIELD: Record<Kind, "contactId" | "organizationId" | "opportunityId"> = {
  contact: "contactId",
  organization: "organizationId",
  opportunity: "opportunityId",
};

/**
 * Tâches et projets rattachés à une fiche CRM. Ce sont les tâches elles-mêmes
 * (même identifiant, même contenu que dans les projets) : terminer une tâche
 * ici la termine partout. La création rapide rattache la nouvelle tâche à la
 * fiche. Les permissions sont celles du module : une tâche d'un projet privé
 * n'apparaît qu'à ses membres.
 */
export function LinkedWork({ kind, id, title = "Tâches" }: { kind: Kind; id: string; title?: string }) {
  const { store, ensureContext, openTask } = useWorkApi();
  const ops = useTaskOps();
  const today = useToday();
  const allTasks = useWork((s) => s.tasks);
  const [ids, setIds] = useState<string[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [ref, setRef] = useState<CrmRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [modal, setModal] = useState<"task" | "project" | null>(null);
  const [quick, setQuick] = useState("");

  useEffect(() => ensureContext(), [ensureContext]);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ tasks: TaskItem[]; projects: ProjectSummary[]; ref: CrmRef | null }>(`/api/tasks/linked?kind=${kind}&id=${id}`);
      store.upsertTasks(data.tasks, { skipPending: true });
      setIds(data.tasks.map((t) => t.id));
      setProjects(data.projects);
      setRef(data.ref);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [id, kind, store]);

  useEffect(() => {
    // Chargement des données : l'état n'est mis à jour qu'au retour du réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => store.register({ scope: (e) => e.taskIds.some((t) => ids?.includes(t)) || e.kind === "task_created", reload: load }), [ids, load, store]);

  // Les tâches nouvellement rattachées (création locale) apparaissent aussitôt.
  const tasks = useMemo(() => {
    const field = FIELD[kind];
    const known = new Set(ids ?? []);
    const list = Object.values(allTasks).filter((t) => known.has(t.id) || (kind !== "organization" && t[field] === id));
    return list
      .filter((t) => !t.id.startsWith("tmp-") || t[field] === id)
      .filter((t) => (kind === "organization" ? known.has(t.id) || t.organizationId === id : t[field] === id))
      .sort((a, b) => (a.status === "DONE" ? 1 : 0) - (b.status === "DONE" ? 1 : 0) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  }, [allTasks, ids, id, kind]);
  const open = tasks.filter((t) => t.status !== "DONE");
  const done = tasks.filter((t) => t.status === "DONE");
  const defaults = { [FIELD[kind]]: id } as { contactId?: string; organizationId?: string; opportunityId?: string };

  return (
    <section aria-label={title} className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-base font-semibold text-ink">
          <CheckSquare className="h-4 w-4 text-muted" /> {title}
          {ids && <span className="text-sm font-normal text-muted">({open.length})</span>}
        </h2>
        <button type="button" className={BTN_GHOST} onClick={() => setModal("project")}>
          <FolderPlus className="h-3.5 w-3.5" /> Projet
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={() => setModal("task")}>
          <Plus className="h-3.5 w-3.5" /> Tâche
        </button>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {!ids && !error && <LoadingRows rows={3} />}

      {projects.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <NextLink key={p.id} href={`/tasks/projects/${p.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-[12px] text-ink hover:bg-surface-muted">
              <ProjectIcon icon={p.icon} color={p.color} size={16} /> {p.name}
            </NextLink>
          ))}
        </div>
      )}

      {ids && (
        <>
          <ul className="divide-y divide-border-subtle">
            {open.length === 0 && <li className="py-3 text-[13px] text-muted">Aucune tâche en cours.</li>}
            {(showDone ? [...open, ...done] : open).map((task) => (
              <LinkedRow key={task.id} task={task} today={today} onOpen={() => openTask(task.id)} onToggle={() => void ops.toggleComplete(task)} />
            ))}
          </ul>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const value = quick.trim();
              if (!value) return;
              setQuick("");
              const created = await ops.create({ title: value, ...defaults });
              if (created) setIds((list) => [...(list ?? []), created.id]);
            }}
          >
            <Plus className="h-3.5 w-3.5 text-muted" />
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Ajouter une tâche pour ${ref?.label ?? "cette fiche"}…`} aria-label="Nouvelle tâche liée" maxLength={300} className="flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-muted/60" />
          </form>
          {done.length > 0 && (
            <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-2 text-[12px] font-medium text-muted hover:text-ink">
              {showDone ? "Masquer" : "Afficher"} les {done.length} tâche(s) terminée(s) récemment
            </button>
          )}
        </>
      )}

      {modal === "task" && (
        <NewTaskModal
          onClose={() => {
            setModal(null);
            void load();
          }}
          defaults={defaults}
        />
      )}
      {modal === "project" && <ProjectFormModal onClose={() => setModal(null)} defaults={{ [kind]: ref ?? { id, label: "" } }} />}
    </section>
  );
}

function LinkedRow({ task, today, onOpen, onToggle }: { task: TaskItem; today: string; onOpen: () => void; onToggle: () => void }) {
  const user = useUser(task.assigneeId);
  const projects = useWork((s) => s.context?.projects ?? []);
  const project = projects.find((p) => p.id === task.memberships[0]?.projectId);
  const done = task.status === "DONE";
  return (
    <li className="group flex items-center gap-2.5 py-2">
      <CompleteToggle done={done} disabled={!task.canEdit || task.id.startsWith("tmp-")} onToggle={onToggle} label={task.title} size={16} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[13px] ${done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
        {project && <span className="block truncate text-[11px] text-muted">{project.name}</span>}
      </button>
      <PriorityBadge priority={task.priority} compact />
      <DueText due={task.dueDate} time={task.dueTime} done={done} today={today} />
      <Avatar user={user} size={20} />
      <ChevronRight className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100" />
    </li>
  );
}
