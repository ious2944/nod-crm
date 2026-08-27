"use client";

import { useActionState, useEffect, useId } from "react";
import { useFormStatus } from "react-dom";

import { createOrganization, updateOrganization } from "@/app/(app)/organizations/actions";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialOrganizationFormState,
  type OrganizationFormState,
} from "@/lib/organizations/form-state";
import { ORG_LIMITS } from "@/lib/organizations/schemas";
import type { OrganizationFormValues } from "@/lib/organizations/view";

/**
 * Formulaire d'organisation — création ET modification.
 *
 * Même principe que le dialogue Contact : un seul composant pour les deux.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Enregistrement…" : label}
    </button>
  );
}

export function OrganizationDialog({
  open,
  onClose,
  organization,
}: {
  open: boolean;
  onClose: () => void;
  /** Absent : création. Présent : modification. */
  organization?: OrganizationFormValues;
}) {
  const titleId = useId();
  const isEdit = Boolean(organization);

  const [state, formAction] = useActionState(
    async (previous: OrganizationFormState, formData: FormData) => {
      const result = isEdit
        ? await updateOrganization(previous, formData)
        : await createOrganization(previous, formData);

      if (result.status === "success") {
        onClose();
      }
      return result;
    },
    initialOrganizationFormState,
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const errors = state.fieldErrors ?? {};

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
              {isEdit ? "Modifier l'organisation" : "Nouvelle organisation"}
            </h2>
            <p className="text-sm text-muted">
              {isEdit
                ? "Modifie les informations de cette organisation."
                : "Ajoute une entreprise ou une structure."}
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
          {organization && <input type="hidden" name="id" value={organization.id} />}

          <div>
            <label className={LABEL} htmlFor="name">
              Nom <span aria-hidden className="text-critical-fg">*</span>
            </label>
            <input
              id="name"
              name="name"
              autoFocus
              required
              maxLength={ORG_LIMITS.name}
              defaultValue={organization?.name ?? ""}
              className={`mt-1 ${FIELD}`}
            />
            <FieldError message={errors.name} />
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Coordonnées</legend>
            <div>
              <label className={LABEL} htmlFor="website">
                Site web (facultatif)
              </label>
              <input
                id="website"
                name="website"
                type="url"
                maxLength={ORG_LIMITS.website}
                defaultValue={organization?.website ?? ""}
                placeholder="https://example.com"
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.website} />
            </div>
            <div>
              <label className={LABEL} htmlFor="phone">
                Téléphone (facultatif)
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                maxLength={ORG_LIMITS.phone}
                defaultValue={organization?.phone ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.phone} />
            </div>
          </fieldset>

          <div>
            <label className={LABEL} htmlFor="email">
              Email (facultatif)
            </label>
            <input
              id="email"
              name="email"
              type="email"
              maxLength={ORG_LIMITS.email}
              defaultValue={organization?.email ?? ""}
              className={`mt-1 ${FIELD}`}
            />
            <FieldError message={errors.email} />
          </div>

          <div>
            <label className={LABEL} htmlFor="notes">
              Notes (facultatif)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={ORG_LIMITS.notes}
              defaultValue={organization?.notes ?? ""}
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
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted"
            >
              Annuler
            </button>
            <SubmitButton label={isEdit ? "Enregistrer" : "Créer l'organisation"} />
          </div>
        </form>
      </div>
    </div>
  );
}
