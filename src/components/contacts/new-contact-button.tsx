"use client";

import { useState } from "react";

import { ContactDialog } from "./contact-dialog";

/** Bouton « + Nouveau contact » de l'en-tête, et le dialogue qu'il ouvre. */
export function NewContactButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
      >
        <span aria-hidden>+</span> Nouveau contact
      </button>

      <ContactDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
