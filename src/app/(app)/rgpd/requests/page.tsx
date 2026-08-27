import { connection } from "next/server";

import { createPrivacyRequest, updatePrivacyRequest } from "@/app/(app)/rgpd/actions";
import { PrivacyPageHeader } from "@/components/privacy/privacy-nav";
import { REQUEST_STATUSES, REQUEST_TYPES, labelFor } from "@/lib/privacy/constants";
import { listPrivacyContactOptions, listPrivacyRequests } from "@/lib/privacy/queries";

export const metadata = { title: "Demandes RGPD — NOD CRM" };

const inputClass =
  "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/20";
const DAY = 86_400_000;

function dateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function deadlineLabel(dueAt: Date, status: string, now: Date) {
  if (status === "COMPLETED" || status === "REFUSED") return "Clôturée";
  const days = Math.ceil((dueAt.getTime() - now.getTime()) / DAY);
  if (days < 0) return `En retard de ${Math.abs(days)} j`;
  if (days === 0) return "Échéance aujourd’hui";
  return `Échéance dans ${days} j`;
}

export default async function PrivacyRequestsPage() {
  await connection();
  const now = new Date();
  const [items, contacts] = await Promise.all([listPrivacyRequests(), listPrivacyContactOptions()]);

  return (
    <div className="flex min-h-full flex-col">
      <PrivacyPageHeader
        current="/rgpd/requests"
        title="Demandes RGPD"
        description="Suis les demandes d’accès, rectification, effacement, opposition, limitation ou portabilité."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <details className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <summary className="cursor-pointer font-semibold text-ink">+ Enregistrer une demande</summary>
          <RequestForm action={createPrivacyRequest} contacts={contacts} now={now} />
        </details>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-card">
            <p className="font-semibold text-ink">Aucune demande enregistrée</p>
            <p className="mt-1 text-sm text-muted">Une demande peut être liée à un contact NOD CRM ou documentée librement.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const identity = item.contact
                ? `${item.contact.firstName} ${item.contact.lastName}`.trim()
                : item.requesterName || item.requesterEmail || "Personne non renseignée";
              const isLate =
                item.dueAt < now && item.status !== "COMPLETED" && item.status !== "REFUSED";
              return (
                <li key={item.id} className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-ink">{identity}</h2>
                      <p className="text-sm text-muted">{labelFor(REQUEST_TYPES, item.requestType)} · reçue le {item.receivedAt.toLocaleDateString("fr-FR")}</p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">{labelFor(REQUEST_STATUSES, item.status)}</span>
                      <p className={`mt-2 text-xs font-semibold ${isLate ? "text-critical-fg" : "text-muted"}`}>{deadlineLabel(item.dueAt, item.status, now)}</p>
                    </div>
                  </div>
                  <details className="mt-4 border-t border-border-subtle pt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-accent">Modifier</summary>
                    <RequestForm action={updatePrivacyRequest} contacts={contacts} item={item} now={now} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function RequestForm({
  action,
  contacts,
  item,
  now,
}: {
  action: (formData: FormData) => Promise<void>;
  contacts: Awaited<ReturnType<typeof listPrivacyContactOptions>>;
  item?: Awaited<ReturnType<typeof listPrivacyRequests>>[number];
  now: Date;
}) {
  const defaultReceived = item?.receivedAt ?? now;
  const defaultDue = item?.dueAt ?? new Date(now.getTime() + 30 * DAY);
  return (
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="text-sm font-medium text-ink">Contact NOD CRM<select name="contactId" defaultValue={item?.contactId ?? ""} className={inputClass}><option value="">Aucun / personne externe</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` — ${c.email}` : ""}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Type de demande<select name="requestType" defaultValue={item?.requestType ?? "ACCESS"} className={inputClass}>{REQUEST_TYPES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Nom libre<input name="requesterName" defaultValue={item?.requesterName ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Email<input type="email" name="requesterEmail" defaultValue={item?.requesterEmail ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Date de réception<input required type="date" name="receivedAt" defaultValue={dateValue(defaultReceived)} className={inputClass} /></label>
      <label className="text-sm font-medium text-ink">Échéance<input required type="date" name="dueAt" defaultValue={dateValue(defaultDue)} className={inputClass} /><span className="mt-1 block text-xs font-normal text-muted">La date est proposée mais reste modifiable selon la situation.</span></label>
      <label className="text-sm font-medium text-ink">Statut<select name="status" defaultValue={item?.status ?? "RECEIVED"} className={inputClass}>{REQUEST_STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm font-medium text-ink">Responsable interne<input name="owner" defaultValue={item?.owner ?? ""} className={inputClass} /></label>
      <label className="sm:col-span-2 text-sm font-medium text-ink">Notes<textarea name="notes" defaultValue={item?.notes ?? ""} rows={3} className={inputClass} /></label>
      <div className="sm:col-span-2"><button className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-contrast shadow-card hover:opacity-90">{item ? "Enregistrer" : "Créer la demande"}</button></div>
    </form>
  );
}
