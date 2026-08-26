"use client";

import type { ReactNode } from "react";

import { applyTaskAction } from "@/app/(app)/tasks/actions";
import { PopoverMenu } from "@/components/ui/popover-menu";
import {
  ACTION_BASE,
  ACTION_VARIANTS,
  actionFormData,
  RowActions,
  useRowActions,
  type ActionVariant,
} from "@/components/ui/row-actions";
import { TASK_SNOOZE_OPTIONS } from "@/lib/tasks/domain";

/**
 * Actions d'une ligne de tâche : terminer, reporter, rouvrir.
 *
 * Trois intentions, pas une de plus — une tâche est à faire ou terminée. Le
 * comportement (une seule mutation à la fois) est celui, partagé, de
 * `@/components/ui/row-actions`.
 */

const CONFLICT_MESSAGE =
  "Cette tâche a changé entre-temps. Recharge la page pour voir son état à jour.";

export function TaskActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <RowActions
      action={applyTaskAction}
      conflictMessage={CONFLICT_MESSAGE}
      className={className}
    >
      {children}
    </RowActions>
  );
}

export function TaskAction({
  id,
  intent,
  label,
  variant = "default",
  title,
}: {
  id: string;
  intent: "complete" | "reopen";
  label: string;
  variant?: ActionVariant;
  title?: string;
}) {
  const { busy, run } = useRowActions();

  return (
    <button
      type="button"
      disabled={busy}
      title={title}
      onClick={() => run(actionFormData({ id, intent }))}
      className={`${ACTION_BASE} ${ACTION_VARIANTS[variant]}`}
    >
      {label}
    </button>
  );
}

/**
 * Report : quelques choix rapides, pas un calendrier.
 *
 * Le panneau est le même composant que celui des suivis (`PopoverMenu`), donc
 * le même comportement au clavier, au défilement et sur écran étroit.
 */
export function TaskSnoozeMenu({ id }: { id: string }) {
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
          {TASK_SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              className={`${ACTION_BASE} ${ACTION_VARIANTS.ghost} w-full justify-start`}
              onClick={() => {
                run(actionFormData({ id, intent: "snooze", days: option.days }));
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
