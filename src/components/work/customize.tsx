"use client";

import { Download, ExternalLink, Plus, Trash, Upload, Zap } from "lucide-react";
import NextLink from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteCustomFieldAction,
  deleteFormAction,
  deleteRuleAction,
  deleteTaskTemplateAction,
  importCsvAction,
  saveCustomFieldAction,
  saveFormAction,
  saveRuleAction,
  saveTaskTemplateAction,
  setProjectFieldAction,
} from "@/app/(app)/tasks/work-actions";
import {
  ACTION_LABELS,
  AUTOMATION_TRIGGERS,
  CONDITION_LABELS,
  type AutomationRuleItem,
  type AutomationTrigger,
  type RuleAction,
  type RuleCondition,
  type RuleInput,
} from "@/lib/tasks/automation-model";
import {
  APPROVAL_LABELS,
  COLOR_KEYS,
  COLOR_SWATCH,
  colorKey,
  FIELD_TYPE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/tasks/constants";
import { relativeTime } from "@/lib/tasks/format";
import type { CustomFieldDef, CustomFieldType, ProjectDetail, SectionItem, TaskPriority } from "@/lib/tasks/types";
import type { ProjectSettings } from "@/lib/tasks/work-queries";

import { fetchJson, useWork, useWorkApi } from "./store";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, ConfirmModal, ErrorBlock, ICON_BTN, INPUT, LoadingRows, Modal } from "./ui";

type Tab = "fields" | "rules" | "forms" | "templates" | "csv";

export function CustomizeDrawer({ project, sections, onClose, onChanged }: { project: ProjectDetail; sections: SectionItem[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("fields");
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSettings(await fetchJson<ProjectSettings>(`/api/tasks/projects/${project.id}/settings`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [project.id]);
  useEffect(() => {
    // Chargement des données : l'état n'est mis à jour qu'au retour du réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const tabs: [Tab, string][] = [
    ["fields", "Champs"],
    ["rules", "Règles"],
    ["forms", "Formulaires"],
    ["templates", "Modèles de tâches"],
    ["csv", "Import / export"],
  ];

  return (
    <Modal open title={`Personnaliser « ${project.name} »`} onClose={onClose} size="lg">
      <div role="tablist" aria-label="Personnalisation" className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-border-subtle">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {!settings && !error && <LoadingRows rows={4} />}
      {settings && tab === "fields" && <FieldsTab project={project} onChanged={onChanged} />}
      {settings && tab === "rules" && <RulesTab project={project} sections={sections} settings={settings} reload={load} />}
      {settings && tab === "forms" && <FormsTab project={project} sections={sections} settings={settings} reload={load} />}
      {settings && tab === "templates" && <TemplatesTab project={project} settings={settings} reload={load} />}
      {tab === "csv" && <CsvTab project={project} onImported={onChanged} />}
    </Modal>
  );
}

/* ─── Champs ──────────────────────────────────────────────────────────────── */

function FieldsTab({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const allFields = useWork((s) => s.context?.fields);
  // Champs de la bibliothèque + champs propres à ce projet (jamais ceux d'un autre projet).
  const fields = useMemo(() => (allFields ?? []).filter((f) => f.projectId === null || f.projectId === project.id), [allFields, project.id]);
  const { run, reloadContext, store } = useWorkApi();
  const [editing, setEditing] = useState<CustomFieldDef | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null);
  const toggle = async (field: CustomFieldDef, on: boolean) => {
    const ids = on ? [...project.customFieldIds, field.id] : project.customFieldIds.filter((id) => id !== field.id);
    store.setProject({ ...project, customFieldIds: ids });
    if ((await run(() => setProjectFieldAction(project.id, field.id, on))) === null) store.setProject(project);
    else onChanged();
  };
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">Les champs de la bibliothèque sont partagés par l&apos;espace et activés projet par projet : une tâche présente dans plusieurs projets n&apos;a qu&apos;une valeur par champ. Un champ créé ici est propre à ce projet. Ils apparaissent dans le détail des tâches, les colonnes, les filtres, les tris et les regroupements.</p>
      <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
        {fields.length === 0 && <li className="px-3 py-4 text-center text-[12px] text-muted">Aucun champ personnalisé.</li>}
        {fields.map((field) => (
          <li key={field.id} className="flex items-center gap-2 px-3 py-2">
            <input type="checkbox" aria-label={`Activer ${field.name} dans ce projet`} checked={project.customFieldIds.includes(field.id)} disabled={!project.canEdit} onChange={(e) => void toggle(field, e.target.checked)} className="accent-[var(--nod-accent)]" />
            <span className="flex-1 text-[13px] text-ink">
              {field.name}
              {field.projectId && <span className="ml-2 text-[11px] text-muted">(propre au projet)</span>}
            </span>
            <span className="text-[11px] text-muted">{FIELD_TYPE_LABELS[field.type]}</span>
            <button type="button" className={BTN_GHOST} onClick={() => setEditing(field)}>
              Modifier
            </button>
            <button type="button" className={ICON_BTN} aria-label={`Supprimer ${field.name}`} onClick={() => setDeleting(field)}>
              <Trash className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={BTN_SECONDARY} onClick={() => setEditing("new")}>
        <Plus className="h-3.5 w-3.5" /> Nouveau champ
      </button>
      {editing && (
        <FieldEditor
          field={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const id = await run(() => saveCustomFieldAction(editing === "new" ? null : editing.id, input, editing === "new" ? project.id : null), "Champ enregistré.");
            if (id) {
              if (editing === "new") store.setProject({ ...project, customFieldIds: [...project.customFieldIds, id] });
              await reloadContext();
              onChanged();
              setEditing(null);
            }
          }}
        />
      )}
      <ConfirmModal
        open={deleting !== null}
        title="Supprimer le champ ?"
        description={`« ${deleting?.name} » et toutes ses valeurs seront supprimés dans tous les projets.`}
        confirmLabel="Supprimer"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting && (await run(() => deleteCustomFieldAction(deleting.id))) !== null) {
            await reloadContext();
            onChanged();
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function FieldEditor({ field, onClose, onSave }: { field: CustomFieldDef | null; onClose: () => void; onSave: (input: { name: string; type: CustomFieldType; options: { id?: string; label: string; color: string }[] }) => Promise<void> }) {
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "TEXT");
  const [options, setOptions] = useState(field?.options ?? [{ id: "", label: "", color: "blue" }]);
  const select = type === "SINGLE_SELECT" || type === "MULTI_SELECT";
  return (
    <Modal
      open
      title={field ? "Modifier le champ" : "Nouveau champ"}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={!name.trim()} onClick={() => void onSave({ name: name.trim(), type, options: select ? options.filter((o) => o.label.trim()).map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label.trim(), color: o.color })) : [] })}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du champ" aria-label="Nom du champ" maxLength={60} className={INPUT} />
        <select value={type} disabled={Boolean(field)} onChange={(e) => setType(e.target.value as CustomFieldType)} aria-label="Type" className={INPUT}>
          {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {select && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-muted">Options</p>
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select aria-label="Couleur" value={option.color} onChange={(e) => setOptions(options.map((o, j) => (j === i ? { ...o, color: e.target.value } : o)))} className={`h-7 w-9 rounded border border-border-strong ${COLOR_SWATCH[colorKey(option.color)]}`}>
                  {COLOR_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input value={option.label} onChange={(e) => setOptions(options.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)))} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} maxLength={60} className={`${INPUT} py-1`} />
                <button type="button" aria-label="Retirer l'option" onClick={() => setOptions(options.filter((_, j) => j !== i))} className={ICON_BTN}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button type="button" className={BTN_GHOST} onClick={() => setOptions([...options, { id: "", label: "", color: COLOR_KEYS[options.length % COLOR_KEYS.length] }])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une option
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Règles ──────────────────────────────────────────────────────────────── */

const PRESETS: { label: string; build: (sections: SectionItem[]) => RuleInput }[] = [
  {
    label: "Tâche urgente → notifier le responsable",
    build: () => ({ name: "Urgente : prévenir le responsable", trigger: "PRIORITY_CHANGED", triggerConfig: { priority: "URGENT" }, conditions: [], actions: [{ kind: "notify", target: "assignee", message: "Une tâche dont vous êtes responsable est passée en urgente." }], isEnabled: true }),
  },
  {
    label: "Tâche terminée → déplacer dans une section",
    build: (sections) => ({ name: "Terminée : ranger dans la dernière section", trigger: "TASK_COMPLETED", triggerConfig: {}, conditions: [], actions: sections.length ? [{ kind: "move_to_section", sectionId: sections[sections.length - 1].id }] : [{ kind: "notify", target: "followers" }], isEnabled: true }),
  },
  {
    label: "Sous-tâches terminées → proposer de terminer la parente",
    build: () => ({ name: "Proposer de terminer la tâche parente", trigger: "SUBTASKS_COMPLETED", triggerConfig: {}, conditions: [], actions: [{ kind: "suggest_complete_parent" }], isEnabled: true }),
  },
  {
    label: "Échéance dans 2 jours → rappel",
    build: () => ({ name: "Rappel 2 jours avant l'échéance", trigger: "DUE_DATE_APPROACHING", triggerConfig: { days: 2 }, conditions: [], actions: [{ kind: "create_reminder" }], isEnabled: true }),
  },
];

function RulesTab({ project, sections, settings, reload }: { project: ProjectDetail; sections: SectionItem[]; settings: ProjectSettings; reload: () => Promise<void> }) {
  const { run } = useWorkApi();
  const [editing, setEditing] = useState<{ id: string | null; scope: string | null; input: RuleInput } | null>(null);
  const runsFor = (id: string) => settings.runs.filter((r) => r.ruleId === id).slice(0, 5);
  const save = async (id: string | null, scope: string | null, input: RuleInput) => {
    const ok = await run(() => saveRuleAction(id, scope, input), "Règle enregistrée.");
    if (ok) {
      await reload();
      setEditing(null);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">Une règle associe un déclencheur, des conditions facultatives et des actions. Chaque exécution est tracée ; une règle ne s&apos;exécute jamais deux fois pour le même événement et les enchaînements de règles sont bornés pour éviter les boucles.</p>
      {project.canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" onClick={() => setEditing({ id: null, scope: project.id, input: preset.build(sections) })} className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[12px] hover:bg-surface-muted">
              <Zap className="h-3 w-3 text-accent" /> {preset.label}
            </button>
          ))}
          <button type="button" className={BTN_SECONDARY} onClick={() => setEditing({ id: null, scope: project.id, input: { name: "", trigger: "TASK_CREATED", triggerConfig: {}, conditions: [], actions: [{ kind: "set_priority", priority: "HIGH" }], isEnabled: true } })}>
            <Plus className="h-3.5 w-3.5" /> Règle personnalisée
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {settings.rules.length === 0 && <li className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-[12px] text-muted">Aucune règle.</li>}
        {settings.rules.map((rule) => (
          <li key={rule.id} className="rounded-md border border-border-subtle p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                aria-label={rule.isEnabled ? "Désactiver la règle" : "Activer la règle"}
                checked={rule.isEnabled}
                disabled={!project.canEdit}
                onChange={(e) => void save(rule.id, rule.projectId, { name: rule.name, trigger: rule.trigger, triggerConfig: rule.triggerConfig, conditions: rule.conditions, actions: rule.actions, isEnabled: e.target.checked })}
                className="accent-[var(--nod-accent)]"
              />
              <span className="flex-1 text-[13px] font-medium text-ink">{rule.name}</span>
              {!rule.projectId && <span className="rounded bg-surface-muted px-1.5 text-[11px] text-muted">Tout l&apos;espace</span>}
              <span className="text-[11px] text-muted">{rule.runCount} exécution(s){rule.lastRunAt && `, dernière ${relativeTime(rule.lastRunAt)}`}</span>
              {project.canEdit && (
                <>
                  <button type="button" className={BTN_GHOST} onClick={() => setEditing({ id: rule.id, scope: rule.projectId, input: rule })}>
                    Modifier
                  </button>
                  <button type="button" className={ICON_BTN} aria-label={`Supprimer ${rule.name}`} onClick={async () => { if ((await run(() => deleteRuleAction(rule.id))) !== null) await reload(); }}>
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
            <p className="mt-1 text-[12px] text-muted">
              Quand : {AUTOMATION_TRIGGERS[rule.trigger]}
              {rule.conditions.length > 0 && ` · si ${rule.conditions.map((c) => CONDITION_LABELS[c.kind].toLowerCase()).join(", ")}`} · alors : {rule.actions.map((a) => ACTION_LABELS[a.kind].toLowerCase()).join(", ")}
            </p>
            {runsFor(rule.id).length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-border-subtle pt-1.5 text-[11px]">
                {runsFor(rule.id).map((r) => (
                  <li key={r.id} className={r.status === "ERROR" ? "text-critical-fg" : r.status === "SKIPPED" ? "text-muted" : "text-done-fg"}>
                    {relativeTime(r.createdAt)} — {r.status === "SUCCESS" ? "Exécutée" : r.status === "SKIPPED" ? "Ignorée" : r.status === "RUNNING" ? "En cours" : "Erreur"}
                    {r.message && ` : ${r.message}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {editing && <RuleEditor initial={editing.input} sections={sections} onClose={() => setEditing(null)} onSave={(input) => save(editing.id, editing.scope, input)} />}
    </div>
  );
}

function RuleEditor({ initial, sections, onClose, onSave }: { initial: RuleInput; sections: SectionItem[]; onClose: () => void; onSave: (input: RuleInput) => Promise<void> }) {
  const [rule, setRule] = useState<RuleInput>(initial);
  const users = useWork((s) => s.context?.users ?? []);
  const tags = useWork((s) => s.context?.tags ?? []);
  const cfg = rule.triggerConfig ?? {};
  const setCondition = (i: number, c: RuleCondition) => setRule({ ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: RuleAction) => setRule({ ...rule, actions: rule.actions.map((x, j) => (j === i ? a : x)) });
  const sel = `${INPUT} w-auto py-1`;

  const defaultCondition = (kind: RuleCondition["kind"]): RuleCondition | null => {
    switch (kind) {
      case "priority_in":
        return { kind, values: ["URGENT"] };
      case "status_in":
        return { kind, values: ["TODO"] };
      case "assignee_is":
        return { kind, userId: users[0]?.id ?? null };
      case "has_tag":
        return tags[0] ? { kind, tagId: tags[0].id } : null;
      case "in_section":
        return sections[0] ? { kind, sectionId: sections[0].id } : null;
      default:
        return { kind } as RuleCondition;
    }
  };
  const defaultAction = (kind: RuleAction["kind"]): RuleAction | null => {
    switch (kind) {
      case "set_status":
        return { kind, status: "IN_PROGRESS" };
      case "set_priority":
        return { kind, priority: "HIGH" };
      case "set_assignee":
        return { kind, userId: users[0]?.id ?? null };
      case "move_to_section":
        return sections[0] ? { kind, sectionId: sections[0].id } : null;
      case "add_tag":
        return tags[0] ? { kind, tagId: tags[0].id } : null;
      case "notify":
        return { kind, target: "assignee" };
      case "add_comment":
        return { kind, body: "Message automatique" };
      case "set_due_in_days":
        return { kind, days: 3 };
      default:
        return { kind } as RuleAction;
    }
  };

  return (
    <Modal
      open
      title={initial.name ? "Modifier la règle" : "Nouvelle règle"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={!rule.name.trim() || rule.actions.length === 0} onClick={() => void onSave(rule)}>
            Enregistrer la règle
          </button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <input autoFocus value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="Nom de la règle" aria-label="Nom de la règle" maxLength={120} className={INPUT} />
        <fieldset>
          <legend className="mb-1 text-[12px] font-semibold text-muted">Quand…</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Déclencheur" value={rule.trigger} onChange={(e) => setRule({ ...rule, trigger: e.target.value as AutomationTrigger, triggerConfig: {} })} className={sel}>
              {(Object.keys(AUTOMATION_TRIGGERS) as AutomationTrigger[]).map((t) => (
                <option key={t} value={t}>
                  {AUTOMATION_TRIGGERS[t]}
                </option>
              ))}
            </select>
            {rule.trigger === "STATUS_CHANGED" && (
              <select aria-label="Nouveau statut" value={cfg.status ?? ""} onChange={(e) => setRule({ ...rule, triggerConfig: { ...cfg, status: (e.target.value || undefined) as never } })} className={sel}>
                <option value="">vers n&apos;importe quel statut</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    vers « {STATUS_LABELS[s]} »
                  </option>
                ))}
              </select>
            )}
            {rule.trigger === "PRIORITY_CHANGED" && (
              <select aria-label="Nouvelle priorité" value={cfg.priority ?? ""} onChange={(e) => setRule({ ...rule, triggerConfig: { ...cfg, priority: (e.target.value || undefined) as never } })} className={sel}>
                <option value="">vers n&apos;importe quelle priorité</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    vers « {PRIORITY_LABELS[p]} »
                  </option>
                ))}
              </select>
            )}
            {rule.trigger === "SECTION_CHANGED" && (
              <select aria-label="Section" value={cfg.sectionId ?? ""} onChange={(e) => setRule({ ...rule, triggerConfig: { ...cfg, sectionId: e.target.value || undefined } })} className={sel}>
                <option value="">n&apos;importe quelle section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    « {s.name} »
                  </option>
                ))}
              </select>
            )}
            {rule.trigger === "APPROVAL_CHANGED" && (
              <select aria-label="Validation" value={cfg.approvalStatus ?? ""} onChange={(e) => setRule({ ...rule, triggerConfig: { ...cfg, approvalStatus: (e.target.value || undefined) as never } })} className={sel}>
                <option value="">n&apos;importe quelle réponse</option>
                {(Object.keys(APPROVAL_LABELS) as (keyof typeof APPROVAL_LABELS)[]).map((s) => (
                  <option key={s} value={s}>
                    « {APPROVAL_LABELS[s]} »
                  </option>
                ))}
              </select>
            )}
            {rule.trigger === "DUE_DATE_APPROACHING" && (
              <label className="flex items-center gap-1">
                dans
                <input type="number" min={0} max={60} value={cfg.days ?? 1} onChange={(e) => setRule({ ...rule, triggerConfig: { ...cfg, days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })} className={`${INPUT} w-16 py-1`} aria-label="Nombre de jours" />
                jour(s) ou moins
              </label>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-[12px] font-semibold text-muted">Si (facultatif)…</legend>
          <ul className="space-y-1.5">
            {rule.conditions.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span>{CONDITION_LABELS[c.kind]}</span>
                {c.kind === "priority_in" && (
                  <select aria-label="Priorité" value={c.values[0]} onChange={(e) => setCondition(i, { ...c, values: [e.target.value as TaskPriority] })} className={sel}>
                    {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                )}
                {c.kind === "status_in" && (
                  <select aria-label="Statut" value={c.values[0]} onChange={(e) => setCondition(i, { ...c, values: [e.target.value as never] })} className={sel}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                )}
                {c.kind === "assignee_is" && (
                  <select aria-label="Responsable" value={c.userId ?? ""} onChange={(e) => setCondition(i, { ...c, userId: e.target.value || null })} className={sel}>
                    <option value="">Personne</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                {c.kind === "has_tag" && (
                  <select aria-label="Tag" value={c.tagId} onChange={(e) => setCondition(i, { ...c, tagId: e.target.value })} className={sel}>
                    {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {c.kind === "in_section" && (
                  <select aria-label="Section" value={c.sectionId} onChange={(e) => setCondition(i, { ...c, sectionId: e.target.value })} className={sel}>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                <button type="button" aria-label="Retirer la condition" onClick={() => setRule({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })} className={ICON_BTN}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <select aria-label="Ajouter une condition" value="" onChange={(e) => { const c = defaultCondition(e.target.value as RuleCondition["kind"]); if (c) setRule({ ...rule, conditions: [...rule.conditions, c] }); }} className={`${sel} mt-1.5`}>
            <option value="">+ Ajouter une condition</option>
            {(Object.keys(CONDITION_LABELS) as RuleCondition["kind"][]).map((k) => <option key={k} value={k}>{CONDITION_LABELS[k]}</option>)}
          </select>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-[12px] font-semibold text-muted">Alors…</legend>
          <ul className="space-y-1.5">
            {rule.actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span>{ACTION_LABELS[a.kind]}</span>
                {a.kind === "set_status" && (
                  <select aria-label="Statut" value={a.status} onChange={(e) => setAction(i, { ...a, status: e.target.value as never })} className={sel}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                )}
                {a.kind === "set_priority" && (
                  <select aria-label="Priorité" value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value as never })} className={sel}>
                    {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                )}
                {a.kind === "set_assignee" && (
                  <select aria-label="Responsable" value={a.userId ?? ""} onChange={(e) => setAction(i, { ...a, userId: e.target.value || null })} className={sel}>
                    <option value="">Personne</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                {a.kind === "move_to_section" && (
                  <select aria-label="Section" value={a.sectionId} onChange={(e) => setAction(i, { ...a, sectionId: e.target.value })} className={sel}>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {a.kind === "add_tag" && (
                  <select aria-label="Tag" value={a.tagId} onChange={(e) => setAction(i, { ...a, tagId: e.target.value })} className={sel}>
                    {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {a.kind === "notify" && (
                  <>
                    <select aria-label="Destinataire" value={a.target} onChange={(e) => setAction(i, { ...a, target: e.target.value as never })} className={sel}>
                      <option value="assignee">le responsable</option>
                      <option value="followers">les abonnés</option>
                      <option value="project_owner">le responsable du projet</option>
                      <option value="user">une personne précise</option>
                    </select>
                    {a.target === "user" && (
                      <select aria-label="Personne" value={a.userId ?? ""} onChange={(e) => setAction(i, { ...a, userId: e.target.value || undefined })} className={sel}>
                        <option value="">Choisir…</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    )}
                    <input value={a.message ?? ""} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Message (facultatif)" aria-label="Message" maxLength={300} className={`${INPUT} w-56 py-1`} />
                  </>
                )}
                {a.kind === "create_reminder" && <input value={a.message ?? ""} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Message (facultatif)" aria-label="Message" maxLength={300} className={`${INPUT} w-56 py-1`} />}
                {a.kind === "add_comment" && <input value={a.body} onChange={(e) => setAction(i, { ...a, body: e.target.value })} aria-label="Commentaire" maxLength={2000} className={`${INPUT} w-64 py-1`} />}
                {a.kind === "set_due_in_days" && (
                  <input type="number" min={0} max={365} value={a.days} onChange={(e) => setAction(i, { ...a, days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} aria-label="Nombre de jours" className={`${INPUT} w-16 py-1`} />
                )}
                <button type="button" aria-label="Retirer l'action" onClick={() => setRule({ ...rule, actions: rule.actions.filter((_, j) => j !== i) })} className={ICON_BTN}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <select aria-label="Ajouter une action" value="" onChange={(e) => { const a = defaultAction(e.target.value as RuleAction["kind"]); if (a) setRule({ ...rule, actions: [...rule.actions, a] }); }} className={`${sel} mt-1.5`}>
            <option value="">+ Ajouter une action</option>
            {(Object.keys(ACTION_LABELS) as RuleAction["kind"][]).map((k) => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
          </select>
        </fieldset>
      </div>
    </Modal>
  );
}

/* ─── Formulaires ─────────────────────────────────────────────────────────── */

type FormItem = ProjectSettings["forms"][number];

function FormsTab({ project, sections, settings, reload }: { project: ProjectDetail; sections: SectionItem[]; settings: ProjectSettings; reload: () => Promise<void> }) {
  const { run } = useWorkApi();
  const fields = useWork((s) => s.context?.fields ?? []);
  const [editing, setEditing] = useState<FormItem | "new" | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">Un formulaire interne permet à tout membre de l&apos;espace pouvant voir le projet de déposer une demande : chaque envoi crée une tâche dans la section choisie, et le responsable du projet est notifié.</p>
      <ul className="space-y-2">
        {settings.forms.length === 0 && <li className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-[12px] text-muted">Aucun formulaire.</li>}
        {settings.forms.map((form) => (
          <li key={form.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle px-3 py-2">
            <span className="flex-1 text-[13px] font-medium text-ink">
              {form.name}
              {!form.isActive && <span className="ml-2 text-[11px] text-muted">(désactivé)</span>}
            </span>
            <span className="text-[11px] text-muted">{form.submissions} envoi(s)</span>
            <NextLink href={`/tasks/forms/${form.id}`} className={BTN_GHOST} target="_blank">
              <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
            </NextLink>
            {project.canEdit && (
              <>
                <button type="button" className={BTN_GHOST} onClick={() => setEditing(form)}>
                  Modifier
                </button>
                <button type="button" className={ICON_BTN} aria-label={`Supprimer ${form.name}`} onClick={async () => { if ((await run(() => deleteFormAction(form.id))) !== null) await reload(); }}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {project.canEdit && (
        <button type="button" className={BTN_SECONDARY} onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" /> Nouveau formulaire
        </button>
      )}
      {editing && (
        <FormEditor
          form={editing === "new" ? null : editing}
          sections={sections}
          fields={fields.filter((f) => project.customFieldIds.includes(f.id))}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (await run(() => saveFormAction(editing === "new" ? null : editing.id, project.id, input), "Formulaire enregistré.")) {
              await reload();
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function FormEditor({ form, sections, fields, onClose, onSave }: { form: FormItem | null; sections: SectionItem[]; fields: CustomFieldDef[]; onClose: () => void; onSave: (input: unknown) => Promise<void> }) {
  const [name, setName] = useState(form?.name ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [sectionId, setSectionId] = useState<string | null>(form?.sectionId ?? sections[0]?.id ?? null);
  const [isActive, setIsActive] = useState(form?.isActive ?? true);
  const [config, setConfig] = useState(form?.fields ?? { description: true, dueDate: false, priority: false, assignee: false, fieldIds: [] as string[] });
  return (
    <Modal
      open
      title={form ? "Modifier le formulaire" : "Nouveau formulaire"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={!name.trim()} onClick={() => void onSave({ name: name.trim(), description: description.trim() || null, sectionId, isActive, fields: config })}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du formulaire (ex. « Demande de devis »)" aria-label="Nom" maxLength={120} className={INPUT} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Consignes affichées en tête du formulaire" aria-label="Description" rows={3} maxLength={2000} className={INPUT} />
        <label className="flex items-center gap-2">
          Les tâches arrivent dans
          <select value={sectionId ?? ""} onChange={(e) => setSectionId(e.target.value || null)} aria-label="Section" className={`${INPUT} w-auto py-1`}>
            <option value="">Sans section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-[12px] font-semibold text-muted">Questions posées (le titre est toujours demandé)</legend>
          {([
            ["description", "Description"],
            ["dueDate", "Échéance souhaitée"],
            ["priority", "Priorité"],
            ["assignee", "Responsable proposé"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.checked })} className="accent-[var(--nod-accent)]" />
              {label}
            </label>
          ))}
          {fields.map((f) => (
            <label key={f.id} className="flex items-center gap-2">
              <input type="checkbox" checked={config.fieldIds.includes(f.id)} onChange={(e) => setConfig({ ...config, fieldIds: e.target.checked ? [...config.fieldIds, f.id] : config.fieldIds.filter((id) => id !== f.id) })} className="accent-[var(--nod-accent)]" />
              {f.name} <span className="text-[11px] text-muted">(champ personnalisé)</span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-[var(--nod-accent)]" />
          Formulaire actif
        </label>
      </div>
    </Modal>
  );
}

/* ─── Modèles de tâches ───────────────────────────────────────────────────── */

type TemplateItem = ProjectSettings["templates"][number];

function TemplatesTab({ project, settings, reload }: { project: ProjectDetail; settings: ProjectSettings; reload: () => Promise<void> }) {
  const { run } = useWorkApi();
  const [editing, setEditing] = useState<TemplateItem | "new" | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">Un modèle pré-remplit une nouvelle tâche : titre, description, priorité, estimation, sous-tâches. Choisissez-le dans « Ajouter une tâche ». Vous pouvez aussi enregistrer une tâche existante comme modèle depuis son panneau.</p>
      <ul className="space-y-2">
        {settings.templates.length === 0 && <li className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-[12px] text-muted">Aucun modèle.</li>}
        {settings.templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle px-3 py-2">
            <span className="flex-1 text-[13px] font-medium text-ink">
              {t.name}
              {!t.projectId && <span className="ml-2 rounded bg-surface-muted px-1.5 text-[11px] text-muted">Tout l&apos;espace</span>}
            </span>
            <span className="text-[11px] text-muted">{t.subtasks.length} sous-tâche(s)</span>
            {project.canEdit && (
              <>
                <button type="button" className={BTN_GHOST} onClick={() => setEditing(t)}>
                  Modifier
                </button>
                <button type="button" className={ICON_BTN} aria-label={`Supprimer ${t.name}`} onClick={async () => { if ((await run(() => deleteTaskTemplateAction(t.id))) !== null) await reload(); }}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {project.canEdit && (
        <button type="button" className={BTN_SECONDARY} onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" /> Nouveau modèle
        </button>
      )}
      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (await run(() => saveTaskTemplateAction(editing === "new" ? null : editing.id, { ...input, projectId: editing === "new" ? project.id : editing.projectId }), "Modèle enregistré.")) {
              await reload();
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSave }: { template: TemplateItem | null; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(template?.priority ?? "NORMAL");
  const [estimate, setEstimate] = useState(template?.estimatedMinutes?.toString() ?? "");
  const [isApproval, setIsApproval] = useState(template?.isApproval ?? false);
  const [subtasks, setSubtasks] = useState((template?.subtasks ?? []).join("\n"));
  return (
    <Modal
      open
      title={template ? "Modifier le modèle" : "Nouveau modèle de tâche"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={!name.trim() || !title.trim()}
            onClick={() => void onSave({ name: name.trim(), title: title.trim(), description: description.trim() || null, priority, estimatedMinutes: estimate ? Number(estimate) : null, isApproval, subtasks: subtasks.split("\n").map((s) => s.trim()).filter(Boolean) })}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du modèle" aria-label="Nom du modèle" maxLength={120} className={INPUT} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de la tâche créée" aria-label="Titre de la tâche" maxLength={300} className={INPUT} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (Markdown)" aria-label="Description" rows={4} className={INPUT} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            Priorité
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={`${INPUT} w-auto py-1`}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Estimation (min)
            <input type="number" min={0} value={estimate} onChange={(e) => setEstimate(e.target.value)} className={`${INPUT} w-20 py-1`} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={isApproval} onChange={(e) => setIsApproval(e.target.checked)} className="accent-[var(--nod-accent)]" />
            Demande de validation
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-muted">Sous-tâches (une par ligne)</span>
          <textarea value={subtasks} onChange={(e) => setSubtasks(e.target.value)} rows={5} className={INPUT} />
        </label>
      </div>
    </Modal>
  );
}

/* ─── CSV ─────────────────────────────────────────────────────────────────── */

function CsvTab({ project, onImported }: { project: ProjectDetail; onImported: () => void }) {
  const { run } = useWorkApi();
  const input = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<{ created: number; skipped: { line: number; reason: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 text-[13px]">
      <section>
        <h3 className="mb-1 font-semibold text-ink">Exporter</h3>
        <p className="mb-2 text-[12px] text-muted">Toutes les tâches du projet (sous-tâches comprises), au format CSV compatible Excel.</p>
        <a href={`/api/tasks/export?projectId=${project.id}`} className={BTN_SECONDARY}>
          <Download className="h-3.5 w-3.5" /> Télécharger le CSV
        </a>
      </section>
      <section>
        <h3 className="mb-1 font-semibold text-ink">Importer</h3>
        <p className="mb-2 text-[12px] text-muted">
          Colonnes reconnues : <strong>Nom</strong> (obligatoire), Description, Responsable (e-mail ou nom), Début, Échéance (JJ/MM/AAAA ou AAAA-MM-JJ), Statut, Priorité, Section (créée si besoin), Tags (séparés par des virgules), Estimation. 2 000 lignes maximum.
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            const text = await file.text();
            const result = await run(() => importCsvAction(project.id, text));
            setBusy(false);
            if (input.current) input.current.value = "";
            if (result) {
              setReport(result);
              onImported();
            }
          }}
        />
        <button type="button" disabled={!project.canEdit || busy} className={BTN_PRIMARY} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {busy ? "Import en cours…" : "Choisir un fichier CSV"}
        </button>
        {report && (
          <div className="mt-3 rounded-md border border-border-subtle p-3 text-[12px]">
            <p className="font-medium text-done-fg">{report.created} tâche(s) importée(s).</p>
            {report.skipped.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto text-late-fg">
                {report.skipped.map((s) => (
                  <li key={s.line}>
                    Ligne {s.line} ignorée : {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export type { AutomationRuleItem };
