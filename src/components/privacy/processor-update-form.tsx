"use client";

/**
 * Formulaire d'édition d'un sous-traitant existant.
 *
 * Composant client nécessaire pour afficher un feedback après la soumission
 * (`useActionState`) et un état pending sur le bouton (`useFormStatus`).
 * Le formulaire de création reste un server component dans la page.
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateProcessor } from "@/app/(app)/rgpd/actions";
import { DPA_STATUSES, EEA_STATUSES, TRI_STATES } from "@/lib/privacy/constants";
import {
  initialProcessorFormState,
} from "@/lib/privacy/processor-form-state";

const inputClass =
  "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20";

/**
 * Données du processeur pré-sérialisées pour le passage server → client.
 * Les dates sont converties en chaînes "YYYY-MM-DD" (ou "") avant d'arriver ici.
 */
export interface ProcessorFormData {
  id: string;
  name: string;
  service: string;
  category: string | null;
  dataCategories: string | null;
  purpose: string | null;
  country: string | null;
  eeaStatus: string;
  dpaStatus: string;
  dpaUrl: string | null;
  subprocessorsStatus: string;
  lastReviewedAt: string; // "YYYY-MM-DD" ou ""
  nextReviewAt: string;   // "YYYY-MM-DD" ou ""
  notes: string | null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-contrast shadow-card hover:opacity-90 disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Enregistrement…" : "Enregistrer"}
    </button>
  );
}

export function ProcessorUpdateForm({ processor }: { processor: ProcessorFormData }) {
  const [state, formAction] = useActionState(updateProcessor, initialProcessorFormState);

  return (
    <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={processor.id} />

      <label className="text-sm font-medium text-ink">
        Prestataire
        <input required name="name" defaultValue={processor.name} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Service utilisé
        <input required name="service" defaultValue={processor.service} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Catégorie
        <input name="category" defaultValue={processor.category ?? ""} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Pays / localisation
        <input name="country" defaultValue={processor.country ?? ""} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Données concernées
        <textarea name="dataCategories" defaultValue={processor.dataCategories ?? ""} rows={2} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Finalité
        <textarea name="purpose" defaultValue={processor.purpose ?? ""} rows={2} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Traitement dans l&apos;EEE
        <select name="eeaStatus" defaultValue={processor.eeaStatus} className={inputClass}>
          {EEA_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        DPA
        <select name="dpaStatus" defaultValue={processor.dpaStatus} className={inputClass}>
          {DPA_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">
          Contrat encadrant le traitement réalisé par le prestataire pour ton compte.
        </span>
      </label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">
        URL / référence du DPA
        <input name="dpaUrl" defaultValue={processor.dpaUrl ?? ""} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Sous-traitants ultérieurs
        <select name="subprocessorsStatus" defaultValue={processor.subprocessorsStatus} className={inputClass}>
          {TRI_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        Dernière vérification
        <input type="date" name="lastReviewedAt" defaultValue={processor.lastReviewedAt} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Prochaine revue
        <input type="date" name="nextReviewAt" defaultValue={processor.nextReviewAt} className={inputClass} />
      </label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">
        Notes
        <textarea name="notes" defaultValue={processor.notes ?? ""} rows={3} className={inputClass} />
      </label>

      {/* Feedback après soumission */}
      {state.status === "success" && (
        <p className="sm:col-span-2 rounded-lg bg-done-bg px-3 py-2 text-sm font-medium text-done-fg">
          ✓ {state.message}
        </p>
      )}
      {state.status === "error" && (
        <p className="sm:col-span-2 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-fg">
          {state.message}
        </p>
      )}

      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
    </form>
  );
}
