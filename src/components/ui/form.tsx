/**
 * Habillage commun des formulaires.
 *
 * Ces trois éléments étaient dupliqués dans chaque dialogue. Les centraliser
 * garantit qu'un champ Contact et un champ Follow-Up se ressemblent — et
 * qu'un ajustement de la charte ne s'applique pas à moitié.
 *
 * Aucun état, aucun gestionnaire d'événement : le module est utilisable depuis
 * un composant serveur comme depuis un composant client.
 */

export const FIELD =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70";

export const LABEL = "block text-xs font-semibold uppercase tracking-wide text-muted";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-critical-fg">{message}</p>;
}
