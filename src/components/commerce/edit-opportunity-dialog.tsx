"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { updateOpportunity } from "@/app/(app)/commerce/actions";
import { ContactPicker } from "@/components/follow-ups/contact-picker";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialUpdateOpportunityState,
  type UpdateOpportunityState,
} from "@/lib/commerce/create-state";
import { OPPORTUNITY_LIMITS } from "@/lib/commerce/schemas";
import type { OpportunityDetail } from "@/lib/commerce/view";

/**
 * Dialogue d'édition d'une opportunité existante.
 *
 * Champs éditables : nom, organisation, contact, montant estimé, date
 * prévisionnelle, notes. Le statut n'est pas éditable ici — il appartient au
 * pipeline (`ChangeStatusForm`).
 */

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

export function EditOpportunityDialog({
  opportunity,
  triggerLabel = "Modifier",
  triggerClassName,
}: {
  opportunity: Pick<
    OpportunityDetail,
    | "id"
    | "name"
    | "organizationId"
    | "organizationName"
    | "contactId"
    | "contactName"
    | "estimatedAmountRaw"
    | "expectedCloseDate"
    | "notes"
  >;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [contactMode, setContactMode] = useState(opportunity.contactId ?? "");
  const titleId = useId();

  const [state, formAction] = useActionState(
    async (previous: UpdateOpportunityState, formData: FormData) => {
      const result = await updateOpportunity(previous, formData);
      if (result.status === "success") {
        setOpen(false);
      }
      return result;
    },
    initialUpdateOpportunityState,
  );

  // Réinitialise le contact quand on ferme sans sauvegarder.
  useEffect(() => {
    if (!open) {
      setContactMode(opportunity.contactId ?? "");
    }
  }, [open, opportunity.contactId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const errors = state.fieldErrors ?? {};

  const defaultContact =
    opportunity.contactId && opportunity.contactName
      ? { id: opportunity.contactId, name: opportunity.contactName }
      : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-muted hover:text-ink"
        }
      >
        {triggerLabel}
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
                      Modifier l'opportunité
                    </h2>
                    <p className="text-sm text-muted">Contexte de l'affaire commerciale.</p>
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
                  {/* Identifiant caché */}
                  <input type="hidden" name="id" value={opportunity.id} />

                  {/* Nom */}
                  <div>
                    <label className={LABEL} htmlFor="editOppName">
                      Nom de l'affaire
                    </label>
                    <input
                      id="editOppName"
                      name="name"
                      required
                      maxLength={OPPORTUNITY_LIMITS.name}
                      autoFocus
                      defaultValue={opportunity.name}
                      className={`mt-1 ${FIELD}`}
                    />
                    <FieldError message={errors.name} />
                  </div>

                  {/* Organisation (obligatoire) */}
                  <OrganizationPicker
                    organizationId={opportunity.organizationId}
                    organizationName={opportunity.organizationName}
                    required
                    error={errors.organizationId}
                  />

                  {/* Contact (facultatif) */}
                  <ContactPicker
                    defaultSelection={defaultContact}
                    mode={contactMode}
                    onModeChange={setContactMode}
                    allowCreate={false}
                    error={errors.contactId}
                  />

                  {/* Montant estimé */}
                  <div>
                    <label className={LABEL} htmlFor="editOppAmount">
                      Montant estimé (€, facultatif)
                    </label>
                    <input
                      id="editOppAmount"
                      name="estimatedAmount"
                      type="number"
                      min="0"
                      max="999999999999"
                      step="0.01"
                      placeholder="0"
                      defaultValue={opportunity.estimatedAmountRaw ?? ""}
                      className={`mt-1 ${FIELD} sm:max-w-56`}
                    />
                    <FieldError message={errors.estimatedAmount} />
                  </div>

                  {/* Date prévisionnelle de clôture */}
                  <div>
                    <label className={LABEL} htmlFor="editOppExpectedClose">
                      Date prévisionnelle (facultatif)
                    </label>
                    <input
                      id="editOppExpectedClose"
                      name="expectedCloseDate"
                      type="date"
                      defaultValue={opportunity.expectedCloseDate ?? ""}
                      className={`mt-1 ${FIELD} sm:max-w-56`}
                    />
                    <FieldError message={errors.expectedCloseDate} />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className={LABEL} htmlFor="editOppNotes">
                      Notes (facultatif)
                    </label>
                    <textarea
                      id="editOppNotes"
                      name="notes"
                      rows={3}
                      maxLength={OPPORTUNITY_LIMITS.notes}
                      defaultValue={opportunity.notes ?? ""}
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
