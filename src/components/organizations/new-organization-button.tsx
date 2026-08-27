"use client";

import { useState } from "react";

import { OrganizationDialog } from "./organization-dialog";

export function NewOrganizationButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
      >
        Nouvelle organisation
      </button>

      <OrganizationDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
