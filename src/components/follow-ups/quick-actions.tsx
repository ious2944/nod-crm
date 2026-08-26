"use client";

import type { ReactNode } from "react";

import { applyQuickAction } from "@/app/(app)/follow-ups/actions";
import { PopoverMenu } from "@/components/ui/popover-menu";
import {
  ACTION_BASE,
  ACTION_VARIANTS,
  actionFormData,
  RowActions,
  useRowActions,
  type ActionVariant,
} from "@/components/ui/row-actions";
import { SNOOZE_OPTIONS } from "@/lib/follow-ups/domain";

/**
 * Actions rapides d'une carte de suivi.
 *
 * Le comportement partagé (une seule mutation à la fois, message d'échec en
 * région live) vit dans `@/components/ui/row-actions` depuis la V0.4, où les
 * lignes de tâches ont eu besoin du même. Ici ne restent que les intentions
 * propres au suivi.
 */

const CONFLICT_MESSAGE =
  "Ce suivi a changé entre-temps. Recharge la page pour voir son état à jour.";

export function CardActions({ children }: { children: ReactNode }) {
  return (
    <RowActions action={applyQuickAction} conflictMessage={CONFLICT_MESSAGE}>
      {children}
    </RowActions>
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
  variant?: ActionVariant;
  title?: string;
  className?: string;
}) {
  const { busy, run } = useRowActions();

  return (
    <button
      type="button"
      disabled={busy}
      title={title}
      onClick={() => run(buildAction(id, intent, days))}
      className={`${ACTION_BASE} ${ACTION_VARIANTS[variant]} ${className}`}
    >
      {label}
    </button>
  );
}

export function SnoozeMenu({ id }: { id: string }) {
  const { busy, run } = useRowActions();

  return (
    <PopoverMenu
      ariaLabel="Reporter l'échéance"
      disabled={busy}
      triggerClassName={`${ACTION_BASE} ${ACTION_VARIANTS.default}`}
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
              className={`${ACTION_BASE} ${ACTION_VARIANTS.ghost} w-full justify-start`}
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
  return actionFormData(days === undefined ? { id, intent } : { id, intent, days });
}
