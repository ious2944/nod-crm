import type { BallOwner } from "@/lib/follow-ups/domain";

/**
 * La métaphore de la balle, en un coup d'œil. Partagée par la carte Follow-up
 * et par les lignes du cockpit : c'est le repère le plus lu de l'interface,
 * il ne doit pas changer d'aspect d'une page à l'autre.
 */
export function BallBadge({
  ballOwner,
  label,
}: {
  ballOwner: BallOwner;
  label: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ballOwner === "ME" ? "bg-accent-soft text-accent" : "bg-surface-muted text-ink"
      }`}
    >
      🏓 {label}
    </span>
  );
}
