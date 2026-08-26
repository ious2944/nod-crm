import type { ReactNode } from "react";

/**
 * En-tête personnel du cockpit.
 *
 * Les emplacements `search` et `actions` sont des `ReactNode` optionnels : rien
 * n'est rendu tant qu'on ne leur passe rien. C'est ce qui permettra d'installer
 * la recherche globale — « Rechercher un contact, un suivi, une entreprise… » —
 * ou un accès à Mirai sans retoucher la mise en page, et sans afficher
 * aujourd'hui un champ décoratif qui ne chercherait rien.
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
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
          {dateLabel}
        </p>
        <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
          Bonjour {name}
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
