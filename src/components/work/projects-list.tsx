"use client";

import { FileText, Folder, Lock, Plus, Star } from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setFavoriteAction } from "@/app/(app)/tasks/work-actions";
import { shortDate } from "@/lib/tasks/format";
import type { ProjectSummary } from "@/lib/tasks/types";

import { ProjectFormModal } from "./project-dialogs";
import { useToday } from "./pickers";
import { useWork, useWorkApi } from "./store";
import { AvatarStack, BTN_PRIMARY, BTN_SECONDARY, EmptyBlock, ICON_BTN, ProjectIcon, ProjectStatusBadge } from "./ui";

type Row = ProjectSummary & { taskCount: number; doneCount: number; overdueCount: number; dueDate: string | null; startDate: string | null; memberIds: string[] };

const SCOPE_LABELS = { active: "Actifs", archived: "Archivés", templates: "Modèles" } as const;

export function ProjectsList({ projects, scope }: { projects: Row[]; scope: "active" | "archived" | "templates" | "favorites" }) {
  const router = useRouter();
  const { run, store } = useWorkApi();
  const users = useWork((s) => s.context?.users ?? []);
  const today = useToday();
  const [creating, setCreating] = useState<{ templateId?: string } | null>(null);
  const [rows, setRows] = useState(projects);
  const [source, setSource] = useState(projects);
  if (source !== projects) {
    setSource(projects);
    setRows(projects);
  }

  const toggleFavorite = async (p: Row) => {
    const next = !p.isFavorite;
    setRows((list) => list.map((r) => (r.id === p.id ? { ...r, isFavorite: next } : r)));
    if ((await run(() => setFavoriteAction(p.id, next))) === null) setRows((list) => list.map((r) => (r.id === p.id ? { ...r, isFavorite: !next } : r)));
    else if (store.state.context) store.setContext({ ...store.state.context, projects: store.state.context.projects.map((x) => (x.id === p.id ? { ...x, isFavorite: next } : x)) });
  };

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="flex-1 text-[18px] font-semibold text-ink">{scope === "favorites" ? "Projets favoris" : "Projets"}</h1>
        <button type="button" className={BTN_PRIMARY} onClick={() => setCreating({})}>
          <Plus className="h-3.5 w-3.5" /> Nouveau projet
        </button>
      </header>
      {scope !== "favorites" && (
        <nav aria-label="Filtre des projets" className="flex gap-1 border-b border-border-subtle bg-surface px-4">
          {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((key) => (
            <NextLink key={key} href={`/tasks/projects?scope=${key}`} aria-current={scope === key ? "page" : undefined} className={`border-b-2 px-3 py-2 text-[13px] font-medium ${scope === key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {SCOPE_LABELS[key]}
            </NextLink>
          ))}
        </nav>
      )}
      <div className="mx-auto max-w-5xl p-4">
        {rows.length === 0 ? (
          <EmptyBlock
            icon={scope === "templates" ? FileText : scope === "favorites" ? Star : Folder}
            title={scope === "templates" ? "Aucun modèle de projet" : scope === "archived" ? "Aucun projet archivé" : scope === "favorites" ? "Aucun favori" : "Aucun projet"}
            description={
              scope === "templates"
                ? "Depuis un projet, choisissez « Enregistrer comme modèle » dans son menu d'actions."
                : scope === "favorites"
                  ? "Cliquez sur l'étoile d'un projet pour le retrouver ici et dans la navigation."
                  : "Créez un projet pour organiser des tâches en sections, avec liste, tableau, calendrier et chronologie."
            }
            action={scope === "active" ? <button type="button" className={BTN_PRIMARY} onClick={() => setCreating({})}>Créer un projet</button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
            {rows.map((p) => {
              const progress = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-surface-muted/50">
                  <button type="button" onClick={() => void toggleFavorite(p)} aria-pressed={p.isFavorite} aria-label={p.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"} className={ICON_BTN}>
                    <Star className={`h-4 w-4 ${p.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                  </button>
                  <NextLink href={`/tasks/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <ProjectIcon icon={p.icon} color={p.color} size={28} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-ink">
                        {p.name}
                        {p.visibility === "PRIVATE" && <Lock aria-label="Privé" className="h-3 w-3 text-muted" />}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {p.taskCount} tâche(s) · {progress} % terminé
                        {p.overdueCount > 0 && <span className="text-critical-fg"> · {p.overdueCount} en retard</span>}
                        {p.dueDate && ` · échéance ${shortDate(p.dueDate, today)}`}
                      </span>
                    </span>
                  </NextLink>
                  <ProjectStatusBadge status={p.status} />
                  <AvatarStack users={users.filter((u) => p.memberIds.includes(u.id))} max={4} size={22} />
                  {scope === "templates" && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => setCreating({ templateId: p.id })}>
                      Utiliser ce modèle
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {creating && <ProjectFormModal onClose={() => setCreating(null)} defaults={{ templateId: creating.templateId }} onSaved={() => router.refresh()} />}
    </div>
  );
}
