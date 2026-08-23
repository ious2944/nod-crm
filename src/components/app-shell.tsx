"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { logout } from "@/app/login/actions";
import { NAV_SECTIONS, type NavItem } from "./navigation";

function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={logout}>
      <button
        type="submit"
        className={
          compact
            ? "rounded-full px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
            : "rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-muted hover:text-ink"
        }
      >
        Déconnexion
      </button>
    </form>
  );
}

function Brand({ appName, compact = false }: { appName: string; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-contrast"
      >
        {appName.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">{appName}</span>
        {!compact && <span className="text-[11px] text-muted">Follow-Up</span>}
      </span>
    </div>
  );
}

function NavEntry({ item, active }: { item: NavItem; active: boolean }) {
  const base =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors";

  if (!item.available || !item.href) {
    return (
      <span
        aria-disabled
        title="Module à venir"
        className={`${base} cursor-not-allowed text-muted/60`}
      >
        <span aria-hidden className="w-4 text-center opacity-70">
          {item.icon}
        </span>
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full border border-border-subtle px-1.5 py-px text-[10px] uppercase tracking-wide">
          bientôt
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-ink hover:bg-surface-muted"
      }`}
    >
      <span aria-hidden className="w-4 text-center">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({
  children,
  appName,
  sourceUrl,
  userLabel,
  workspaceName,
}: {
  children: ReactNode;
  /** Nom de l'instance, résolu côté serveur (`APP_NAME`) puis passé en prop :
   *  une variable `NEXT_PUBLIC_*` serait figée au moment du build, ce qui
   *  interdirait de renommer une instance sans reconstruire l'image. */
  appName: string;
  /** Lien vers le code source de CETTE instance (AGPL-3.0, article 13). */
  sourceUrl: string;
  userLabel: string;
  workspaceName: string;
}) {
  const pathname = usePathname();
  const isActive = (item: NavItem) =>
    Boolean(item.href) && pathname.startsWith(item.href!);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Barre supérieure — mobile et tablette */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border-subtle bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand appName={appName} compact />
        <nav aria-label="Modules" className="flex items-center gap-1.5">
          {NAV_SECTIONS.flatMap((section) => section.items)
            .filter((item) => item.available && item.href)
            .map((item) => (
              <Link
                key={item.label}
                href={item.href!}
                aria-current={isActive(item) ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  isActive(item)
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-muted"
                }`}
              >
                {item.icon} {item.label}
              </Link>
            ))}
          <LogoutButton compact />
        </nav>
      </header>

      {/* Barre latérale — desktop */}
      <aside className="hidden w-60 shrink-0 border-r border-border-subtle bg-surface md:flex md:flex-col">
        <div className="px-4 py-5">
          <Brand appName={appName} />
        </div>
        <nav aria-label="Navigation principale" className="flex-1 space-y-5 px-2.5 pb-6">
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.title ?? `section-${index}`} className="space-y-1">
              {section.title && (
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <NavEntry key={item.label} item={item} active={isActive(item)} />
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-border-subtle px-4 py-3">
          <p className="truncate text-xs font-medium text-ink" title={userLabel}>
            {userLabel}
          </p>
          <p className="truncate text-[11px] text-muted">{workspaceName}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* AGPL-3.0 art. 13 : les utilisateurs d'une instance modifiée
                doivent pouvoir en récupérer le source depuis l'interface. */}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Source
            </a>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
