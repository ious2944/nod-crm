import type { FollowUpFilter } from "@/lib/follow-ups/filters";

const MESSAGES: Record<FollowUpFilter, { icon: string; title: string; hint: string }> = {
  all: {
    icon: "🏓",
    title: "Aucun suivi en cours",
    hint: "Crée ton premier suivi : un sujet, une personne, une échéance.",
  },
  nudge: {
    icon: "✓",
    title: "Rien à relancer",
    hint: "Personne ne te fait attendre au-delà de l'échéance. Profites-en.",
  },
  me: {
    icon: "✓",
    title: "La balle n'est jamais chez toi",
    hint: "Tu n'as rien en attente de ta part.",
  },
  them: {
    icon: "🏓",
    title: "Tu n'attends personne",
    hint: "Aucun suivi n'est en attente chez quelqu'un d'autre.",
  },
  done: {
    icon: "📦",
    title: "Aucun suivi terminé",
    hint: "Les suivis terminés ou abandonnés se retrouveront ici.",
  },
};

export function EmptyState({ filter }: { filter: FollowUpFilter }) {
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
