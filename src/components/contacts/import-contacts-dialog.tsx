"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { importContacts, previewContactImport } from "@/app/(app)/contacts/import-actions";
import { LABEL } from "@/components/ui/form";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, tooLargeMessage } from "@/lib/contacts/import/limits";
import type { DuplicateMode } from "@/lib/contacts/import/plan";
import type { ImportPreview } from "@/lib/contacts/import/service";

/**
 * Import d'un export CSV Outlook, en deux temps.
 *
 * 1. **Aperçu** : le fichier part au serveur, qui l'analyse sans rien écrire
 *    (contacts lus, colonnes, doublons, anomalies ligne par ligne).
 * 2. **Confirmation** : le même fichier repart, avec le choix fait pour les
 *    doublons ; le serveur refait l'analyse et écrit tout ou rien.
 *
 * Le fichier ne vit que dans la mémoire de cet onglet entre les deux étapes :
 * il n'est stocké nulle part côté serveur.
 */

type Step =
  | { name: "choose"; error?: string }
  | { name: "preview"; preview: ImportPreview; error?: string }
  | { name: "done"; message: string };

const BUTTON_PRIMARY =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60";
const BUTTON_SECONDARY =
  "rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-60";

const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`;

function Alert({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const colors = tone === "error" ? "bg-late-bg text-late-fg" : "bg-done-bg text-done-fg";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${colors}`}>
      {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className={LABEL}>{title}</h3>
      {children}
    </section>
  );
}

function PreviewView({ preview }: { preview: ImportPreview }) {
  const issues = preview.errorCount + preview.warningCount;
  return (
    <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1 text-sm">
      <ul className="grid gap-2 sm:grid-cols-2">
        <li className="rounded-lg bg-surface-muted px-3 py-2">
          <span className="font-semibold">{plural(preview.rowCount, "ligne")}</span> lue
          {preview.rowCount > 1 ? "s" : ""}
        </li>
        <li className="rounded-lg bg-surface-muted px-3 py-2">
          <span className="font-semibold">{plural(preview.toCreate, "contact")}</span> à créer
        </li>
        <li className="rounded-lg bg-surface-muted px-3 py-2">
          {plural(preview.fileDuplicates.length, "doublon")} dans le fichier
        </li>
        <li className="rounded-lg bg-surface-muted px-3 py-2">
          {plural(preview.existingDuplicates.length, "contact")} déjà présent
          {preview.existingDuplicates.length > 1 ? "s" : ""}
        </li>
      </ul>

      <details className="rounded-lg border border-border-subtle px-3 py-2">
        <summary className="cursor-pointer">
          Colonnes : {preview.recognizedColumns.length} reconnue{preview.recognizedColumns.length > 1 ? "s" : ""},{" "}
          {preview.ignoredColumns.length + preview.unknownColumns.length} ignorée
          {preview.ignoredColumns.length + preview.unknownColumns.length > 1 ? "s" : ""}
        </summary>
        <p className="mt-2">
          <span className="font-medium">Reconnues ({preview.recognizedColumns.length}) : </span>
          <span className="text-muted">
            {preview.recognizedColumns
              .map((c) => (c.fate === "notes" ? `${c.header} (→ notes)` : c.header))
              .join(", ") || "aucune"}
          </span>
        </p>
        {preview.ignoredColumns.length + preview.unknownColumns.length > 0 && (
          <p className="mt-1">
            <span className="font-medium">
              Ignorées ({preview.ignoredColumns.length + preview.unknownColumns.length}) :{" "}
            </span>
            <span className="text-muted">
              {[...preview.ignoredColumns, ...preview.unknownColumns.map((h) => `${h} (inconnue)`)].join(", ")}
            </span>
          </p>
        )}
      </details>

      {preview.fileDuplicates.length > 0 && (
        <Section title="Doublons dans le fichier — non importés">
          <ul className="space-y-2">
            {preview.fileDuplicates.map((d) => (
              <li key={d.line} className="rounded-lg border border-border-subtle px-3 py-2">
                <p>
                  Ligne {d.line} : même e-mail que la ligne {d.keptLine} ({d.email}). La ligne {d.keptLine} est
                  gardée.
                </p>
                {d.lost.length > 0 ? (
                  <>
                    <p className="mt-1 font-medium text-late-fg">Données perdues :</p>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted">
                      {d.lost.map((item) => (
                        <li key={item.label} className="whitespace-pre-line">
                          {item.label} : {item.value}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-1 text-muted">Aucune donnée perdue.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {preview.existingDuplicates.length > 0 && (
        <Section title="Contacts déjà présents">
          <ul className="space-y-1">
            {preview.existingDuplicates.map((d) => (
              <li key={d.line}>
                Ligne {d.line} : {d.email} → {d.contactName}
                {d.archived && " (archivé)"}
                {d.otherMatches > 0 && ` (+ ${plural(d.otherMatches, "autre contact")} avec cet e-mail, non touché${d.otherMatches > 1 ? "s" : ""})`}
                <span className="text-muted">
                  {" "}
                  — {d.fillable.length ? `champs vides complétables : ${d.fillable.join(", ")}` : "rien à compléter"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {issues > 0 && (
        <Section title={`Erreurs (${preview.errorCount}) et avertissements (${preview.warningCount})`}>
          <ul className="space-y-0.5">
            {preview.issues.map((issue, index) => (
              <li key={index} className={issue.level === "error" ? "text-late-fg" : "text-soon-fg"}>
                Ligne {issue.line} — {issue.level === "error" ? "erreur" : "avertissement"} : {issue.message}
              </li>
            ))}
          </ul>
          {preview.issues.length < issues && (
            <p className="text-muted">… et {plural(issues - preview.issues.length, "autre")}.</p>
          )}
        </Section>
      )}
    </div>
  );
}

export function ImportContactsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const fileId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<DuplicateMode>("skip");
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [pending, startTransition] = useTransition();

  const close = () => {
    setFile(null);
    setMode("skip");
    setStep({ name: "choose" });
    onClose();
  };

  useFocusTrap(panelRef, { active: open, onClose: close });

  if (!open) return null;

  const withFile = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set("file", file!);
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  };

  const analyse = () => {
    if (!file) return setStep({ name: "choose", error: "Choisis un fichier CSV." });
    // Contrôle anticipé : au-delà, la requête serait refusée avant même
    // d'atteindre le serveur, sans message utile.
    if (file.size > IMPORT_MAX_BYTES) return setStep({ name: "choose", error: tooLargeMessage(file.size) });
    startTransition(async () => {
      const result = await previewContactImport(withFile());
      setStep(result.ok ? { name: "preview", preview: result.preview } : { name: "choose", error: result.error });
    });
  };

  const confirm = (preview: ImportPreview) => {
    startTransition(async () => {
      const result = await importContacts(withFile({ mode }));
      if (!result.ok) return setStep({ name: "preview", preview, error: result.error });
      const parts = [`${plural(result.created, "contact")} créé${result.created > 1 ? "s" : ""}`];
      if (result.updated) parts.push(`${plural(result.updated, "contact")} complété${result.updated > 1 ? "s" : ""}`);
      if (result.skipped) parts.push(`${plural(result.skipped, "doublon")} ignoré${result.skipped > 1 ? "s" : ""}`);
      if (result.rejected) parts.push(`${plural(result.rejected, "ligne")} rejetée${result.rejected > 1 ? "s" : ""}`);
      setStep({ name: "done", message: `Import terminé : ${parts.join(", ")}.` });
      router.refresh();
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/50">
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <div className="pointer-events-none flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto nod-rise relative w-full max-w-2xl space-y-4 rounded-t-2xl border border-border-subtle bg-surface p-5 shadow-dialog sm:rounded-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                Importer des contacts
              </h2>
              <p className="text-sm text-muted">Export CSV d’Outlook (nouvel Outlook ou Outlook classique).</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>

          {step.name === "choose" && (
            <>
              <div className="space-y-1.5">
                <label className={LABEL} htmlFor={fileId}>
                  Fichier CSV
                </label>
                <input
                  id={fileId}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
                />
                <p className="text-xs text-muted">
                  2,5 Mo et {IMPORT_MAX_ROWS.toLocaleString("fr-FR")} lignes maximum. Rien n’est enregistré avant
                  ta confirmation.
                </p>
              </div>
              {step.error && <Alert tone="error">{step.error}</Alert>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className={BUTTON_SECONDARY}>
                  Annuler
                </button>
                <button type="button" onClick={analyse} disabled={pending || !file} className={BUTTON_PRIMARY}>
                  {pending ? "Analyse…" : "Analyser le fichier"}
                </button>
              </div>
            </>
          )}

          {step.name === "preview" && (
            <>
              <PreviewView preview={step.preview} />

              {step.preview.existingDuplicates.length > 0 && (
                <fieldset className="space-y-1 text-sm">
                  <legend className={LABEL}>Que faire des contacts déjà présents ?</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === "skip"}
                      onChange={() => setMode("skip")}
                    />
                    Les ignorer
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === "complete"}
                      onChange={() => setMode("complete")}
                    />
                    Compléter leurs champs vides (aucune donnée existante n’est remplacée)
                  </label>
                </fieldset>
              )}

              {step.error && <Alert tone="error">{step.error}</Alert>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep({ name: "choose" })}
                  disabled={pending}
                  className={BUTTON_SECONDARY}
                >
                  Changer de fichier
                </button>
                <button
                  type="button"
                  onClick={() => confirm(step.preview)}
                  disabled={
                    pending ||
                    (step.preview.toCreate === 0 && (mode === "skip" || step.preview.existingDuplicates.length === 0))
                  }
                  className={BUTTON_PRIMARY}
                >
                  {pending ? "Import…" : `Importer ${plural(step.preview.toCreate, "contact")}`}
                </button>
              </div>
            </>
          )}

          {step.name === "done" && (
            <>
              <Alert tone="success">{step.message}</Alert>
              <div className="flex justify-end">
                <button type="button" onClick={close} className={BUTTON_PRIMARY}>
                  Fermer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
