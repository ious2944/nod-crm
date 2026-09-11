"use client";

import { useEffect, useRef } from "react";

/**
 * Capture le focus dans un conteneur de boîte de dialogue pendant qu'elle est ouverte.
 *
 * Comportement :
 * - Tab / Shift+Tab cycles à l'intérieur du conteneur — on ne peut pas sortir
 *   de la modale au clavier sans la fermer.
 * - Escape appelle `onClose` depuis n'importe quel endroit de la modale.
 * - Le focus est restauré sur l'élément déclencheur à la fermeture.
 *
 * Répond au critère WCAG 2.1 § 2.1.2 (No Keyboard Trap) : le focus peut
 * toujours être libéré via Escape, et ne peut pas s'échapper involontairement.
 *
 * Usage :
 * ```tsx
 * const panelRef = useRef<HTMLDivElement>(null);
 * useFocusTrap(panelRef, { active: open, onClose });
 * // …
 * <div ref={panelRef} role="dialog" aria-modal="true">…</div>
 * ```
 */

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  { active, onClose }: { active: boolean; onClose: () => void },
): void {
  /**
   * Stable ref pour onClose : évite que l'event listener soit recréé à chaque
   * re-render si la fonction change d'identité (inline ou non-mémoïsée).
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /**
   * `useRef(initialValue)` — l'initialiseur s'évalue lors du PREMIER rendu du
   * hook (phase de rendu, avant la phase de commit où `autoFocus` s'applique).
   * À ce moment, `document.activeElement` est encore l'élément déclencheur
   * (bouton, lien…) et non le premier champ de la modale.
   *
   * Chaque nouveau montage du composant recrée ce ref avec la valeur fraîche,
   * ce qui est le comportement souhaité : chaque ouverture de modale capture
   * le déclencheur courant.
   *
   * C'est une lecture DOM en phase de rendu — pas une mutation, pas un accès
   * à `ref.current` — acceptée par `react-hooks/refs`.
   */
  const savedFocusRef = useRef<Element | null>(
    typeof document !== "undefined" ? document.activeElement : null,
  );

  useEffect(() => {
    if (!active) return;

    // Capture à l'intérieur de l'effet pour satisfaire react-hooks/exhaustive-deps :
    // la ref peut changer entre le montage de l'effet et son cleanup.
    const savedElement = savedFocusRef.current;
    const container = containerRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      ).filter(
        (el) =>
          !el.closest('[aria-hidden="true"]') &&
          // Exclut les éléments cachés (display:none, visibility:hidden).
          // offsetParent est null pour les éléments non rendus, sauf position:fixed.
          (el.offsetParent !== null || getComputedStyle(el).position === "fixed"),
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const currentFocus = document.activeElement;

      if (event.shiftKey) {
        // Shift+Tab depuis le premier élément → aller au dernier
        if (currentFocus === first || !container.contains(currentFocus)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab depuis le dernier élément → aller au premier
        if (currentFocus === last || !container.contains(currentFocus)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restaure le focus sur l'élément qui a ouvert la modale
      if (savedElement instanceof HTMLElement) {
        savedElement.focus();
      }
    };
  }, [active, containerRef]);
}
