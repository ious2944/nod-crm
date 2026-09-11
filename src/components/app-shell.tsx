"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { logout } from "@/app/login/actions";
import { NAV_SECTIONS, type NavItem } from "./navigation";

/** Initiales à partir du label utilisateur (prénom nom ou email). */
function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-muted hover:text-ink transition-colors"
      >
        Déconnexion
      </button>
    </form>
  );
}

/** Drawer mobile — avatar cliquable ouvre un bottom-sheet avec identité + déconnexion. */
function MobileUserDrawer({
  userLabel,
  userEmail,
  open,
  onClose,
}: {
  userLabel: string;
  userEmail: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <>
      {/* Overlay */}
      <div
        aria-hidden
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compte utilisateur"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border-subtle bg-surface p-6 shadow-dialog"
      >
        {/* Poignée */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border-strong" />
        {/* Identité */}
        <div className="mb-5 flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-base font-bold text-accent-contrast"
          >
            {getInitials(userLabel)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink">{userLabel}</p>
            {userEmail && userEmail !== userLabel && (
              <p className="truncate text-sm text-muted">{userEmail}</p>
            )}
          </div>
        </div>
        {/* Déconnexion — même Server Action que la sidebar desktop */}
        <form action={logout} className="w-full">
          <button
            type="submit"
            className="w-full rounded-lg border border-border-strong px-4 py-2.5 text-sm font-semibold text-critical-fg hover:bg-critical-bg transition-colors"
          >
            Déconnexion
          </button>
        </form>
        {/* Fermer */}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg px-4 py-2.5 text-sm text-muted hover:bg-surface-muted transition-colors"
        >
          Fermer
        </button>
      </div>
    </>
  );
}

function Brand({ appName, workspaceName }: { appName: string; workspaceName: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-contrast shadow-sm"
      >
        {appName.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[13px] font-semibold tracking-tight text-ink">
          {appName}
        </span>
        <span className="truncate text-[11px] text-muted">{workspaceName}</span>
      </span>
    </div>
  );
}

function NavEntry({ item, active }: { item: NavItem; active: boolean }) {
  const base =
    "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";
  const Icon = item.icon;

  if (!item.available || !item.href) {
    return (
      <span
        aria-disabled
        title="Module à venir"
        className={`${base} cursor-not-allowed text-muted/50`}
      >
        <Icon className="w-4 h-4 shrink-0 opacity-60" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted/70">
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
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-surface-muted hover:text-ink"
      }`}
    >
      {/* Indicateur actif — barre latérale gauche */}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent"
        />
      )}
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

export function AppShell({
  children,
  appName,
  sourceUrl,
  userLabel,
  userEmail,
  workspaceName,
}: {
  children: ReactNode;
  appName: string;
  sourceUrl: string;
  userLabel: string;
  userEmail?: string;
  workspaceName: string;
}) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (item: NavItem) =>
    Boolean(item.href) && pathname.startsWith(item.href!);

  const resolvedEmail = userEmail ?? "";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* ── Mobile : barre supérieure ──────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur-sm md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Brand appName={appName} workspaceName={workspaceName} />

          {/* Avatar cliquable — ouvre le drawer utilisateur */}
          <button
            type="button"
            aria-label="Ouvrir le menu utilisateur"
            onClick={() => setMobileMenuOpen(true)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-contrast shadow-sm hover:bg-accent-hover transition-colors"
          >
            {getInitials(userLabel)}
          </button>
        </div>
        <nav aria-label="Modules" className="flex flex-wrap items-center gap-1">
          {NAV_SECTIONS.flatMap((section) => section.items)
            .filter((item) => item.available && item.href)
            .map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.label}
                  href={item.href!}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-surface-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>
      </header>

      {/* Drawer mobile utilisateur */}
      <MobileUserDrawer
        userLabel={userLabel}
        userEmail={resolvedEmail}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* ── Desktop : barre latérale ────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-border-subtle bg-surface md:flex md:flex-col">
        {/* Identité de l'instance */}
        <div className="px-5 pt-6 pb-5">
          <Brand appName={appName} workspaceName={workspaceName} />
        </div>

        {/* Navigation principale */}
        <nav
          aria-label="Navigation principale"
          className="flex-1 space-y-5 overflow-y-auto px-3 pb-4"
        >
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.title ?? `section-${index}`} className="space-y-0.5">
              {section.title && (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted/70">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <NavEntry key={item.label} item={item} active={isActive(item)} />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer : utilisateur + AGPL source */}
        <div className="border-t border-border-subtle px-4 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate text-xs font-semibold text-ink" title={userLabel}>
              {userLabel}
            </p>
            <p className="truncate text-[11px] text-muted">{workspaceName}</p>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            {/* AGPL-3.0 art. 13 */}
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

      {/* ── Contenu principal ─────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
