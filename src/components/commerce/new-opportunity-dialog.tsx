"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { createOpportunity } from "@/app/(app)/commerce/actions";
import { ContactPicker } from "@/components/follow-ups/contact-picker";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialCreateOpportunityState,
  type CreateOpportunityState,
} from "@/lib/commerce/create-state";
import { OPPORTUNITY_LIMITS } from "@/lib/commerce/schemas";
import { PIPELINE_ORDER, STATUS_LABELS } from "@/lib/commerce/domain";

/**
 * Dialogue de création d'une opportunité commerciale.
 *
 * Champs obligatoires : nom, organisation.
 * Champs facultatifs : contact, statut initial, montant estimé, date prévisionnelle,
 * notes.
 *
 * Aucune logique de rappel ni d'échéance opérationnelle : ces préoccupations
 * appartiennent à Task et FollowUp.
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Création…" : "Créer l'opportunité"}
    </button>
  );
}

export function NewOpportunityDialog({
  triggerLabel = "Nouvelle opportunité",
  triggerClassName,
}: {
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactMode, setContactMode] = useState("");
  const titleId = useId();

  const [state, formAction] = useActionState(
    async (previous: CreateOpportunityState, formData: FormData) => {
      const result = await createOpportunity(previous, formData);
      if (result.status === "success") {
        setOpen(false);
        setContactMode("");
      }
      return result;
    },
    initialCreateOpportunityState,
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

  // Les pickers sont des composants contrôlés côté client.
  // OrganizationPicker gère son propre état interne.

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

      {open &&
        createPortal(
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
                      Nouvelle opportunité
                    </h2>
                    <p className="text-sm text-muted">
                      Le contexte de l&apos;affaire — pas les actions à mener.
                    </p>
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
                  {/* Nom */}
                  <div>
                    <label className={LABEL} htmlFor="oppName">
                      Nom de l&apos;affaire
                    </label>
                    <input
                      id="oppName"
                      name="name"
                      required
                      maxLength={OPPORTUNITY_LIMITS.name}
                      autoFocus
                      placeholder="Refonte site vitrine Acme"
                      className={`mt-1 ${FIELD}`}
                    />
                    <FieldError message={errors.name} />
                  </div>

                  {/* Organisation (obligatoire) */}
                  <OrganizationPicker
                    organizationId={null}
                    organizationName={null}
                    required
                    error={errors.organizationId}
                  />

                  {/* Contact (facultatif) */}
                  <ContactPicker
                    mode={contactMode}
                    onModeChange={setContactMode}
                    allowCreate={false}
                    error={errors.contactId}
                  />

                  {/* Statut initial */}
                  <div>
                    <label className={LABEL} htmlFor="oppStatus">
                      Statut
                    </label>
                    <select
                      id="oppStatus"
                      name="status"
                      defaultValue="A_QUALIFIER"
                      className={`mt-1 ${FIELD}`}
                    >
                      {PIPELINE_ORDER.slice(0, 3).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.status} />
                  </div>

                  {/* Montant estimé */}
                  <div>
                    <label className={LABEL} htmlFor="oppAmount">
                      Montant estimé (€, facultatif)
                    </label>
                    <input
                      id="oppAmount"
                      name="estimatedAmount"
                      type="number"
                      min="0"
                      max="999999999999"
                      step="0.01"
                      placeholder="0"
                      className={`mt-1 ${FIELD} sm:max-w-56`}
                    />
                    <FieldError message={errors.estimatedAmount} />
                  </div>

                  {/* Date prévisionnelle de clôture */}
                  <div>
                    <label className={LABEL} htmlFor="oppExpectedClose">
                      Date prévisionnelle (facultatif)
                    </label>
                    <input
                      id="oppExpectedClose"
                      name="expectedCloseDate"
                      type="date"
                      className={`mt-1 ${FIELD} sm:max-w-56`}
                    />
                    <FieldError message={errors.expectedCloseDate} />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className={LABEL} htmlFor="oppNotes">
                      Notes (facultatif)
                    </label>
                    <textarea
                      id="oppNotes"
                      name="notes"
                      rows={2}
                      maxLength={OPPORTUNITY_LIMITS.notes}
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
          </div>,
          document.body,
        )}
    </>
  );
}
