"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  createProjectAction,
  postStatusUpdateAction,
  setProjectMemberAction,
  updateProjectAction,
} from "@/app/(app)/tasks/work-actions";
import {
  COLOR_KEYS,
  COLOR_SWATCH,
  PROJECT_ICON_KEYS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/tasks/constants";
import type { CrmRef, ProjectDetail, ProjectRole, ProjectStatus, SectionItem } from "@/lib/tasks/types";

import { CRM_LABELS, CrmPickerPanel, DatePicker, TagList, TagPickerPanel, UserPicker, UserPickerPanel, useToday } from "./pickers";
import { RichTextEditor } from "./rich-text";
import { fetchJson, useWork, useWorkApi } from "./store";
import { useTaskOps } from "./task-ops";
import { Avatar, BTN_PRIMARY, BTN_SECONDARY, DueText, iconComponent, INPUT, Modal, Popover, ProjectIcon, Spinner, useUser } from "./ui";

const LABEL = "mb-1 block text-[12px] font-semibold text-muted";

/* ─── Nouvelle tâche ──────────────────────────────────────────────────────── */

export function NewTaskModal({
  onClose,
  projectId: initialProject = null,
  sections: initialSections,
  defaults = {},
}: {
  onClose: () => void;
  projectId?: string | null;
  sections?: SectionItem[];
  defaults?: { contactId?: string; organizationId?: string; opportunityId?: string; dueDate?: string; assigneeId?: string | null };
}) {
  const ops = useTaskOps();
  const { openTask } = useWorkApi();
  const me = useWork((s) => s.context?.me.id ?? null);
  const projects = useWork((s) => s.context?.projects ?? []);
  const today = useToday();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(initialProject);
  const [sectionId, setSectionId] = useState<string | null>(initialSections?.[0]?.id ?? null);
  const [sections, setSections] = useState<SectionItem[]>(initialSections ?? []);
  const [assigneeId, setAssigneeId] = useState<string | null>(defaults.assigneeId !== undefined ? defaults.assigneeId : initialProject ? null : me);
  const [dates, setDates] = useState({ dueDate: defaults.dueDate ?? null, startDate: null as string | null, dueTime: null as string | null });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<{ id: string; name: string; title: string }[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const assignee = useUser(assigneeId);
  const tagRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchJson<{ sections: SectionItem[] }>(`/api/tasks/projects/${projectId}`)
      .then((b) => {
        if (cancelled) return;
        setSections(b.sections);
        setSectionId((current) => (b.sections.some((s) => s.id === current) ? current : (b.sections[0]?.id ?? null)));
      })
      .catch(() => {});
    fetchJson<{ templates: { id: string; name: string; title: string }[] }>(`/api/tasks/projects/${projectId}/settings`)
      .then((s) => !cancelled && setTemplates(s.templates))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const submit = async (openAfter: boolean) => {
    if (!title.trim() && !templateId) return;
    setPending(true);
    const template = templates.find((t) => t.id === templateId);
    const created = await ops.create({
      title: title.trim() || template?.title || "Nouvelle tâche",
      description: description.trim() || null,
      projectId,
      sectionId: projectId ? sectionId : null,
      placement: "top",
      assigneeId,
      dueDate: dates.dueDate,
      startDate: dates.startDate,
      dueTime: dates.dueTime,
      tagIds,
      templateId: templateId || null,
      contactId: defaults.contactId,
      organizationId: defaults.organizationId,
      opportunityId: defaults.opportunityId,
    });
    setPending(false);
    if (created) {
      onClose();
      if (openAfter) openTask(created.id);
    }
  };

  return (
    <Modal
      open
      title="Nouvelle tâche"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_SECONDARY} disabled={pending} onClick={() => void submit(true)}>
            Créer et ouvrir
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={pending || (!title.trim() && !templateId)} onClick={() => void submit(false)}>
            {pending && <Spinner className="h-3.5 w-3.5 text-white" />} Créer la tâche
          </button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nom de la tâche" aria-label="Nom de la tâche" maxLength={300} className={`${INPUT} py-2 text-[15px] font-medium`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Responsable</span>
            <UserPicker value={assigneeId} onChange={setAssigneeId} className={`${INPUT} flex items-center gap-2 text-left`}>
              <Avatar user={assignee} size={20} />
              <span className={assignee ? "" : "text-muted"}>{assignee?.name ?? "Personne"}</span>
            </UserPicker>
          </div>
          <div>
            <span className={LABEL}>Échéance</span>
            <DatePicker value={dates} onChange={setDates} className={`${INPUT} text-left`}>
              {dates.dueDate ? <DueText due={dates.dueDate} start={dates.startDate} time={dates.dueTime} done={false} today={today} className="text-[13px]" /> : <span className="text-muted">Aucune</span>}
            </DatePicker>
          </div>
          <div>
            <label htmlFor="new-task-project" className={LABEL}>
              Projet
            </label>
            <select id="new-task-project" value={projectId ?? ""} onChange={(e) => {
                const next = e.target.value || null;
                setProjectId(next);
                setSections([]);
                setTemplates([]);
              }} className={INPUT}>
              <option value="">Aucun (tâche personnelle)</option>
              {projects.filter((p) => p.canEdit && !p.archived && !p.isTemplate).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {projectId && (
            <div>
              <label htmlFor="new-task-section" className={LABEL}>
                Section
              </label>
              <select id="new-task-section" value={sectionId ?? ""} onChange={(e) => setSectionId(e.target.value || null)} className={INPUT}>
                <option value="">Sans section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {templates.length > 0 && (
            <div>
              <label htmlFor="new-task-template" className={LABEL}>
                Modèle de tâche
              </label>
              <select id="new-task-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={INPUT}>
                <option value="">Aucun</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <span className={LABEL}>Tags</span>
            <button ref={tagRef} type="button" onClick={() => setTagsOpen(true)} className={`${INPUT} min-h-8 text-left`}>
              {tagIds.length ? <TagList ids={tagIds} max={6} /> : <span className="text-muted">Aucun</span>}
            </button>
            <Popover open={tagsOpen} anchor={tagRef} onClose={() => setTagsOpen(false)} label="Tags">
              <TagPickerPanel value={tagIds} onChange={setTagIds} />
            </Popover>
          </div>
        </div>
        <div>
          <span className={LABEL}>Description</span>
          <RichTextEditor value={description} onChange={setDescription} label="Description" minRows={3} placeholder="Facultatif" />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ─── Création / édition de projet ────────────────────────────────────────── */

export function ProjectFormModal({
  project,
  onClose,
  onSaved,
  defaults = {},
}: {
  project?: ProjectDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
  defaults?: { contact?: CrmRef | null; organization?: CrmRef | null; opportunity?: CrmRef | null; templateId?: string };
}) {
  const router = useRouter();
  const { run, reloadContext } = useWorkApi();
  const me = useWork((s) => s.context?.me.id ?? null);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? "indigo");
  const [icon, setIcon] = useState(project?.icon ?? "folder");
  const [visibility, setVisibility] = useState(project?.visibility ?? "WORKSPACE");
  const [ownerId, setOwnerId] = useState<string | null>(project?.ownerId ?? me);
  const [dates, setDates] = useState({ startDate: project?.startDate ?? null, dueDate: project?.dueDate ?? null, dueTime: null as string | null });
  const [templateId, setTemplateId] = useState(defaults.templateId ?? "");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [crm, setCrm] = useState<{ contact: CrmRef | null; organization: CrmRef | null; opportunity: CrmRef | null }>({
    contact: project?.contact ?? defaults.contact ?? null,
    organization: project?.organization ?? defaults.organization ?? null,
    opportunity: project?.opportunity ?? defaults.opportunity ?? null,
  });
  const [crmOpen, setCrmOpen] = useState<keyof typeof CRM_LABELS | null>(null);
  const crmRef = useRef<HTMLButtonElement | null>(null);
  const [pending, setPending] = useState(false);
  const owner = useUser(ownerId);
  const today = useToday();

  useEffect(() => {
    if (project) return;
    fetchJson<{ projects: { id: string; name: string }[] }>("/api/tasks/projects?scope=templates")
      .then((d) => setTemplates(d.projects))
      .catch(() => {});
  }, [project]);

  const submit = async () => {
    if (!name.trim()) return;
    setPending(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      color,
      icon,
      visibility,
      ownerId,
      startDate: dates.startDate,
      dueDate: dates.dueDate,
      contactId: crm.contact?.id ?? null,
      organizationId: crm.organization?.id ?? null,
      opportunityId: crm.opportunity?.id ?? null,
    };
    if (project) {
      const ok = await run(() => updateProjectAction(project.id, payload, project.version), "Projet mis à jour.");
      setPending(false);
      if (ok !== null) {
        onSaved?.(project.id);
        void reloadContext();
        onClose();
      }
    } else {
      const id = await run(() => createProjectAction({ ...payload, templateId: templateId || null }), "Projet créé.");
      setPending(false);
      if (id) {
        void reloadContext();
        onSaved?.(id);
        onClose();
        router.push(`/tasks/projects/${id}?view=list`);
      }
    }
  };

  return (
    <Modal
      open
      title={project ? "Modifier le projet" : "Nouveau projet"}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={pending || !name.trim()} onClick={() => void submit()}>
            {pending && <Spinner className="h-3.5 w-3.5 text-white" />} {project ? "Enregistrer" : "Créer le projet"}
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-3">
          <ProjectIcon icon={icon} color={color} size={40} />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du projet" aria-label="Nom du projet" maxLength={120} className={`${INPUT} py-2 text-[15px] font-medium`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Couleur</span>
            <div role="radiogroup" aria-label="Couleur" className="flex flex-wrap gap-1.5">
              {COLOR_KEYS.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={color === key} aria-label={key} onClick={() => setColor(key)} className={`h-6 w-6 rounded-full ${COLOR_SWATCH[key]} ${color === key ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`} />
              ))}
            </div>
          </div>
          <div>
            <span className={LABEL}>Icône</span>
            <div role="radiogroup" aria-label="Icône" className="flex flex-wrap gap-1">
              {PROJECT_ICON_KEYS.map((key) => {
                const Icon = iconComponent(key);
                return (
                  <button key={key} type="button" role="radio" aria-checked={icon === key} aria-label={key} onClick={() => setIcon(key)} className={`grid h-7 w-7 place-items-center rounded-md ${icon === key ? "bg-accent text-accent-contrast" : "text-muted hover:bg-surface-muted"}`}>
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <span className={LABEL}>Responsable du projet</span>
            <UserPicker value={ownerId} onChange={(id) => id && setOwnerId(id)} className={`${INPUT} flex items-center gap-2 text-left`}>
              <Avatar user={owner} size={20} />
              {owner?.name ?? "—"}
            </UserPicker>
          </div>
          <div>
            <span className={LABEL}>Dates du projet</span>
            <DatePicker value={dates} onChange={setDates} allowTime={false} className={`${INPUT} text-left`}>
              {dates.dueDate || dates.startDate ? <DueText due={dates.dueDate} start={dates.startDate} done={false} today={today} className="text-[13px]" /> : <span className="text-muted">Non définies</span>}
            </DatePicker>
          </div>
          <div>
            <label htmlFor="project-visibility" className={LABEL}>
              Visibilité
            </label>
            <select id="project-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className={INPUT}>
              {(["WORKSPACE", "PRIVATE"] as const).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">{visibility === "PRIVATE" ? "Seuls les membres voient le projet et ses tâches." : "Tout l'espace voit le projet et peut y contribuer."}</p>
          </div>
          {!project && templates.length > 0 && (
            <div>
              <label htmlFor="project-template" className={LABEL}>
                Partir d&apos;un modèle
              </label>
              <select id="project-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={INPUT}>
                <option value="">Projet vierge</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <span className={LABEL}>Rattachement CRM</span>
          <div className="flex flex-wrap gap-2">
            {(["organization", "contact", "opportunity"] as const).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[12px]">
                <span className="text-muted">{CRM_LABELS[kind]} :</span>
                <button type="button" onClick={(e) => { crmRef.current = e.currentTarget; setCrmOpen(kind); }} className="font-medium text-ink hover:text-accent">
                  {crm[kind]?.label ?? "choisir"}
                </button>
                {crm[kind] && (
                  <button type="button" aria-label={`Retirer ${CRM_LABELS[kind]}`} onClick={() => setCrm({ ...crm, [kind]: null })} className="text-muted hover:text-ink">
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          <Popover open={crmOpen !== null} anchor={crmRef} onClose={() => setCrmOpen(null)} label="Rattacher">
            {crmOpen && <CrmPickerPanel kind={crmOpen} onPick={(ref) => { setCrm({ ...crm, [crmOpen]: ref }); setCrmOpen(null); }} />}
          </Popover>
        </div>
        <div>
          <span className={LABEL}>Description</span>
          <RichTextEditor value={description} onChange={setDescription} label="Description du projet" minRows={3} placeholder="Objectifs, périmètre, liens utiles…" />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ─── Membres ─────────────────────────────────────────────────────────────── */

export function MembersModal({ project, onClose, onChanged }: { project: ProjectDetail; onClose: () => void; onChanged: () => void }) {
  const { run, store } = useWorkApi();
  const users = useWork((s) => s.context?.users ?? []);
  const [adding, setAdding] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const set = async (userId: string, role: ProjectRole | null) => {
    const ok = await run(() => setProjectMemberAction(project.id, userId, role));
    if (ok !== null) {
      store.setProject({
        ...project,
        members: role === null ? project.members.filter((m) => m.userId !== userId) : project.members.some((m) => m.userId === userId) ? project.members.map((m) => (m.userId === userId ? { ...m, role } : m)) : [...project.members, { userId, role }],
      });
      onChanged();
    }
  };
  return (
    <Modal open title="Membres du projet" onClose={onClose}>
      <p className="mb-3 text-[12px] text-muted">
        {project.visibility === "PRIVATE"
          ? "Projet privé : seuls les membres ci-dessous y ont accès."
          : "Projet visible par tout l'espace. Les membres reçoivent les points d'avancement ; un commentateur ne peut pas modifier les tâches."}
      </p>
      <ul className="divide-y divide-border-subtle">
        {project.members.map((member) => {
          const user = users.find((u) => u.id === member.userId);
          return (
            <li key={member.userId} className="flex items-center gap-2 py-2">
              <Avatar user={user} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{user?.name ?? "Utilisateur"}</span>
                <span className="block truncate text-[11px] text-muted">{user?.email}</span>
              </span>
              <select aria-label={`Rôle de ${user?.name}`} value={member.role} disabled={!project.canManage} onChange={(e) => void set(member.userId, e.target.value as ProjectRole)} className={`${INPUT} w-auto`}>
                {(["OWNER", "EDITOR", "COMMENTER"] as const).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {project.canManage && member.userId !== project.ownerId && (
                <button type="button" onClick={() => void set(member.userId, null)} className="text-[12px] text-muted hover:text-critical-fg">
                  Retirer
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {project.canManage && (
        <>
          <button ref={anchor} type="button" onClick={() => setAdding(true)} className={`${BTN_SECONDARY} mt-3`}>
            + Ajouter un membre
          </button>
          <Popover open={adding} anchor={anchor} onClose={() => setAdding(false)} label="Ajouter un membre">
            <UserPickerPanel
              allowNone={false}
              multiple
              selected={project.members.map((m) => m.userId)}
              onSelect={(id) => {
                if (id && !project.members.some((m) => m.userId === id)) void set(id, "EDITOR");
              }}
            />
          </Popover>
        </>
      )}
      {!project.canManage && <p className="mt-3 text-[12px] text-muted">Seul le propriétaire du projet peut gérer les membres.</p>}
    </Modal>
  );
}

/* ─── Point d'avancement ──────────────────────────────────────────────────── */

export function StatusUpdateModal({ project, onClose, onPosted }: { project: ProjectDetail; onClose: () => void; onPosted: () => void }) {
  const { run } = useWorkApi();
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setPending(true);
    const ok = await run(() => postStatusUpdateAction(project.id, { status, title: title.trim(), body: body.trim() || null }), "Point d'avancement publié.");
    setPending(false);
    if (ok) {
      onPosted();
      onClose();
    }
  };
  return (
    <Modal
      open
      title="Publier un point d'avancement"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={pending || !title.trim()} onClick={() => void submit()}>
            Publier
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div role="radiogroup" aria-label="État du projet" className="flex flex-wrap gap-1.5">
          {PROJECT_STATUSES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${status === s ? "border-accent bg-accent-soft text-accent" : "border-border-subtle text-ink hover:bg-surface-muted"}`}>
              {PROJECT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Résumé (ex. « Livraison de la phase 1 confirmée »)" aria-label="Résumé" maxLength={160} className={INPUT} />
        <RichTextEditor value={body} onChange={setBody} label="Détail" minRows={4} placeholder="Ce qui avance, ce qui bloque, les prochaines étapes…" />
        <p className="text-[11px] text-muted">Les membres du projet sont notifiés. L&apos;historique des points reste consultable dans la vue d&apos;ensemble.</p>
      </div>
    </Modal>
  );
}

/* ─── Suppression de section ──────────────────────────────────────────────── */

export function DeleteSectionModal({
  section,
  sections,
  taskCount,
  onClose,
  onConfirm,
}: {
  section: SectionItem;
  sections: SectionItem[];
  taskCount: number;
  onClose: () => void;
  onConfirm: (mode: "keep" | "delete", target: string | null) => Promise<void>;
}) {
  const others = sections.filter((s) => s.id !== section.id);
  const [mode, setMode] = useState<"keep" | "delete">("keep");
  const [target, setTarget] = useState<string | null>(others[0]?.id ?? null);
  return (
    <Modal
      open
      title={`Supprimer la section « ${section.name} » ?`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={`${BTN_PRIMARY} bg-critical-fg hover:bg-critical-fg`} onClick={() => void onConfirm(mode, mode === "keep" ? target : null)}>
            Supprimer la section
          </button>
        </>
      }
    >
      {taskCount === 0 ? (
        <p className="text-[13px] text-muted">Cette section est vide.</p>
      ) : (
        <fieldset className="space-y-2 text-[13px]">
          <legend className="mb-1 text-muted">Elle contient {taskCount} tâche(s).</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "keep"} onChange={() => setMode("keep")} />
            Déplacer les tâches vers
            <select aria-label="Section de destination" value={target ?? ""} onChange={(e) => setTarget(e.target.value || null)} disabled={mode !== "keep"} className={`${INPUT} w-auto py-1`}>
              <option value="">Sans section</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "delete"} onChange={() => setMode("delete")} />
            Supprimer aussi les tâches (celles présentes dans d&apos;autres projets sont seulement retirées de celui-ci)
          </label>
        </fieldset>
      )}
    </Modal>
  );
}
