"use client";

import { useState } from "react";

import { ImportContactsDialog } from "./import-contacts-dialog";

/** Bouton « Importer » de l'en-tête Contacts, et le dialogue qu'il ouvre. */
export function ImportContactsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        Importer
      </button>

      <ImportContactsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
