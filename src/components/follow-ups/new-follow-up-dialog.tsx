"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { createFollowUp } from "@/app/(app)/follow-ups/actions";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialCreateState,
  type CreateFollowUpState,
} from "@/lib/follow-ups/create-state";
import { ContactPicker, type PickerSelection } from "./contact-picker";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Création…" : "Créer le suivi"}
    </button>
  );
}

export function NewFollowUpDialog({
  defaultDueDate,
  defaultContact,
  triggerLabel = "Nouveau suivi",
  triggerClassName,
}: {
  defaultDueDate: string;
  /** Contact déjà choisi — le bouton « + Nouveau Follow-Up » d'une fiche. */
  defaultContact?: PickerSelection;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactMode, setContactMode] = useState(defaultContact?.id ?? "");
  const titleId = useId();

  // La fermeture est décidée dans l'action elle-même : c'est le seul endroit qui
  // sait si la création a réussi. Le dialogue étant démonté, le formulaire repart
  // vierge à l'ouverture suivante.
  const [state, formAction] = useActionState(
    async (previous: CreateFollowUpState, formData: FormData) => {
      const result = await createFollowUp(previous, formData);
      if (result.status === "success") {
        setOpen(false);
        setContactMode(defaultContact?.id ?? "");
      }
      return result;
    },
    initialCreateState,
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

      {open && createPortal(
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
            onClick={() => setOpen(false)}
          />

          <div className="pointer-events-none flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="pointer-events-auto nod-rise relative w-full max-w-lg rounded-t-2xl border border-border-subtle bg-surface p-5 shadow-dialog sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-semibold">
                  Nouveau suivi
                </h2>
                <p className="text-sm text-muted">Qui te doit quoi, et pour quand ?</p>
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
                <label className={LABEL} htmlFor="title">
                  Sujet
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  maxLength={160}
                  autoFocus
                  placeholder="Liste BrandName complète"
                  className={`mt-1 ${FIELD}`}
                />
                <FieldError message={errors.title} />
              </div>

              <ContactPicker
                defaultSelection={defaultContact}
                mode={contactMode}
                onModeChange={setContactMode}
                error={errors.contactId}
              />

              {contactMode === "new" && (
                <div className="nod-rise grid gap-3 rounded-lg border border-dashed border-border-strong p-3 sm:grid-cols-2">
                  <div>
                    <label className={LABEL} htmlFor="newContactFirstName">
                      Prénom
                    </label>
                    <input
                      id="newContactFirstName"
                      name="newContactFirstName"
                      maxLength={80}
                      className={`mt-1 ${FIELD}`}
                    />
                    <FieldError message={errors.newContactFirstName} />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="newContactLastName">
                      Nom
                    </label>
                    <input
                      id="newContactLastName"
                      name="newContactLastName"
                      maxLength={80}
                      className={`mt-1 ${FIELD}`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL} htmlFor="newContactOrganization">
                      Organisation (facultatif)
                    </label>
                    <input
                      id="newContactOrganization"
                      name="newContactOrganization"
                      maxLength={120}
                      className={`mt-1 ${FIELD}`}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="dueDate">
                    Échéance
                  </label>
                  <input
                    id="dueDate"
                    name="dueDate"
                    type="date"
                    required
                    defaultValue={defaultDueDate}
                    className={`mt-1 ${FIELD}`}
                  />
                  <FieldError message={errors.dueDate} />
                </div>

                <fieldset>
                  <legend className={LABEL}>La balle est chez</legend>
                  <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border-strong p-1">
                    {[
                      { value: "ME", label: "Moi" },
                      { value: "THEM", label: "Eux" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="cursor-pointer rounded-md px-2 py-1.5 text-center text-sm has-[:checked]:bg-accent-soft has-[:checked]:font-semibold has-[:checked]:text-accent"
                      >
                        <input
                          type="radio"
                          name="ballOwner"
                          value={option.value}
                          defaultChecked={option.value === "THEM"}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div>
                <label className={LABEL} htmlFor="description">
                  Description (facultatif)
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  maxLength={2000}
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
        </div>,
        document.body
      )}
    </>
  );
}
