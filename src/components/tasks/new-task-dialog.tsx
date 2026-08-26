"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { createTask } from "@/app/(app)/tasks/actions";
import { ContactPicker } from "@/components/follow-ups/contact-picker";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import { initialCreateTaskState, type CreateTaskState } from "@/lib/tasks/create-state";
import { TASK_LIMITS } from "@/lib/tasks/schemas";
import { FollowUpPicker } from "./follow-up-picker";

/**
 * Création d'une tâche.
 *
 * Le formulaire tient en un titre et une échéance ; le contact, le suivi lié et
 * la note sont facultatifs et n'ont aucun champ obligatoire caché derrière eux.
 * Créer une tâche indépendante doit rester l'affaire de trois secondes :
 * ouvrir, taper, valider — l'échéance est déjà remplie sur aujourd'hui.
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Création…" : "Créer la tâche"}
    </button>
  );
}

export function NewTaskDialog({
  defaultDueDate,
  triggerLabel = "Nouvelle tâche",
  triggerClassName,
}: {
  defaultDueDate: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactMode, setContactMode] = useState("");
  const [followUpId, setFollowUpId] = useState("");
  const titleId = useId();

  // La fermeture est décidée dans l'action elle-même : c'est le seul endroit qui
  // sait si la création a réussi. Le dialogue étant démonté, le formulaire repart
  // vierge à l'ouverture suivante.
  const [state, formAction] = useActionState(
    async (previous: CreateTaskState, formData: FormData) => {
      const result = await createTask(previous, formData);
      if (result.status === "success") {
        setOpen(false);
        setContactMode("");
        setFollowUpId("");
      }
      return result;
    },
    initialCreateTaskState,
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const errors = state.fieldErrors ?? {};

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
        }
      >
        <span aria-hidden>+</span> {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
        >
          <button
            type="button"
            aria-label="Fermer"
            tabIndex={-1}
            className="absolute inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />

          <div className="nod-rise relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border-subtle bg-surface p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-semibold">
                  Nouvelle tâche
                </h2>
                <p className="text-sm text-muted">Quelque chose à faire, et pour quand ?</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <form action={formAction} className="space-y-4">
              <div>
                <label className={LABEL} htmlFor="taskTitle">
                  Titre
                </label>
                <input
                  id="taskTitle"
                  name="title"
                  required
                  maxLength={TASK_LIMITS.title}
                  autoFocus
                  placeholder="Préparer la présentation"
                  className={`mt-1 ${FIELD}`}
                />
                <FieldError message={errors.title} />
              </div>

              <div>
                <label className={LABEL} htmlFor="taskDueDate">
                  Échéance
                </label>
                <input
                  id="taskDueDate"
                  name="dueDate"
                  type="date"
                  required
                  defaultValue={defaultDueDate}
                  className={`mt-1 ${FIELD} sm:max-w-56`}
                />
                <FieldError message={errors.dueDate} />
              </div>

              {/* Le sélecteur de contact du module Follow-Up, sans sa création
                  rapide : ici le contact n'est qu'un repère facultatif. */}
              <ContactPicker
                mode={contactMode}
                onModeChange={setContactMode}
                allowCreate={false}
                error={errors.contactId}
              />

              <FollowUpPicker
                value={followUpId}
                onChange={setFollowUpId}
                error={errors.followUpId}
              />

              <div>
                <label className={LABEL} htmlFor="taskNotes">
                  Note (facultatif)
                </label>
                <textarea
                  id="taskNotes"
                  name="notes"
                  rows={2}
                  maxLength={TASK_LIMITS.notes}
                  className={`mt-1 ${FIELD}`}
                />
                <FieldError message={errors.notes} />
              </div>

              {state.status === "error" && state.message && (
                <p className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-fg">
                  {state.message}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted"
                >
                  Annuler
                </button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
