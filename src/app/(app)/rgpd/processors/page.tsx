import { connection } from "next/server";

import { restoreProcessor } from "@/app/(app)/rgpd/archive-actions";
import { archiveProcessor, createProcessor, updateProcessor } from "@/app/(app)/rgpd/actions";
import { PrivacyPageHeader } from "@/components/privacy/privacy-nav";
import { DPA_STATUSES, EEA_STATUSES, TRI_STATES, labelFor } from "@/lib/privacy/constants";
import { listArchivedPrivacyProcessors, listPrivacyProcessors } from "@/lib/privacy/queries";

export const metadata = { title: "Sous-traitants RGPD — NOD CRM" };

const inputClass =
  "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20";

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function PrivacyProcessorsPage() {
  await connection();
  const [items, archivedItems] = await Promise.all([
    listPrivacyProcessors(),
    listArchivedPrivacyProcessors(),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <PrivacyPageHeader
        current="/rgpd/processors"
        title="Sous-traitants"
        description="Suis les prestataires qui traitent des données pour ton organisation et les vérifications à maintenir."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <details className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <summary className="cursor-pointer font-semibold text-ink">+ Ajouter un sous-traitant</summary>
          <ProcessorForm action={createProcessor} />
        </details>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-card">
            <p className="font-semibold text-ink">Aucun sous-traitant documenté</p>
            <p className="mt-1 text-sm text-muted">Ajoute d’abord ton hébergeur, ta messagerie ou ton outil de support.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-ink">{item.name}</h2>
                    <p className="text-sm text-muted">{item.service}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">DPA : {labelFor(DPA_STATUSES, item.dpaStatus)}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">EEE : {labelFor(EEA_STATUSES, item.eeaStatus)}</span>
                  </div>
                </div>
                {item.treatments.length > 0 && (
                  <p className="mt-3 text-xs text-muted">Traitements liés : {item.treatments.map((link) => link.treatment.name).join(", ")}</p>
                )}
                <details className="mt-4 border-t border-border-subtle pt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">Modifier</summary>
                  <ProcessorForm action={updateProcessor} item={item} />
                  <form action={archiveProcessor} className="mt-3">
                    <input type="hidden" name="id" value={item.id} />
                    <button className="text-sm font-semibold text-critical-fg hover:underline">Archiver le sous-traitant</button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}

        {archivedItems.length > 0 && (
          <details className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
            <summary className="cursor-pointer text-sm font-semibold text-muted">
              Archivés ({archivedItems.length})
            </summary>
            <ul className="mt-3 divide-y divide-border-subtle">
              {archivedItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-xs text-muted">{item.service} · archivé le {item.archivedAt?.toLocaleDateString("fr-FR")}</p>
                  </div>
                  <form action={restoreProcessor}>
                    <input type="hidden" name="id" value={item.id} />
                    <button className="text-sm font-semibold text-accent hover:underline">Restaurer</button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
}

function ProcessorForm({
  action,
  item,
}: {
  action: (formData: FormData) => Promise<void>;
  item?: Awaited<ReturnType<typeof listPrivacyProcessors>>[number];
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="text-sm font-medium text-ink">Prestataire<input required name="name" defaultValue={item?.name} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Service utilisé<input required name="service" defaultValue={item?.service} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Catégorie<input name="category" defaultValue={item?.category ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Pays / localisation<input name="country" defaultValue={item?.country ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Données concernées<textarea name="dataCategories" defaultValue={item?.dataCategories ?? ""} rows={2} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Finalité<textarea name="purpose" defaultValue={item?.purpose ?? ""} rows={2} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Traitement dans l’EEE<select name="eeaStatus" defaultValue={item?.eeaStatus ?? "UNKNOWN"} className={inputClass}>{EEA_STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">DPA<select name="dpaStatus" defaultValue={item?.dpaStatus ?? "TO_REVIEW"} className={inputClass}>{DPA_STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><span className="mt-1 block text-xs font-normal text-muted">Contrat encadrant le traitement réalisé par le prestataire pour ton compte.</span></label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">URL / référence du DPA<input name="dpaUrl" defaultValue={item?.dpaUrl ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Sous-traitants ultérieurs<select name="subprocessorsStatus" defaultValue={item?.subprocessorsStatus ?? "UNKNOWN"} className={inputClass}>{TRI_STATES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Dernière vérification<input type="date" name="lastReviewedAt" defaultValue={dateValue(item?.lastReviewedAt ?? null)} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Prochaine revue<input type="date" name="nextReviewAt" defaultValue={dateValue(item?.nextReviewAt ?? null)} className={inputClass} /></label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">Notes<textarea name="notes" defaultValue={item?.notes ?? ""} rows={3} className={inputClass} /></label>
      <div className="sm:col-span-2"><button className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-contrast shadow-card hover:opacity-90">{item ? "Enregistrer" : "Créer le sous-traitant"}</button></div>
    </form>
  );
}
