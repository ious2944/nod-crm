"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

/**
 * Actions rapides d'une ligne — suivi ou tâche.
 *
 * Extrait de `follow-ups/quick-actions.tsx` en V0.4, quand les tâches ont eu
 * besoin exactement du même comportement. Ce qui est partagé ici, c'est une
 * règle de comportement, pas de l'habillage :
 *
 * **Une seule mutation à la fois.** Pendant qu'une action est en vol, *toutes*
 * les autres actions de la même ligne sont désactivées. Sans cela, un
 * utilisateur pressé enchaîne deux gestes avant le premier retour, et le second
 * est refusé par la garde de transition côté serveur sans que rien ne
 * l'explique à l'écran.
 *
 * Conséquence assumée : ces boutons exigent JavaScript. L'application en dépend
 * déjà (dialogue de création, panneau de report) ; seul l'écran de connexion
 * reste un formulaire HTML classique, et c'est celui qui compte.
 */

export type ActionVariant = "primary" | "default" | "ghost";

export const ACTION_VARIANTS: Record<ActionVariant, string> = {
  primary:
    "border-accent bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-60",
  default:
    "border-border-strong bg-surface text-ink hover:bg-surface-muted disabled:opacity-60",
  ghost:
    "border-transparent bg-transparent text-muted hover:bg-surface-muted hover:text-ink disabled:opacity-60",
};

export const ACTION_BASE =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-progress";

interface RowActionState {
  busy: boolean;
  run: (formData: FormData) => void;
}

const RowActionsContext = createContext<RowActionState | null>(null);

export function useRowActions(): RowActionState {
  const context = useContext(RowActionsContext);
  if (!context) {
    throw new Error("Cette action doit être utilisée dans <RowActions>.");
  }
  return context;
}

export function RowActions({
  action,
  conflictMessage,
  className = "flex flex-wrap items-center gap-2",
  children,
}: {
  /** Server Action appelée par chaque bouton de la ligne. */
  action: (formData: FormData) => Promise<void>;
  /** Ce qu'on dit à l'utilisateur si le serveur refuse. Le détail reste serveur. */
  conflictMessage: string;
  className?: string;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (formData: FormData) => {
    setMessage(null);
    startTransition(async () => {
      try {
        await action(formData);
      } catch {
        setMessage(conflictMessage);
      }
    });
  };

  return (
    <RowActionsContext.Provider value={{ busy: pending, run }}>
      <div className={className}>{children}</div>
      {/* `aria-live` : le message est annoncé sans déplacer le focus. */}
      {/* `basis-full` : dans une ligne en `flex-wrap`, le message occupe sa
          propre ligne au lieu de comprimer les boutons. */}
      <p
        role="status"
        aria-live="polite"
        className="basis-full text-xs text-critical-fg empty:hidden"
      >
        {message}
      </p>
    </RowActionsContext.Provider>
  );
}

/** Construit le `FormData` attendu par les actions rapides. */
export function actionFormData(fields: Record<string, string | number>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, String(value));
  }
  return formData;
}
