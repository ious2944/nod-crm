"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "@/hooks/use-focus-trap";

/**
 * Confirmation d'une action peu banale (archivage) — V0.7 Lumina Enterprise.
 *
 * Accessibilité (WCAG 2.1 § 2.1.2) : le focus est capturé dans la modale via
 * `useFocusTrap` et restauré sur le déclencheur à la fermeture. Escape est
 * intercepté sur toute la modale (pas seulement l'overlay).
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
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, { active: open, onClose: onCancel });

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50"
    >
      {/* Clic sur l'overlay → annuler. tabIndex={-1} : hors du cycle Tab. */}
      <button
        type="button"
        aria-label="Annuler"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />

      <div className="pointer-events-none flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
        {/*
          Le panneau porte role="alertdialog" et aria-modal="true" pour que les
          lecteurs d'écran masquent le reste du document. Il est également la
          racine du focus trap (ref={panelRef}).
        */}
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto nod-rise relative w-full max-w-md rounded-t-2xl border border-border-subtle bg-surface p-6 shadow-dialog sm:rounded-2xl"
        >
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
    </div>,
    document.body
  );
}
