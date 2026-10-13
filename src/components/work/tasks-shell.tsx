"use client";

import {
  Bell,
  ChartColumn,
  CircleCheck,
  ClipboardList,
  Folder,
  Gauge,
  Plus,
  Search,
  Settings,
  Star,
} from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { WorkContext } from "@/lib/tasks/types";

import { ProjectFormModal } from "./project-dialogs";
import { useHydrate, useWork } from "./store";
import { ICON_BTN, ProjectIcon } from "./ui";

const hydrateContext = (store: Parameters<Parameters<typeof useHydrate>[1]>[0], context: WorkContext, silent: boolean) => {
  // Le contexte rendu par le serveur ne remplace pas une version plus récente
  // déjà chargée côté client (navigation entre pages du module).
  if (!store.state.context || !silent) store.setContext(context, silent);
};

const MAIN = [
  { href: "/tasks", label: "Mes tâches", icon: CircleCheck, exact: true },
  { href: "/tasks/notifications", label: "Notifications", icon: Bell },
  { href: "/tasks/search", label: "Recherche", icon: Search },
];

const MORE = [
  { href: "/tasks/projects", label: "Tous les projets", icon: Folder, exact: true },
  { href: "/tasks/portfolio", label: "Synthèse des projets", icon: ChartColumn },
  { href: "/tasks/workload", label: "Charge de travail", icon: Gauge },
  { href: "/tasks/forms", label: "Formulaires", icon: ClipboardList },
  { href: "/tasks/settings", label: "Réglages", icon: Settings },
];

export function TasksShell({ context, children }: { context: WorkContext; children: ReactNode }) {
  useHydrate(context, hydrateContext);
  const pathname = usePathname();
  const live = useWork((s) => s.context) ?? context;
  const [creating, setCreating] = useState(false);
  const projects = live.projects.filter((p) => !p.archived && !p.isTemplate);
  const favorites = projects.filter((p) => p.isFavorite);
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const link = (item: { href: string; label: string; icon: typeof Bell; exact?: boolean }, badge?: number) => (
    <NextLink
      key={item.href}
      href={item.href}
      aria-current={active(item.href, item.exact) ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors ${active(item.href, item.exact) ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-muted hover:text-ink"}`}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {badge ? <span className="rounded-full bg-critical-fg px-1.5 text-[10px] font-semibold text-white">{badge > 99 ? "99+" : badge}</span> : null}
    </NextLink>
  );

  const projectLink = (p: (typeof projects)[number]) => (
    <NextLink
      key={p.id}
      href={`/tasks/projects/${p.id}`}
      aria-current={pathname.startsWith(`/tasks/projects/${p.id}`) ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${pathname.startsWith(`/tasks/projects/${p.id}`) ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-muted"}`}
    >
      <ProjectIcon icon={p.icon} color={p.color} size={18} />
      <span className="truncate">{p.name}</span>
    </NextLink>
  );

  return (
    <div className="flex min-h-0 flex-col md:h-dvh md:flex-row">
      {/* Mobile : barre horizontale */}
      <nav aria-label="Gestion des tâches" className="flex gap-1 overflow-x-auto border-b border-border-subtle bg-surface px-2 py-1.5 md:hidden">
        {[...MAIN, { href: "/tasks/projects", label: "Projets", icon: Folder, exact: true }, { href: "/tasks/favorites", label: "Favoris", icon: Star, exact: true }, ...MORE.slice(1)].map((item) => (
          <NextLink key={item.href} href={item.href} aria-current={active(item.href, item.exact) ? "page" : undefined} className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${active(item.href, item.exact) ? "bg-accent-soft text-accent" : "text-muted"}`}>
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
            {item.href === "/tasks/notifications" && live.unreadCount > 0 && <span className="rounded-full bg-critical-fg px-1 text-[10px] text-white">{live.unreadCount}</span>}
          </NextLink>
        ))}
      </nav>

      {/* Bureau : colonne latérale */}
      <aside aria-label="Gestion des tâches" className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-surface px-2 py-4 md:flex">
        <div className="space-y-0.5">{MAIN.map((item) => link(item, item.href === "/tasks/notifications" ? live.unreadCount : undefined))}</div>

        <div>
          <NextLink href="/tasks/favorites" className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted/80 hover:text-ink">
            <Star className="h-3 w-3" /> Favoris
          </NextLink>
          {favorites.length === 0 ? (
            <p className="px-2 text-[11px] text-muted/80">Ajoutez un projet aux favoris avec l&apos;étoile de son en-tête.</p>
          ) : (
            <div className="space-y-0.5">{favorites.map(projectLink)}</div>
          )}
        </div>

        <div className="min-h-0">
          <div className="mb-1 flex items-center justify-between px-2">
            <NextLink href="/tasks/projects" className="text-[10px] font-semibold uppercase tracking-widest text-muted/80 hover:text-ink">Projets</NextLink>
            <button type="button" onClick={() => setCreating(true)} aria-label="Nouveau projet" title="Nouveau projet" className={`${ICON_BTN} h-5 w-5`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {projects.length === 0 ? (
            <button type="button" onClick={() => setCreating(true)} className="px-2 text-[12px] text-accent hover:underline">
              Créer un premier projet
            </button>
          ) : (
            <div className="space-y-0.5">{projects.slice(0, 30).map(projectLink)}</div>
          )}
        </div>

        <div className="mt-auto space-y-0.5 border-t border-border-subtle pt-3">{MORE.map((item) => link(item))}</div>
      </aside>

      <div className="min-w-0 flex-1 md:overflow-hidden">{children}</div>
      {creating && <ProjectFormModal onClose={() => setCreating(false)} />}
    </div>
  );
}
