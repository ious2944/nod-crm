"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Petit panneau ancré sur un déclencheur, rendu dans un portail.
 *
 * Pourquoi un portail plutôt qu'un `absolute` dans la carte : la carte de suivi
 * portait `overflow-hidden` (pour arrondir son liseré de gauche), ce qui
 * découpait le panneau dès qu'il dépassait le bas de la carte. La partie coupée
 * n'était plus peinte, mais le voile de fermeture — en `position: fixed`, donc
 * non découpé — restait dessus : cliquer « +1 sem. » fermait le panneau au lieu
 * de reporter l'échéance. Le menu était visible et pourtant inutilisable.
 *
 * `overflow-hidden` a été retiré de la carte (la cause racine), et le panneau
 * sort du flux : plus de découpage possible, empilement maîtrisé dans le
 * contexte racine, et aucune place occupée dans le document — la hauteur de la
 * liste ne bouge pas à l'ouverture.
 *
 * Volontairement PAS le patron ARIA « menu » : ce panneau ne contient que des
 * boutons ordinaires. Le patron menu imposerait un tabindex mouvant et le
 * piégeage de Tab, faciles à rater, et priverait ces éléments de leur rôle
 * `button`. Ici Tab, Entrée et Échap fonctionnent nativement ; les flèches sont
 * un simple confort.
 */

const MARGIN = 8;
const GAP = 6;

interface Position {
  top: number;
  left: number;
}

export function PopoverMenu({
  label,
  ariaLabel,
  triggerClassName,
  disabled = false,
  children,
}: {
  label: ReactNode;
  /** Nom accessible du panneau, annoncé à l'ouverture. */
  ariaLabel: string;
  triggerClassName?: string;
  disabled?: boolean;
  /** Reçoit une fonction de fermeture, à appeler après une action. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Le focus revient au déclencheur après une fermeture au clavier ou une
  // sélection, mais pas après un clic ailleurs : ce serait voler le focus à
  // l'endroit où l'utilisateur vient justement de cliquer.
  const [restoreFocus, setRestoreFocus] = useState(true);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const menuId = useId();

  // Ne touche aucune ref : cette fonction est passée aux enfants pendant le
  // rendu, elle doit se limiter à de l'état.
  const close = useCallback(() => {
    setRestoreFocus(true);
    setOpen(false);
    setPosition(null);
  }, []);

  const dismiss = useCallback(() => {
    setRestoreFocus(false);
    setOpen(false);
    setPosition(null);
  }, []);

  useEffect(() => {
    if (wasOpen.current && !open && restoreFocus) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, restoreFocus]);

  // Position calculée après le rendu du menu : on a besoin de sa taille réelle
  // pour décider s'il tient sous le déclencheur ou s'il doit basculer au-dessus.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;

      const spaceBelow = window.innerHeight - trigger.bottom;
      const flip = spaceBelow < menu.height + GAP + MARGIN && trigger.top > menu.height + GAP;

      const top = flip ? trigger.top - menu.height - GAP : trigger.bottom + GAP;

      // Aligné à droite du déclencheur, puis ramené dans la fenêtre : sur un
      // écran étroit, un menu aligné à droite sortirait sinon par la gauche.
      const preferred = trigger.right - menu.width;
      const maxLeft = window.innerWidth - menu.width - MARGIN;
      const left = Math.max(MARGIN, Math.min(preferred, Math.max(MARGIN, maxLeft)));

      setPosition({ top, left });
    };

    place();

    // `capture` : un défilement dans un conteneur interne doit aussi repositionner.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Fermeture au clic extérieur. Un écouteur plutôt qu'un voile cliquable :
  // un `<button>` plein écran pollue l'ordre de tabulation et l'arbre
  // d'accessibilité, pour un service que `pointerdown` rend aussi bien.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      dismiss();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, dismiss]);

  // Le premier bouton reçoit le focus : le panneau doit être utilisable au clavier.
  useEffect(() => {
    if (!open || !position) return;
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open, position]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(current + step + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : (setRestoreFocus(true), setOpen(true)))}
        className={triggerClassName}
      >
        {label}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="group"
            aria-label={ariaLabel}
            onKeyDown={onMenuKeyDown}
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Tant que la position n'est pas calculée, le menu est mesurable
              // mais invisible : pas de saut visuel au premier rendu.
              visibility: position ? "visible" : "hidden",
            }}
            className="nod-rise z-50 flex min-w-36 flex-col gap-1 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-lg"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
