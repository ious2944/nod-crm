import type { ReactNode } from "react";
import Link from "next/link";

/** Illustration SVG générique — Electric Indigo #6366f1 */
function DefaultIllustration() {
  return (
    <svg
      aria-hidden
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Fond circulaire doux */}
      <circle cx="40" cy="40" r="40" fill="#eef2ff" />
      {/* Boîte vide */}
      <rect x="20" y="30" width="40" height="28" rx="4" fill="#c7d2fe" />
      {/* Couvercle */}
      <path
        d="M18 30 Q40 20 62 30"
        stroke="#6366f1"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Étoile-plus central */}
      <line x1="40" y1="36" x2="40" y2="52" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="44" x2="48" y2="44" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

/**
 * État vide illustré — affiché quand une liste ne contient aucun élément
 * et que l'utilisateur n'a pas encore créé de données.
 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
}: {
  illustration?: ReactNode;
  title: string;
  description: string;
  action?: EmptyStateAction;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-14 text-center shadow-card">
      <div className="mx-auto mb-4 flex w-fit items-center justify-center">
        {illustration ?? <DefaultIllustration />}
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
      {action && (
        <div className="mt-5">
          {action.href ? (
            <Link
              href={action.href}
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-card transition-colors hover:bg-accent-hover"
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-card transition-colors hover:bg-accent-hover"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
