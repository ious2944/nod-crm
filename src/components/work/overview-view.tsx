"use client";

import { Diamond, Pencil } from "lucide-react";
import NextLink from "next/link";
import { useState } from "react";

import { commentStatusUpdateAction } from "@/app/(app)/tasks/work-actions";
import { VISIBILITY_LABELS } from "@/lib/tasks/constants";
import { relativeTime, shortDate } from "@/lib/tasks/format";
import type { StatusUpdateItem, TaskItem } from "@/lib/tasks/types";

import { computeStats } from "./dashboard-view";
import { useToday } from "./pickers";
import { RichText } from "./rich-text";
import { useWork, useWorkApi } from "./store";
import { Avatar, AvatarStack, BTN_PRIMARY, BTN_SECONDARY, INPUT, ProjectStatusBadge, useUser } from "./ui";

export function OverviewView({
  projectId,
  tasks,
  onEdit,
  onMembers,
  onStatus,
}: {
  projectId: string;
  tasks: TaskItem[];
  onEdit: () => void;
  onMembers: () => void;
  onStatus: () => void;
}) {
  const project = useWork((s) => s.projects[projectId]);
  const updates = useWork((s) => s.statusUpdates[projectId] ?? []);
  const users = useWork((s) => s.context?.users ?? []);
  const owner = useUser(project?.ownerId);
  const today = useToday();
  const { openTask } = useWorkApi();
  if (!project) return null;
  const stats = computeStats(tasks, today);
  const members = users.filter((u) => project.members.some((m) => m.userId === u.id));
  const milestones = tasks.filter((t) => t.isMilestone).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));

  return (
    <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">Description du projet</h2>
              {project.canManage && (
                <button type="button" onClick={onEdit} className={`${BTN_SECONDARY} py-1`}>
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </button>
              )}
            </div>
            {project.description ? <RichText source={project.description} /> : <p className="text-[13px] text-muted">Aucune description. Précisez les objectifs et le périmètre du projet.</p>}
          </section>

          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">Points d&apos;avancement</h2>
              {project.canEdit && (
                <button type="button" onClick={onStatus} className={`${BTN_PRIMARY} py-1`}>
                  Publier un point
                </button>
              )}
            </div>
            {updates.length === 0 ? (
              <p className="text-[13px] text-muted">Aucun point publié. Partagez l&apos;état du projet avec ses membres.</p>
            ) : (
              <ol className="space-y-4">
                {updates.map((update) => (
                  <StatusUpdateCard key={update.id} update={update} />
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border-subtle bg-surface p-4 text-[13px]">
            <dl className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">État</dt>
                <dd>
                  <ProjectStatusBadge status={project.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Responsable</dt>
                <dd className="flex items-center gap-1.5">
                  <Avatar user={owner} size={20} /> {owner?.name ?? "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Dates</dt>
                <dd>
                  {project.startDate ? shortDate(project.startDate, today) : "—"} → {project.dueDate ? shortDate(project.dueDate, today) : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Visibilité</dt>
                <dd>{VISIBILITY_LABELS[project.visibility]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Membres</dt>
                <dd>
                  <button type="button" onClick={onMembers} aria-label="Gérer les membres">
                    <AvatarStack users={members} max={6} size={22} />
                  </button>
                </dd>
              </div>
              {project.organization && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Organisation</dt>
                  <dd>
                    <NextLink href={`/organizations/${project.organization.id}`} className="text-accent hover:underline">
                      {project.organization.label}
                    </NextLink>
                  </dd>
                </div>
              )}
              {project.contact && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Contact</dt>
                  <dd>
                    <NextLink href={`/contacts/${project.contact.id}`} className="text-accent hover:underline">
                      {project.contact.label}
                    </NextLink>
                  </dd>
                </div>
              )}
              {project.opportunity && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Opportunité</dt>
                  <dd>
                    <NextLink href={`/commerce/${project.opportunity.id}`} className="text-accent hover:underline">
                      {project.opportunity.label}
                    </NextLink>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Avancement</h3>
            <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-label="Avancement" aria-valuenow={Math.round(stats.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-2 rounded-full bg-done-fg" style={{ width: `${stats.progress * 100}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-muted">
              {Math.round(stats.progress * 100)} % · {stats.done.length} terminée(s), {stats.open.length} restante(s)
              {stats.overdue.length > 0 && <span className="text-critical-fg"> · {stats.overdue.length} en retard</span>}
            </p>
          </section>
          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Jalons</h3>
            {milestones.length === 0 ? (
              <p className="text-[12px] text-muted">Aucun jalon. Cochez « Jalon » dans le détail d&apos;une tâche.</p>
            ) : (
              <ul className="space-y-1.5">
                {milestones.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => openTask(m.id)} className="flex w-full items-center gap-2 text-left text-[13px] hover:text-accent">
                      <Diamond className={`h-3.5 w-3.5 ${m.status === "DONE" ? "fill-done-fg text-done-fg" : "text-accent"}`} />
                      <span className={`flex-1 truncate ${m.status === "DONE" ? "text-muted line-through" : ""}`}>{m.title}</span>
                      <span className="text-[11px] text-muted">{m.dueDate ? shortDate(m.dueDate, today) : "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatusUpdateCard({ update }: { update: StatusUpdateItem }) {
  const author = useUser(update.authorId);
  const users = useWork((s) => s.context?.users ?? []);
  const { run, store } = useWorkApi();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <ProjectStatusBadge status={update.status} />
        <span className="font-semibold text-ink">{update.title}</span>
        <span className="flex-1" />
        <Avatar user={author} size={18} />
        <span className="text-muted">{author?.name ?? "—"} · {relativeTime(update.createdAt)}</span>
      </div>
      {update.body && <RichText source={update.body} className="mt-2" />}
      {update.comments.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-border-subtle pt-2">
          {update.comments.map((c) => {
            const who = users.find((u) => u.id === c.authorId);
            return (
              <li key={c.id} className="flex gap-2 text-[12px]">
                <Avatar user={who} size={18} />
                <div>
                  <span className="font-medium text-ink">{who?.name ?? "—"}</span> <span className="text-muted">{relativeTime(c.createdAt)}</span>
                  <RichText source={c.body} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open ? (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            const ok = await run(() => commentStatusUpdateAction(update.id, draft));
            if (ok !== null) {
              setDraft("");
              setOpen(false);
              for (const reloader of store.reloaders.values()) void reloader.reload();
            }
          }}
        >
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Votre commentaire" aria-label="Commentaire" maxLength={5000} className={`${INPUT} py-1`} />
          <button type="submit" className={BTN_PRIMARY}>
            Envoyer
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[12px] font-medium text-muted hover:text-ink">
          Commenter
        </button>
      )}
    </li>
  );
}
