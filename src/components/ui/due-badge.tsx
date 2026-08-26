import type { UrgencyLevel } from "@/lib/follow-ups/domain";

/**
 * Pastille d'échéance — `J+4`, `Aujourd'hui`, `Demain`, `Dans 5 j`.
 *
 * Un seul composant pour les suivis et les tâches : une échéance dépassée doit
 * se voir de la même façon partout, et la V0.4 n'introduit **aucune couleur
 * nouvelle**. Les six niveaux sont ceux du vieillissement V0.1, avec leurs
 * jetons de `globals.css` — donc le mode sombre suit sans rien ajouter.
 */
const CHIP: Record<UrgencyLevel, string> = {
  done: "bg-done-bg text-done-fg",
  calm: "bg-calm-bg text-calm-fg",
  soon: "bg-soon-bg text-soon-fg",
  today: "bg-today-bg text-today-fg",
  late: "bg-late-bg text-late-fg",
  critical: "bg-critical-bg text-critical-fg",
};

export function DueBadge({
  level,
  label,
  className = "",
}: {
  level: UrgencyLevel;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[level]} ${className}`}
    >
      {label}
    </span>
  );
}
