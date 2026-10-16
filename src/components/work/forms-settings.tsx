"use client";

import { ClipboardList, Trash } from "lucide-react";
import NextLink from "next/link";
import { useState } from "react";

import { deleteCustomFieldAction, deleteTagAction, saveCustomFieldAction, submitFormAction, updateTagAction } from "@/app/(app)/tasks/work-actions";
import { COLOR_KEYS, COLOR_SWATCH, colorKey, FIELD_TYPE_LABELS, PRIORITY_LABELS, TASK_PRIORITIES } from "@/lib/tasks/constants";
import type { CustomFieldDef, CustomFieldValue, ProjectSummary } from "@/lib/tasks/types";

import { CustomFieldEditor, UserPicker } from "./pickers";
import { RichTextEditor } from "./rich-text";
import { useWork, useWorkApi } from "./store";
import { Avatar, BTN_PRIMARY, BTN_SECONDARY, ColorChip, ConfirmModal, EmptyBlock, ICON_BTN, INPUT, ProjectIcon, useUser } from "./ui";

/* ─── Liste des formulaires ───────────────────────────────────────────────── */

export function FormsList({ forms }: { forms: { id: string; name: string; description: string | null; project: { id: string; name: string; color: string; icon: string } }[] }) {
  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="text-[18px] font-semibold text-ink">Formulaires</h1>
        <p className="text-[12px] text-muted">Déposez une demande : elle devient une tâche dans le projet concerné. Les formulaires se configurent dans « Personnaliser » de chaque projet.</p>
      </header>
      <div className="mx-auto max-w-3xl p-4">
        {forms.length === 0 ? (
          <EmptyBlock icon={ClipboardList} title="Aucun formulaire actif" description="Ouvrez un projet, puis « Personnaliser » → « Formulaires » pour en créer un." />
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
            {forms.map((form) => (
              <li key={form.id}>
                <NextLink href={`/tasks/forms/${form.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted/50">
                  <ProjectIcon icon={form.project.icon} color={form.project.color} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{form.name}</span>
                    <span className="block truncate text-[12px] text-muted">{form.project.name}{form.description ? ` · ${form.description}` : ""}</span>
                  </span>
                </NextLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Saisie d'un formulaire ──────────────────────────────────────────────── */

export function FormFill({
  form,
}: {
  form: { id: string; name: string; description: string | null; isActive: boolean; project: ProjectSummary; fields: { description: boolean; dueDate: boolean; priority: boolean; assignee: boolean; fieldIds: string[] } };
}) {
  const { run, openTask } = useWorkApi();
  const allFields = useWork((s) => s.context?.fields ?? []);
  const fields = allFields.filter((f) => form.fields.fieldIds.includes(f.id));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, CustomFieldValue>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const assignee = useUser(assigneeId);
  const label = "mb-1 block text-[12px] font-semibold text-muted";

  if (!form.isActive) {
    return <EmptyBlock icon={ClipboardList} title="Ce formulaire n'accepte plus de demandes" />;
  }
  if (sent) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-lg border border-border-subtle bg-surface p-6 text-center">
          <p className="text-[15px] font-semibold text-done-fg">Demande envoyée</p>
          <p className="mt-1 text-[13px] text-muted">Une tâche a été créée dans « {form.project.name} ». Vous la suivez et serez notifié de son avancement.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => openTask(sent)}>
              Voir la tâche
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => { setSent(null); setTitle(""); setDescription(""); setCustom({}); }}>
              Nouvelle demande
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <form
          className="space-y-4 rounded-lg border border-border-subtle bg-surface p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            setPending(true);
            const id = await run(() => submitFormAction(form.id, { title: title.trim(), description: description || null, dueDate: dueDate || null, priority, assigneeId, custom }));
            setPending(false);
            if (id) setSent(id);
          }}
        >
          <div className="flex items-center gap-2">
            <ProjectIcon icon={form.project.icon} color={form.project.color} size={28} />
            <div>
              <h1 className="text-[17px] font-semibold text-ink">{form.name}</h1>
              <p className="text-[12px] text-muted">{form.project.name}</p>
            </div>
          </div>
          {form.description && <p className="whitespace-pre-wrap text-[13px] text-muted">{form.description}</p>}
          <div>
            <label htmlFor="form-title" className={label}>
              Objet de la demande *
            </label>
            <input id="form-title" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={INPUT} />
          </div>
          {form.fields.description && (
            <div>
              <span className={label}>Description</span>
              <RichTextEditor value={description} onChange={setDescription} label="Description" minRows={4} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {form.fields.dueDate && (
              <div>
                <label htmlFor="form-due" className={label}>
                  Échéance souhaitée
                </label>
                <input id="form-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
              </div>
            )}
            {form.fields.priority && (
              <div>
                <label htmlFor="form-priority" className={label}>
                  Priorité
                </label>
                <select id="form-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={INPUT}>
                  {[...TASK_PRIORITIES].reverse().map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.fields.assignee && (
              <div>
                <span className={label}>Responsable proposé</span>
                <UserPicker value={assigneeId} onChange={setAssigneeId} className={`${INPUT} flex items-center gap-2 text-left`}>
                  <Avatar user={assignee} size={20} />
                  {assignee?.name ?? <span className="text-muted">Personne</span>}
                </UserPicker>
              </div>
            )}
            {fields.map((field) => (
              <div key={field.id}>
                <span className={label}>{field.name}</span>
                <div className={`${INPUT} min-h-8`}>
                  <CustomFieldEditor field={field} value={custom[field.id]} onChange={(value) => setCustom((c) => ({ ...c, [field.id]: value }))} anchorClassName="w-full" />
                </div>
              </div>
            ))}
          </div>
          <button type="submit" disabled={pending || !title.trim()} className={`${BTN_PRIMARY} w-full`}>
            Envoyer la demande
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Réglages : tags et champs ───────────────────────────────────────────── */

export function WorkSettings() {
  const tags = useWork((s) => s.context?.tags ?? []);
  const fields = useWork((s) => s.context?.fields ?? []);
  const { run, reloadContext } = useWorkApi();
  const [confirm, setConfirm] = useState<{ kind: "tag" | "field"; id: string; name: string } | null>(null);
  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="text-[18px] font-semibold text-ink">Réglages des tâches</h1>
        <p className="text-[12px] text-muted">
          Tags et champs personnalisés partagés par tout l&apos;espace. Préférences de notification :{" "}
          <NextLink href="/tasks/notifications" className="text-accent hover:underline">
            Notifications → Préférences
          </NextLink>
          .
        </p>
      </header>
      <div className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Tags</h2>
          {tags.length === 0 ? (
            <p className="text-[12px] text-muted">Aucun tag. Créez-en depuis le champ « Tags » d&apos;une tâche.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-2 py-1.5">
                  <select aria-label={`Couleur de ${tag.name}`} value={tag.color} onChange={async (e) => { if ((await run(() => updateTagAction(tag.id, { color: e.target.value }))) !== null) void reloadContext(); }} className={`h-6 w-8 rounded border border-border-strong ${COLOR_SWATCH[colorKey(tag.color)]}`}>
                    {COLOR_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <ColorChip color={tag.color}>{tag.name}</ColorChip>
                  <span className="flex-1" />
                  <button type="button" className={ICON_BTN} aria-label={`Supprimer ${tag.name}`} onClick={() => setConfirm({ kind: "tag", id: tag.id, name: tag.name })}>
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Champs personnalisés</h2>
          <NewFieldInline onCreated={() => void reloadContext()} />
          <ul className="mt-2 divide-y divide-border-subtle">
            {fields.map((field: CustomFieldDef) => (
              <li key={field.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="flex-1 text-ink">{field.name}</span>
                <span className="text-[11px] text-muted">{FIELD_TYPE_LABELS[field.type]}{field.options.length ? ` · ${field.options.length} option(s)` : ""}</span>
                <button type="button" className={ICON_BTN} aria-label={`Supprimer ${field.name}`} onClick={() => setConfirm({ kind: "field", id: field.id, name: field.name })}>
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">Activez un champ dans un projet depuis « Personnaliser » → « Champs » ; les options s&apos;y modifient aussi.</p>
        </section>
      </div>
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.kind === "tag" ? "Supprimer le tag ?" : "Supprimer le champ ?"}
        description={confirm?.kind === "tag" ? `« ${confirm?.name} » sera retiré de toutes les tâches.` : `« ${confirm?.name} » et toutes ses valeurs seront supprimés.`}
        confirmLabel="Supprimer"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            const ok = await run(() => (confirm.kind === "tag" ? deleteTagAction(confirm.id) : deleteCustomFieldAction(confirm.id)));
            if (ok !== null) void reloadContext();
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

function NewFieldInline({ onCreated }: { onCreated: () => void }) {
  const { run } = useWorkApi();
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldDef["type"]>("TEXT");
  const [options, setOptions] = useState("");
  const select = type === "SINGLE_SELECT" || type === "MULTI_SELECT";
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const opts = options.split(",").map((o, i) => ({ label: o.trim(), color: COLOR_KEYS[i % COLOR_KEYS.length] })).filter((o) => o.label);
        if (await run(() => saveCustomFieldAction(null, { name: name.trim(), type, options: select ? opts : [] }), "Champ créé.")) {
          setName("");
          setOptions("");
          onCreated();
        }
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du nouveau champ" aria-label="Nom du champ" maxLength={60} className={`${INPUT} w-44 py-1`} />
      <select value={type} onChange={(e) => setType(e.target.value as CustomFieldDef["type"])} aria-label="Type" className={`${INPUT} w-auto py-1`}>
        {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldDef["type"][]).map((t) => (
          <option key={t} value={t}>
            {FIELD_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      {select && <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, séparées par des virgules" aria-label="Options" className={`${INPUT} w-56 py-1`} />}
      <button type="submit" className={BTN_PRIMARY}>
        Créer
      </button>
    </form>
  );
}
