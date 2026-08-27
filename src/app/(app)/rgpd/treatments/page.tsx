import { connection } from "next/server";

import { restoreTreatment } from "@/app/(app)/rgpd/archive-actions";
import { archiveTreatment, createTreatment, updateTreatment } from "@/app/(app)/rgpd/actions";
import { PrivacyPageHeader } from "@/components/privacy/privacy-nav";
import { LEGAL_BASES, TREATMENT_STATUSES, labelFor } from "@/lib/privacy/constants";
import {
  listArchivedPrivacyTreatments,
  listPrivacyProcessorOptions,
  listPrivacyTreatments,
} from "@/lib/privacy/queries";

export const metadata = { title: "Traitements RGPD — NOD CRM" };

const inputClass =
  "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20";

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function PrivacyTreatmentsPage() {
  await connection();
  const [items, archivedItems, processors] = await Promise.all([
    listPrivacyTreatments(),
    listArchivedPrivacyTreatments(),
    listPrivacyProcessorOptions(),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <PrivacyPageHeader
        current="/rgpd/treatments"
        title="Registre des traitements"
        description="Documente pourquoi des données personnelles sont utilisées, lesquelles et combien de temps."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <details className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <summary className="cursor-pointer font-semibold text-ink">+ Ajouter un traitement</summary>
          <TreatmentForm action={createTreatment} processors={processors} />
        </details>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-card">
            <p className="font-semibold text-ink">Aucun traitement documenté</p>
            <p className="mt-1 text-sm text-muted">Commence par un traitement concret : prospection, paie, support…</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-ink">{item.name}</h2>
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                        {labelFor(TREATMENT_STATUSES, item.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{item.purpose}</p>
                  </div>
                  <div className="text-right text-xs text-muted">
                    <p>Base : {labelFor(LEGAL_BASES, item.legalBasis)}</p>
                    <p>Conservation : {item.retentionPeriod || "À définir"}</p>
                  </div>
                </div>

                {item.processors.length > 0 && (
                  <p className="mt-3 text-xs text-muted">
                    Sous-traitants : {item.processors.map((link) => link.processor.name).join(", ")}
                  </p>
                )}

                <details className="mt-4 border-t border-border-subtle pt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">Modifier</summary>
                  <TreatmentForm
                    action={updateTreatment}
                    processors={processors}
                    item={item}
                    selectedProcessors={item.processors.map((link) => link.processor.id)}
                  />
                  <form action={archiveTreatment} className="mt-3">
                    <input type="hidden" name="id" value={item.id} />
                    <button className="text-sm font-semibold text-critical-fg hover:underline">Archiver le traitement</button>
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
                    <p className="text-xs text-muted">Archivé le {item.archivedAt?.toLocaleDateString("fr-FR")}</p>
                  </div>
                  <form action={restoreTreatment}>
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

function TreatmentForm({
  action,
  processors,
  item,
  selectedProcessors = [],
}: {
  action: (formData: FormData) => Promise<void>;
  processors: Awaited<ReturnType<typeof listPrivacyProcessorOptions>>;
  item?: Awaited<ReturnType<typeof listPrivacyTreatments>>[number];
  selectedProcessors?: string[];
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="text-sm font-medium text-ink">
        Nom du traitement
        <input required name="name" defaultValue={item?.name} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Responsable / service
        <input name="owner" defaultValue={item?.owner ?? ""} className={inputClass} />
      </label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">
        Finalité
        <textarea required name="purpose" defaultValue={item?.purpose} rows={2} className={inputClass} />
        <span className="mt-1 block text-xs font-normal text-muted">Pourquoi ce traitement existe.</span>
      </label>
      <label className="text-sm font-medium text-ink">
        Personnes concernées
        <textarea name="dataSubjects" defaultValue={item?.dataSubjects ?? ""} rows={2} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Catégories de données
        <textarea name="dataCategories" defaultValue={item?.dataCategories ?? ""} rows={2} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Base légale
        <select name="legalBasis" defaultValue={item?.legalBasis ?? "TO_DETERMINE"} className={inputClass}>
          {LEGAL_BASES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">Le fondement juridique documenté par l’organisation.</span>
      </label>
      <label className="text-sm font-medium text-ink">
        Durée / règle de conservation
        <input name="retentionPeriod" defaultValue={item?.retentionPeriod ?? ""} placeholder="Ex. relation + 3 ans" className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Destinataires
        <textarea name="recipients" defaultValue={item?.recipients ?? ""} rows={2} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Transfert hors EEE
        <select name="transferOutsideEea" defaultValue={item?.transferOutsideEea ?? "UNKNOWN"} className={inputClass}>
          <option value="UNKNOWN">Inconnu / à vérifier</option>
          <option value="NO">Non</option>
          <option value="YES">Oui</option>
        </select>
      </label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">
        Sous-traitants liés
        <select name="processorId" multiple defaultValue={selectedProcessors} className={`${inputClass} min-h-28`}>
          {processors.map((processor) => (
            <option key={processor.id} value={processor.id}>{processor.name} — {processor.service}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">Ctrl/Cmd + clic pour en sélectionner plusieurs.</span>
      </label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">
        Mesures de sécurité / notes
        <textarea name="securityMeasures" defaultValue={item?.securityMeasures ?? ""} rows={3} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Dernière revue
        <input type="date" name="lastReviewedAt" defaultValue={dateValue(item?.lastReviewedAt ?? null)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Prochaine revue
        <input type="date" name="nextReviewAt" defaultValue={dateValue(item?.nextReviewAt ?? null)} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink">
        Statut
        <select name="status" defaultValue={item?.status ?? "ACTIVE"} className={inputClass}>
          {TREATMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <input type="hidden" name="description" value={item?.description ?? ""} />
      <div className="flex items-end">
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-contrast shadow-card hover:opacity-90">
          {item ? "Enregistrer" : "Créer le traitement"}
        </button>
      </div>
    </form>
  );
}
