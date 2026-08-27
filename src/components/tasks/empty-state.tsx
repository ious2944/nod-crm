import type { TaskFilter } from "@/lib/tasks/filters";

/**
 * États vides du module Tâches.
 *
 * Un workspace sans tâche n'est pas un workspace mal configuré : c'est un
 * workspace à jour. Le message doit se lire comme une bonne nouvelle, pas comme
 * une erreur ni comme une fonctionnalité à activer.
 */
const MESSAGES: Record<TaskFilter, { icon: string; title: string; hint: string }> = {
  todo: {
    icon: "✓",
    title: "Aucune tâche à faire",
    hint: "Ajoute ce que tu dois faire : un titre, une échéance, et c'est tout.",
  },
  done: {
    icon: "📦",
    title: "Aucune tâche terminée",
    hint: "Les tâches que tu termineras se retrouveront ici.",
  },
};

export function TasksEmptyState({ filter }: { filter: TaskFilter }) {
  const message = MESSAGES[filter];

  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <p aria-hidden className="text-3xl">
        {message.icon}
      </p>
      <p className="mt-3 font-semibold text-ink">{message.title}</p>
      <p className="mt-1 text-sm text-muted">{message.hint}</p>
    </div>
  );
}

/** Cockpit vide : plus rien ne réclame d'action aujourd'hui. */
export function TodayEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <p aria-hidden className="text-3xl">
        ✓
      </p>
      <p className="mt-3 font-semibold text-ink">Rien à traiter aujourd&apos;hui</p>
      <p className="mt-1 text-sm text-muted">
        Aucun suivi ni aucune tâche ne réclame d&apos;action maintenant.
      </p>
    </div>
  );
}
