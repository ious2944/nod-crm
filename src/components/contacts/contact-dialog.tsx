"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";

import { createContact, updateContact } from "@/app/(app)/contacts/actions";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import {
  initialContactFormState,
  type ContactFormState,
} from "@/lib/contacts/form-state";
import { ACCEPTED_PHOTO_MIME_TYPES } from "@/lib/contacts/photo";
import { CONTACT_LIMITS } from "@/lib/contacts/schemas";
import type { ContactFormValues } from "@/lib/contacts/view";
import { ContactAvatar } from "./contact-avatar";

/**
 * Formulaire de contact — création ET modification.
 *
 * Un seul composant pour les deux : les champs, leurs bornes et leur
 * disposition sont identiques, seule l'action serveur change. Deux dialogues
 * jumeaux auraient divergé au premier ajout de champ.
 *
 * Le dialogue est *contrôlé* (`open` / `onClose`) parce que son déclencheur
 * n'est pas toujours à côté de lui : dans la liste, il est dans le menu `⋮`,
 * qui se ferme au clic — un état interne aurait disparu avec lui.
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

export function ContactDialog({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  /** Absent : création. Présent : modification de ce contact. */
  contact?: ContactFormValues;
}) {
  const titleId = useId();
  const isEdit = Boolean(contact);
  const [removePhoto, setRemovePhoto] = useState(false);

  const [state, formAction] = useActionState(
    async (previous: ContactFormState, formData: FormData) => {
      const result = isEdit
        ? await updateContact(previous, formData)
        : await createContact(previous, formData);

      if (result.status === "success") {
        setRemovePhoto(false);
        onClose();
      }
      return result;
    },
    initialContactFormState,
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
  const showPhoto = Boolean(contact?.photoUrl) && !removePhoto;

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
              {isEdit ? "Modifier le contact" : "Nouveau contact"}
            </h2>
            <p className="text-sm text-muted">Qui est-ce, et comment le joindre ?</p>
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
          {contact && <input type="hidden" name="id" value={contact.id} />}

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Identité</legend>
            <div>
              <label className={LABEL} htmlFor="firstName">
                Prénom
              </label>
              <input
                id="firstName"
                name="firstName"
                autoFocus
                maxLength={CONTACT_LIMITS.firstName}
                defaultValue={contact?.firstName ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.firstName} />
            </div>
            <div>
              <label className={LABEL} htmlFor="lastName">
                Nom
              </label>
              <input
                id="lastName"
                name="lastName"
                maxLength={CONTACT_LIMITS.lastName}
                defaultValue={contact?.lastName ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.lastName} />
            </div>
          </fieldset>

          <div>
            {/* Un `<label for>`, pas un `<span>` : sans lui le sélecteur de
                fichier n'a aucun nom accessible — un lecteur d'écran annonce
                « bouton Parcourir », sans dire de quoi il s'agit. */}
            <label className={LABEL} htmlFor="photo">
              Photo (facultatif)
            </label>
            <div className="mt-1 flex items-center gap-3">
              <ContactAvatar
                initials={initialsPreview(contact)}
                photoUrl={showPhoto ? contact!.photoUrl : null}
              />
              <div className="min-w-0 flex-1">
                <input
                  id="photo"
                  name="photo"
                  type="file"
                  accept={ACCEPTED_PHOTO_MIME_TYPES.join(",")}
                  className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:bg-surface-muted"
                />
                <p className="mt-1 text-[11px] text-muted">JPEG, PNG, GIF ou WebP — 2 Mo max.</p>
                <FieldError message={errors.photo} />
              </div>
            </div>
            {contact?.photoUrl && (
              <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  name="removePhoto"
                  value="1"
                  checked={removePhoto}
                  onChange={(event) => setRemovePhoto(event.target.checked)}
                />
                Retirer la photo actuelle
              </label>
            )}
          </div>

          <fieldset className="grid gap-3">
            <legend className="sr-only">Informations professionnelles</legend>
            {/* Sélecteur d'organisation V0.5 — remplace le champ texte libre */}
            <OrganizationPicker
              organizationId={contact?.organizationId ?? null}
              organizationName={contact?.organizationName ?? null}
            />
            <FieldError message={errors.organizationId} />
            <div>
              <label className={LABEL} htmlFor="jobTitle">
                Fonction
              </label>
              <input
                id="jobTitle"
                name="jobTitle"
                maxLength={CONTACT_LIMITS.jobTitle}
                defaultValue={contact?.jobTitle ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.jobTitle} />
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Coordonnées</legend>
            <div>
              <label className={LABEL} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                maxLength={CONTACT_LIMITS.email}
                defaultValue={contact?.email ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.email} />
            </div>
            <div>
              <label className={LABEL} htmlFor="phone">
                Téléphone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                maxLength={CONTACT_LIMITS.phone}
                defaultValue={contact?.phone ?? ""}
                className={`mt-1 ${FIELD}`}
              />
              <FieldError message={errors.phone} />
            </div>
          </fieldset>

          <div>
            <label className={LABEL} htmlFor="notes">
              Commentaire (facultatif)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={CONTACT_LIMITS.notes}
              defaultValue={contact?.notes ?? ""}
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
            <SubmitButton label={isEdit ? "Enregistrer" : "Créer le contact"} />
          </div>
        </form>
      </div>
      </div>
    </div>,
    document.body
  );
}

/** Initiales affichées à côté du sélecteur de fichier, avant tout envoi. */
function initialsPreview(contact?: ContactFormValues): string {
  const letters = `${contact?.firstName?.[0] ?? ""}${contact?.lastName?.[0] ?? ""}`.trim();
  return letters.toUpperCase() || "?";
}
