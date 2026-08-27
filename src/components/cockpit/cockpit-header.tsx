import type { ReactNode } from "react";

/**
 * En-tête personnel du cockpit — V0.7 Lumina Enterprise.
 *
 * Les emplacements `search` et `actions` sont des `ReactNode` optionnels.
 */
export function CockpitHeader({
  name,
  dateLabel,
  search,
  actions,
}: {
  name: string;
  dateLabel: string;
  search?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          {dateLabel}
        </p>
        <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Bonjour&nbsp;{name}&nbsp;👋
        </h1>
        <p className="mt-1 text-sm text-muted">
          Voici ce qui demande votre attention aujourd&apos;hui.
        </p>
      </div>

      {(search || actions) && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {search}
          {actions}
        </div>
      )}
    </header>
  );
}
