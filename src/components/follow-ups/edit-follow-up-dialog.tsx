"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateFollowUp } from "@/app/(app)/follow-ups/actions";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialEditFollowUpState,
  type EditFollowUpState,
} from "@/lib/follow-ups/edit-state";
import type { FollowUpView } from "@/lib/follow-ups/view";
import { ContactPicker } from "./contact-picker";

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
 * (sélecteur de contact, état du formulaire) repart de zéro à chaque ouverture.
 * React recrée le sous-arbre quand `open` passe à `true`, ce qui suffit à
 * initialiser `useState` avec les valeurs fraîches de `item`.
 */
function DialogBody({
  item,
  onClose,
}: {
  item: FollowUpView;
  onClose: () => void;
}) {
  const titleId = useId();
  const [contactMode, setContactMode] = useState(item.contactId ?? "");

  const [state, formAction] = useActionState(
    async (previous: EditFollowUpState, formData: FormData) => {
      const result = await updateFollowUp(previous, formData);
      if (result.status === "success") onClose();
      return result;
    },
    initialEditFollowUpState,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="nod-rise relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border-subtle bg-surface p-5 shadow-dialog sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Modifier le suivi
            </h2>
            <p className="text-sm text-muted">
              Sujet, description, échéance et contact.
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
            <label className={LABEL} htmlFor="edit-title">
              Sujet
            </label>
            <input
              id="edit-title"
              name="title"
              required
              maxLength={160}
              autoFocus
              defaultValue={item.title}
              className={`mt-1 ${FIELD}`}
            />
            <FieldError message={errors.title} />
          </div>

          <ContactPicker
            defaultSelection={defaultContact}
            mode={contactMode}
            onModeChange={setContactMode}
            allowCreate={false}
            error={errors.contactId}
          />

          <div>
            <label className={LABEL} htmlFor="edit-dueDate">
              Échéance
            </label>
            <input
              id="edit-dueDate"
              name="dueDate"
              type="date"
              required
              defaultValue={item.dueDate}
              className={`mt-1 ${FIELD}`}
            />
            <FieldError message={errors.dueDate} />
          </div>

          <div>
            <label className={LABEL} htmlFor="edit-description">
              Description (facultatif)
            </label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={item.description ?? ""}
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
  );
}

/**
 * Dialogue de modification d&apos;un suivi existant.
 *
 * Champs éditables : sujet, description, échéance, contact.
 * La balle et le statut restent entre les mains des actions rapides.
 */
export function EditFollowUpDialog({ item }: { item: FollowUpView }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
        aria-label={`Modifier le suivi « ${item.title} »`}
      >
        Modifier
      </button>

      {open && <DialogBody item={item} onClose={() => setOpen(false)} />}
    </>
  );
}
