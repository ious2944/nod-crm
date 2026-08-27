"use client";

import { useEffect, useId, type ReactNode } from "react";

/**
 * Confirmation d'une action peu banale (archivage) — V0.7 Lumina Enterprise.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="Annuler"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />

      <div className="nod-rise relative w-full max-w-md rounded-t-2xl border border-border-subtle bg-surface p-6 shadow-dialog sm:rounded-2xl">
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description && <div className="mt-2 text-sm text-muted">{description}</div>}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            Annuler
          </button>
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onConfirm}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
