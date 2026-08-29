/**
 * Badge de statut d'opportunité.
 *
 * Quatre variantes visuelles (neutral, active, won, lost) pour les cinq statuts
 * Prisma. Les tokens viennent de `globals.css` — aucune couleur codée en dur.
 */

import type { StatusVariant } from "@/lib/commerce/domain";

const VARIANT_CLASS: Record<StatusVariant, string> = {
  neutral: "bg-calm-bg text-calm-fg",
  active: "bg-accent-soft text-accent",
  won: "bg-done-bg text-done-fg",
  lost: "bg-critical-bg text-critical-fg",
};

export function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: StatusVariant;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${VARIANT_CLASS[variant]}`}
    >
      {label}
    </span>
  );
}
