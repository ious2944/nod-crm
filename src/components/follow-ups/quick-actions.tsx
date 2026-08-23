"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

import { applyQuickAction } from "@/app/(app)/follow-ups/actions";
import { PopoverMenu } from "@/components/ui/popover-menu";
import { SNOOZE_OPTIONS } from "@/lib/follow-ups/domain";

type Variant = "primary" | "default" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-accent bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-60",
  default:
    "border-border-strong bg-surface text-ink hover:bg-surface-muted disabled:opacity-60",
  ghost:
    "border-transparent bg-transparent text-muted hover:bg-surface-muted hover:text-ink disabled:opacity-60",
};

const BASE =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-progress";

/**
 * État partagé par toutes les actions d'une même carte.
 *
 * Une seule mutation à la fois : pendant qu'une action est en vol, *toutes* les
 * autres actions de la carte sont désactivées. Sans cela, un utilisateur pressé
 * enchaînait « Relancer » puis « Terminer » avant le premier retour, et la
 * seconde était refusée par la garde de transition côté serveur sans que rien
 * ne l'explique à l'écran.
 *
 * Conséquence assumée : ces boutons exigent JavaScript. L'application en
 * dépend déjà (dialogue de création, panneau de report) ; seul l'écran de
 * connexion reste un formulaire HTML classique, et c'est celui qui compte.
 */
interface CardActionState {
  busy: boolean;
  run: (formData: FormData) => void;
}

const CardActionsContext = createContext<CardActionState | null>(null);

function useCardActions(): CardActionState {
  const context = useContext(CardActionsContext);
  if (!context) {
    throw new Error("QuickAction doit être utilisé dans <CardActions>.");
  }
  return context;
}

export function CardActions({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (formData: FormData) => {
    setMessage(null);
    startTransition(async () => {
      try {
        await applyQuickAction(formData);
      } catch {
        // Le détail reste côté serveur ; l'utilisateur a seulement besoin de
        // savoir que son geste n'a pas été appliqué.
        setMessage("Ce suivi a changé entre-temps. Recharge la page pour voir son état à jour.");
      }
    });
  };

  return (
    <CardActionsContext.Provider value={{ busy: pending, run }}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {/* `aria-live` : le message est annoncé sans déplacer le focus. */}
      <p role="status" aria-live="polite" className="text-xs text-critical-fg empty:hidden">
        {message}
      </p>
    </CardActionsContext.Provider>
  );
}

export function QuickAction({
  id,
  intent,
  label,
  days,
  variant = "default",
  title,
  className = "",
}: {
  id: string;
  intent: string;
  label: string;
  days?: number;
  variant?: Variant;
  title?: string;
  className?: string;
}) {
  const { busy, run } = useCardActions();

  return (
    <button
      type="button"
      disabled={busy}
      title={title}
      onClick={() => run(buildAction(id, intent, days))}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
    >
      {label}
    </button>
  );
}

export function SnoozeMenu({ id }: { id: string }) {
  const { busy, run } = useCardActions();

  return (
    <PopoverMenu
      ariaLabel="Reporter l'échéance"
      disabled={busy}
      triggerClassName={`${BASE} ${VARIANTS.default}`}
      label={
        <>
          Reporter
          <span aria-hidden className="text-[10px] opacity-70">
            ▾
          </span>
        </>
      }
    >
      {(close) => (
        <>
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              className={`${BASE} ${VARIANTS.ghost} w-full justify-start`}
              onClick={() => {
                run(buildAction(id, "snooze", option.days));
                close();
              }}
            >
              {option.label}
            </button>
          ))}
        </>
      )}
    </PopoverMenu>
  );
}

function buildAction(id: string, intent: string, days?: number): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("intent", intent);
  if (days !== undefined) formData.set("days", String(days));
  return formData;
}
