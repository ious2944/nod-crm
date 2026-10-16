"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Glisser-déposer maison, fondé sur les Pointer Events : un seul mécanisme
 * pour la souris, le stylet et le tactile (le drag & drop HTML5 natif ne
 * fonctionne pas au doigt). Aucune dépendance.
 *
 * - Les cibles sont des éléments portant `data-drop="<type>"` et
 *   `data-drop-id`. `data-drop-mode="zone"` : dépôt « dans » (colonne, jour) ;
 *   sinon « avant / après » selon la moitié survolée (lignes, cartes).
 * - Le glisser démarre après 4 px de déplacement (souris) ou un appui de
 *   250 ms (tactile), pour ne pas gêner le clic ni le défilement.
 * - Échap annule ; le conteneur `[data-scroll]` le plus proche défile seul
 *   près des bords.
 *
 * Accessibilité : le glisser-déposer n'est jamais le seul moyen. Chaque
 * déplacement existe aussi au clavier (Alt + ↑/↓, menu « Déplacer vers… »).
 */

export interface DragItem {
  type: string;
  id: string;
  label: string;
  /** Plusieurs éléments déplacés ensemble (sélection multiple). */
  ids?: string[];
}

export interface DropTarget {
  type: string;
  id: string;
  position: "before" | "after" | "inside";
  data: DOMStringMap;
}

interface Options {
  accepts: (item: DragItem, target: DropTarget) => boolean;
  onDrop: (item: DragItem, target: DropTarget) => void;
}

function findTarget(x: number, y: number, item: DragItem, accepts: Options["accepts"]): DropTarget | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const el = (element as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (!el) continue;
    const zone = el.dataset.dropMode === "zone";
    const rect = el.getBoundingClientRect();
    const horizontal = el.dataset.dropAxis === "x";
    const position: DropTarget["position"] = zone
      ? "inside"
      : (horizontal ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2)
        ? "before"
        : "after";
    const target: DropTarget = { type: el.dataset.drop!, id: el.dataset.dropId ?? "", position, data: el.dataset };
    if (target.id === item.id && !zone) return null;
    if (accepts(item, target)) return target;
  }
  return null;
}

export function useDragAndDrop({ accepts, onDrop }: Options) {
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const handlers = useRef({ accepts, onDrop });
  useEffect(() => {
    handlers.current = { accepts, onDrop };
  });
  const suppressClick = useRef(false);

  const start = useCallback((event: React.PointerEvent, item: DragItem) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-drag]")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const touch = event.pointerType === "touch";
    const scroller = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-scroll]");
    let active = false;
    let current: DropTarget | null = null;
    let raf = 0;
    let lastX = startX;
    let lastY = startY;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;

    const begin = () => {
      active = true;
      setDragging(item);
      setGhost({ x: lastX, y: lastY });
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      tick();
    };

    const tick = () => {
      if (!active) return;
      const edge = 48;
      const speed = 14;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (lastY < rect.top + edge) scroller.scrollTop -= speed;
        else if (lastY > rect.bottom - edge) scroller.scrollTop += speed;
        if (lastX < rect.left + edge) scroller.scrollLeft -= speed;
        else if (lastX > rect.right - edge) scroller.scrollLeft += speed;
      } else {
        if (lastY < edge) window.scrollBy(0, -speed);
        else if (lastY > window.innerHeight - edge) window.scrollBy(0, speed);
      }
      raf = requestAnimationFrame(tick);
    };

    if (touch) pressTimer = setTimeout(begin, 250);

    const move = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!active) {
        const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (touch) {
          if (distance > 8 && pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
            cleanup();
          }
          return;
        }
        if (distance < 4) return;
        begin();
      }
      e.preventDefault();
      setGhost({ x: e.clientX, y: e.clientY });
      current = findTarget(e.clientX, e.clientY, item, handlers.current.accepts);
      setOver((prev) =>
        prev?.id === current?.id && prev?.position === current?.position && prev?.type === current?.type ? prev : current,
      );
    };

    const finish = (commit: boolean) => {
      const wasActive = active;
      cleanup();
      if (wasActive) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (commit && current) handlers.current.onDrop(item, current);
      }
    };

    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };

    function cleanup() {
      active = false;
      if (pressTimer) clearTimeout(pressTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(null);
      setOver(null);
      setGhost(null);
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  }, []);

  /** À appeler dans les `onClick` des éléments déplaçables. */
  const wasDragged = useCallback(() => suppressClick.current, []);

  const overlay =
    dragging && ghost && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-[90] max-w-xs truncate rounded-md border border-accent bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-dialog"
            style={{ left: ghost.x + 12, top: ghost.y + 8 }}
          >
            {dragging.ids && dragging.ids.length > 1 ? `${dragging.ids.length} tâches` : dragging.label}
          </div>,
          document.body,
        )
      : null;

  return { start, dragging, over, overlay, wasDragged };
}

/** Classe d'indicateur de dépôt pour une ligne/carte. */
export function dropIndicator(over: DropTarget | null, type: string, id: string): string {
  if (!over || over.type !== type || over.id !== id) return "";
  if (over.position === "before") return "shadow-[inset_0_2px_0_0_var(--nod-accent)]";
  if (over.position === "after") return "shadow-[inset_0_-2px_0_0_var(--nod-accent)]";
  return "ring-2 ring-accent ring-inset bg-accent-soft/40";
}
