"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { updateTask } from "@/app/(app)/tasks/actions";
import { ContactPicker } from "@/components/follow-ups/contact-picker";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import { initialEditTaskState, type EditTaskState } from "@/lib/tasks/edit-state";
import { TASK_LIMITS } from "@/lib/tasks/schemas";
import type { TaskView } from "@/lib/tasks/view";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Enregistrement…" : "Enregistrer"}
    </button>
  );
}

/**
 * Corps du dialogue — extrait en sous-composant pour que l'état interne
 * repart de zéro à chaque ouverture (même principe qu'`EditFollowUpDialog`).
 */
function DialogBody({
  item,
  onClose,
}: {
  item: TaskView;
  onClose: () => void;
}) {
  const titleId = useId();
  const [contactMode, setContactMode] = useState(item.contactId ?? "");

  const [state, formAction] = useActionState(
    async (previous: EditTaskState, formData: FormData) => {
      const result = await updateTask(previous, formData);
      if (result.status === "success") onClose();
      return result;
    },
    initialEditTaskState,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const errors = state.fieldErrors ?? {};

  const defaultContact =
    item.contactId && item.contactName
      ? { id: item.contactId, name: item.contactName }
      : undefined;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 overflow-y-auto bg-black/50"
    >
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="pointer-events-none flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="pointer-events-auto nod-rise relative w-full max-w-lg rounded-t-2xl border border-border-subtle bg-surface p-5 shadow-dialog sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Modifier la tâche
            </h2>
            <p className="text-sm text-muted">
              Titre, échéance, note et contact.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={item.id} />

          <div>
            <label className={LABEL} htmlFor="edit-task-title">
              Titre
            </label>
            <input
              id="edit-task-title"
              name="title"
              required
              maxLength={TASK_LIMITS.title}
              autoFocus
              defaultValue={item.title}
              className={`mt-1 ${FIELD}`}
            />
            <FieldError message={errors.title} />
          </div>

          <div>
            <label className={LABEL} htmlFor="edit-task-dueDate">
              Échéance
            </label>
            <input
              id="edit-task-dueDate"
              name="dueDate"
              type="date"
              required
              defaultValue={item.dueDate}
              className={`mt-1 ${FIELD} sm:max-w-56`}
            />
            <FieldError message={errors.dueDate} />
          </div>

          <ContactPicker
            defaultSelection={defaultContact}
            mode={contactMode}
            onModeChange={setContactMode}
            allowCreate={false}
            error={errors.contactId}
          />

          <div>
            <label className={LABEL} htmlFor="edit-task-notes">
              Note (facultatif)
            </label>
            <textarea
              id="edit-task-notes"
              name="notes"
              rows={2}
              maxLength={TASK_LIMITS.notes}
              defaultValue={item.notes ?? ""}
              className={`mt-1 ${FIELD}`}
            />
          </div>

          {state.status === "error" && state.message && (
            <p className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-fg">
              {state.message}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted"
            >
              Annuler
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Dialogue de modification d'une tâche existante.
 *
 * Champs éditables : titre, échéance, note, contact.
 * Le suivi lié et l'opportunité sont conservés sans modification.
 */
export function EditTaskDialog({ item }: { item: TaskView }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
        aria-label={`Modifier la tâche « ${item.title} »`}
      >
        Modifier
      </button>

      {open && <DialogBody item={item} onClose={() => setOpen(false)} />}
    </>
  );
}
