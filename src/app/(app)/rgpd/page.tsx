import { connection } from "next/server";

import { PrivacyPageHeader } from "@/components/privacy/privacy-nav";
import { getPrivacyDashboard } from "@/lib/privacy/queries";

export const metadata = { title: "RGPD — NOD CRM" };

const SEVERITY = {
  urgent: "border-danger/30 bg-danger/5",
  warning: "border-warning/30 bg-warning/5",
  info: "border-border-strong bg-surface",
} as const;

export default async function PrivacyDashboardPage() {
  await connection();
  const { counts, alerts } = await getPrivacyDashboard();

  const cards = [
    ["Traitements", counts.treatments, "/rgpd/treatments", "▦"],
    ["Sous-traitants", counts.processors, "/rgpd/processors", "◇"],
    ["Demandes ouvertes", counts.openRequests, "/rgpd/requests", "↔"],
    ["Incidents ouverts", counts.openIncidents, "/rgpd/incidents", "!"],
  ] as const;

  return (
    <div className="flex min-h-full flex-col">
      <PrivacyPageHeader
        current="/rgpd"
        title="RGPD"
        description="L’essentiel de ta conformité, au même endroit — sans prétendre remplacer un conseil juridique."
      />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <section aria-label="Indicateurs RGPD" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, href, icon]) => (
            <a
              key={href}
              href={href}
              className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card transition hover:border-border-strong hover:shadow-card-hover"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-muted">{label}</span>
                <span aria-hidden className="text-lg text-accent">{icon}</span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-ink">{value}</p>
            </a>
          ))}
        </section>

        <section aria-labelledby="privacy-attention-title">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="privacy-attention-title" className="text-xl font-bold text-ink">
                À traiter
              </h2>
              <p className="text-sm text-muted">
                Alertes calculées à partir des informations que tu as documentées.
              </p>
            </div>
            {alerts.length > 0 && (
              <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
                {alerts.length} point{alerts.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-card">
              <p aria-hidden className="text-3xl">✓</p>
              <p className="mt-3 font-semibold text-ink">Aucun point d’attention détecté</p>
              <p className="mt-1 text-sm text-muted">
                Cela ne constitue pas une certification de conformité RGPD.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {alerts.slice(0, 12).map((alert) => (
                <li key={alert.key}>
                  <a
                    href={alert.href}
                    className={`block rounded-xl border p-4 shadow-card transition hover:shadow-card-hover ${SEVERITY[alert.severity]}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-ink">{alert.title}</p>
                      <span className="text-xs font-bold uppercase tracking-wide text-muted">
                        {alert.severity === "urgent"
                          ? "Urgent"
                          : alert.severity === "warning"
                            ? "Attention"
                            : "À vérifier"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{alert.detail}</p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-muted">
          <strong className="text-ink">À retenir.</strong> NOD CRM aide à documenter et piloter les
          processus essentiels de confidentialité. Il ne certifie pas une organisation « conforme RGPD »
          et ne remplace pas un avis juridique ou DPO lorsque la situation l’exige.
        </aside>
      </main>
    </div>
  );
}
