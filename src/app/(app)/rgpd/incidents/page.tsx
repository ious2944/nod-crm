import { connection } from "next/server";

import { createIncident, updateIncident } from "@/app/(app)/rgpd/actions";
import { PrivacyPageHeader } from "@/components/privacy/privacy-nav";
import {
  INCIDENT_DECISIONS,
  INCIDENT_RISK_LEVELS,
  INCIDENT_STATUSES,
  labelFor,
} from "@/lib/privacy/constants";
import { listPrivacyIncidents } from "@/lib/privacy/queries";

export const metadata = { title: "Incidents RGPD — NOD CRM" };

const inputClass =
  "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20";

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function PrivacyIncidentsPage() {
  await connection();
  const items = await listPrivacyIncidents();

  return (
    <div className="flex min-h-full flex-col">
      <PrivacyPageHeader
        current="/rgpd/incidents"
        title="Incidents / violations"
        description="Documente les incidents impliquant potentiellement des données personnelles et les décisions prises."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <aside className="rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-muted">
          Certaines violations peuvent nécessiter une notification à l’autorité compétente dans un délai réglementaire. NOD CRM t’aide à documenter l’analyse, mais ne décide pas à ta place si une notification est obligatoire.
        </aside>

        <details className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <summary className="cursor-pointer font-semibold text-ink">+ Enregistrer un incident</summary>
          <IncidentForm action={createIncident} />
        </details>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-card">
            <p className="font-semibold text-ink">Aucun incident enregistré</p>
            <p className="mt-1 text-sm text-muted">Conserve ici aussi les incidents clos : l’historique fait partie de la traçabilité.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-ink">{item.title}</h2>
                    <p className="text-sm text-muted">Découvert le {item.discoveredAt.toLocaleDateString("fr-FR")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">{labelFor(INCIDENT_STATUSES, item.status)}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">Risque : {labelFor(INCIDENT_RISK_LEVELS, item.riskLevel)}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">Autorité : {labelFor(INCIDENT_DECISIONS, item.authorityNotification)}</span>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted">{item.description}</p>
                <details className="mt-4 border-t border-border-subtle pt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">Modifier / documenter l’analyse</summary>
                  <IncidentForm action={updateIncident} item={item} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function IncidentForm({
  action,
  item,
}: {
  action: (formData: FormData) => Promise<void>;
  item?: Awaited<ReturnType<typeof listPrivacyIncidents>>[number];
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="sm:col-span-2 text-sm font-medium text-ink">Titre<input required name="title" defaultValue={item?.title} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Date de découverte<input required type="date" name="discoveredAt" defaultValue={dateValue(item?.discoveredAt ?? new Date())} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Date estimée de l’incident<input type="date" name="occurredAt" defaultValue={dateValue(item?.occurredAt ?? null)} className={inputClass} /></label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">Description<textarea required name="description" defaultValue={item?.description} rows={4} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Catégories de données<textarea name="dataCategories" defaultValue={item?.dataCategories ?? ""} rows={2} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Nombre approximatif de personnes<input type="number" min="0" name="affectedCount" defaultValue={item?.affectedCount ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Conséquences potentielles<textarea name="consequences" defaultValue={item?.consequences ?? ""} rows={3} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Mesures prises<textarea name="measures" defaultValue={item?.measures ?? ""} rows={3} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Niveau de risque<select name="riskLevel" defaultValue={item?.riskLevel ?? "TO_ASSESS"} className={inputClass}>{INCIDENT_RISK_LEVELS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Notification autorité<select name="authorityNotification" defaultValue={item?.authorityNotification ?? "TO_ASSESS"} className={inputClass}>{INCIDENT_DECISIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Date de notification éventuelle<input type="date" name="notifiedAt" defaultValue={dateValue(item?.notifiedAt ?? null)} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Personnes informées<select name="peopleInformed" defaultValue={item?.peopleInformed ?? "TO_ASSESS"} className={inputClass}>{INCIDENT_DECISIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Responsable<input name="owner" defaultValue={item?.owner ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Statut<select name="status" defaultValue={item?.status ?? "OPEN"} className={inputClass}>{INCIDENT_STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <div className="sm:col-span-2"><button className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-contrast shadow-card hover:opacity-90">{item ? "Enregistrer" : "Créer l’incident"}</button></div>
    </form>
  );
}
