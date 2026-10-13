"use client";

import {
  Book,
  Briefcase,
  Calendar,
  ChartColumn,
  Check,
  Code,
  Flag,
  Folder,
  Globe,
  Heart,
  Lightbulb,
  LoaderCircle,
  Megaphone,
  Rocket,
  Star,
  Target,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "@/hooks/use-focus-trap";
import {
  APPROVAL_LABELS,
  APPROVAL_STYLES,
  COLOR_CHIP,
  COLOR_SWATCH,
  colorKey,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  PROJECT_STATUS_DOTS,
  PROJECT_STATUS_LABELS,
  projectIconKey,
  STATUS_LABELS,
  STATUS_STYLES,
  type ProjectIconKey,
} from "@/lib/tasks/constants";
import { dueLabel, dueTone, DUE_TONE_CLASS } from "@/lib/tasks/format";
import type {
  ApprovalStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  UserRef,
} from "@/lib/tasks/types";

import { useWork, useWorkApi } from "./store";

/* ─── Classes partagées ───────────────────────────────────────────────────── */

export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-accent text-accent-contrast hover:bg-accent-hover shadow-sm`;
export const BTN_SECONDARY = `${BTN} border border-border-strong bg-surface text-ink hover:bg-surface-muted`;
export const BTN_GHOST = `${BTN} text-muted hover:bg-surface-muted hover:text-ink`;
export const BTN_DANGER = `${BTN} bg-critical-fg text-white hover:opacity-90`;
export const ICON_BTN =
  "inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40";
export const INPUT =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export const CHIP = "inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-4";

/* ─── Avatars ─────────────────────────────────────────────────────────────── */

const AVATAR_COLORS = ["bg-indigo-500", "bg-sky-600", "bg-teal-600", "bg-amber-600", "bg-pink-600", "bg-purple-600", "bg-green-600", "bg-orange-600"];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ user, size = 24, title }: { user: UserRef | null | undefined; size?: number; title?: string }) {
  if (!user) {
    return (
      <span
        aria-hidden
        className="inline-grid shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-muted"
        style={{ width: size, height: size }}
      >
        <Users className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      title={title ?? user.name}
      aria-label={title ?? user.name}
      className={`inline-grid shrink-0 select-none place-items-center rounded-full font-semibold text-white ${AVATAR_COLORS[hash(user.id) % AVATAR_COLORS.length]} ${user.isActive ? "" : "opacity-50"}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {user.initials}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 24 }: { users: UserRef[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((u) => (
        <span key={u.id} className="rounded-full ring-2 ring-surface">
          <Avatar user={u} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="inline-grid place-items-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

export function useUser(id: string | null | undefined): UserRef | null {
  return useWork((s) => (id ? (s.context?.users.find((u) => u.id === id) ?? null) : null));
}

/* ─── Badges ──────────────────────────────────────────────────────────────── */

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${CHIP} ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority, compact = false }: { priority: TaskPriority; compact?: boolean }) {
  if (compact && priority === "NORMAL") return null;
  return <span className={`${CHIP} ${PRIORITY_STYLES[priority]}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus | null }) {
  if (!status) return null;
  return <span className={`${CHIP} ${APPROVAL_STYLES[status]}`}>{APPROVAL_LABELS[status]}</span>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink">
      <span aria-hidden className={`h-2 w-2 rounded-full ${PROJECT_STATUS_DOTS[status]}`} />
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

export function ColorChip({ color, children }: { color: string; children: ReactNode }) {
  return <span className={`${CHIP} ${COLOR_CHIP[colorKey(color)]}`}>{children}</span>;
}

export function DueText({
  due,
  start,
  time,
  done,
  today,
  className = "",
}: {
  due: string | null;
  start?: string | null;
  time?: string | null;
  done: boolean;
  today: string;
  className?: string;
}) {
  if (!due && !start) return null;
  const tone = dueTone(due, today, done);
  const label = due
    ? start && start !== due
      ? `${dueLabel(start, today)} – ${dueLabel(due, today, time)}`
      : dueLabel(due, today, time)
    : `Dès ${dueLabel(start!, today)}`;
  return <span className={`whitespace-nowrap text-[12px] ${DUE_TONE_CLASS[tone]} ${className}`}>{label}</span>;
}

/* ─── Icônes de projet ────────────────────────────────────────────────────── */

const PROJECT_ICONS: Record<ProjectIconKey, ComponentType<{ className?: string }>> = {
  folder: Folder,
  briefcase: Briefcase,
  rocket: Rocket,
  target: Target,
  calendar: Calendar,
  megaphone: Megaphone,
  users: Users,
  lightbulb: Lightbulb,
  flag: Flag,
  star: Star,
  heart: Heart,
  code: Code,
  chart: ChartColumn,
  book: Book,
  wrench: Wrench,
  globe: Globe,
};

export function ProjectIcon({ icon, color, size = 24 }: { icon: string; color: string; size?: number }) {
  const Icon = PROJECT_ICONS[projectIconKey(icon)];
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-md text-white ${COLOR_SWATCH[colorKey(color)]}`}
      style={{ width: size, height: size }}
    >
      <Icon className={size >= 28 ? "h-4 w-4" : "h-3 w-3"} />
    </span>
  );
}

export function iconComponent(key: string) {
  return PROJECT_ICONS[projectIconKey(key)];
}

/* ─── Case « terminé » ────────────────────────────────────────────────────── */

export function CompleteToggle({
  done,
  onToggle,
  disabled,
  size = 18,
  label,
  milestone = false,
}: {
  done: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: number;
  label: string;
  milestone?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Rouvrir « ${label} »` : `Terminer « ${label} »`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`group/check inline-grid shrink-0 place-items-center border transition-colors disabled:cursor-not-allowed ${
        milestone ? "rotate-45 rounded-[3px]" : "rounded-full"
      } ${done ? "border-done-fg bg-done-fg text-white" : "border-border-strong text-transparent hover:border-done-fg hover:text-done-fg"}`}
      style={{ width: size, height: size }}
    >
      <Check className={`h-3 w-3 ${milestone ? "-rotate-45" : ""}`} strokeWidth={3} />
    </button>
  );
}

/* ─── États ───────────────────────────────────────────────────────────────── */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <LoaderCircle aria-hidden className={`animate-spin text-muted ${className}`} />;
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Chargement" className="space-y-1.5 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-md bg-surface-muted" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function EmptyBlock({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-muted text-muted">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 flex items-start gap-3 rounded-lg border border-critical-fg/30 bg-critical-bg px-4 py-3 text-[13px] text-critical-fg">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">Impossible d&apos;afficher ces données</p>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline">
          Réessayer
        </button>
      )}
    </div>
  );
}

/* ─── Popover ancré ───────────────────────────────────────────────────────── */

export type Anchor = RefObject<HTMLElement | null> | { x: number; y: number };

const MARGIN = 8;

/**
 * Panneau flottant ancré à un élément (ou à un point, pour un menu
 * contextuel), rendu dans un portail. Échap ou un clic extérieur le ferment ;
 * le focus revient au déclencheur.
 */
export function Popover({
  open,
  anchor,
  onClose,
  children,
  label,
  width,
  align = "start",
  className = "",
}: {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
  align?: "start" | "end";
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const onCloseRef = useRef(onClose);
  // L'ancre peut être un objet recréé à chaque rendu ({ x, y }) : les effets
  // ne dépendent que de son identité utile, sinon le focus serait repris en
  // boucle.
  const anchorRef = useRef(anchor);
  const anchorKey = "current" in anchor ? anchor : `${anchor.x}:${anchor.y}`;
  useEffect(() => {
    onCloseRef.current = onClose;
    anchorRef.current = anchor;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (!panel) return;
      const rect =
        "current" in anchor
          ? anchor.current?.getBoundingClientRect()
          : ({ left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y } as DOMRect);
      if (!rect) return;
      const w = panel.offsetWidth;
      const h = panel.scrollHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? rect.right - w : rect.left;
      left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
      const below = vh - rect.bottom - MARGIN;
      const above = rect.top - MARGIN;
      let top: number;
      let maxHeight: number;
      if (below >= Math.min(h, 320) || below >= above) {
        top = rect.bottom + 4;
        maxHeight = below - 4;
      } else {
        maxHeight = above - 4;
        top = Math.max(MARGIN, rect.top - 4 - Math.min(h, maxHeight));
      }
      setPosition({ top, left, maxHeight: Math.max(160, maxHeight) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorKey, align]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(event.target as Node)) return;
      const anchor = anchorRef.current;
      if ("current" in anchor && anchor.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    const frame = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], input, button, [tabindex='0']");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open, anchorKey]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`fixed z-[70] overflow-y-auto rounded-lg border border-border-subtle bg-surface text-ink shadow-dialog ${className}`}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        maxHeight: position?.maxHeight,
        width,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, ref, close, toggle };
}

/* ─── Menus ───────────────────────────────────────────────────────────────── */

export interface MenuItem {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  checked?: boolean;
  separator?: false;
}

export type MenuEntry = MenuItem | { separator: true; label?: string };

/** Liste de commandes navigable aux flèches (↑ ↓ Début Fin), validée par Entrée. */
export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    if (event.key === "ArrowUp") move(index - 1);
    if (event.key === "Home") move(0);
    if (event.key === "End") move(buttons.length - 1);
  };
  return (
    <div ref={ref} role="menu" className="min-w-48 py-1" onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} role="separator" className="my-1 border-t border-border-subtle">
            {item.label && <p className="px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{item.label}</p>}
          </div>
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-autofocus={i === 0 ? "" : undefined}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors focus:bg-surface-muted focus:outline-none disabled:opacity-40 ${
              item.danger ? "text-critical-fg hover:bg-critical-bg" : "text-ink hover:bg-surface-muted"
            }`}
          >
            {item.icon ? <item.icon className="h-3.5 w-3.5 shrink-0 text-muted" /> : item.checked !== undefined ? <span className="w-3.5" /> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {item.checked && <Check className="h-3.5 w-3.5 text-accent" />}
            {item.hint && <span className="text-[11px] text-muted">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function MenuButton({
  label,
  items,
  children,
  className = ICON_BTN,
  align = "end",
}: {
  label: string;
  items: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const { open, ref, close, toggle } = usePopover();
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={className}
      >
        {children}
      </button>
      <Popover open={open} anchor={ref} onClose={close} label={label} align={align}>
        {open && <MenuList items={typeof items === "function" ? items() : items} onClose={close} />}
      </Popover>
    </>
  );
}

/** Menu contextuel (clic droit / appui long / touche Menu). */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const open = useCallback((event: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, items });
  }, []);
  const close = useCallback(() => setState(null), []);
  const element = state ? (
    <Popover open anchor={{ x: state.x, y: state.y }} onClose={close} label="Menu contextuel">
      <MenuList items={state.items} onClose={close} />
    </Popover>
  ) : null;
  return { open, close, element };
}

/* ─── Boîte de dialogue ───────────────────────────────────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, { active: open, onClose });
  if (!open || typeof document === "undefined") return null;
  const width = size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl";
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40">
      <button type="button" aria-label="Fermer" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="pointer-events-none flex min-h-full items-end justify-center sm:items-center sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`pointer-events-auto relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-border-subtle bg-surface shadow-dialog sm:rounded-xl ${width}`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Fermer" className={ICON_BTN}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  danger = true,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            disabled={pending}
            className={danger ? BTN_DANGER : BTN_PRIMARY}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Spinner className="h-3.5 w-3.5 text-white" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {description && <div className="text-[13px] text-muted">{description}</div>}
      {children}
    </Modal>
  );
}

/* ─── Notifications visuelles ─────────────────────────────────────────────── */

const noopSubscribe = () => () => {};

/** `true` une fois hydraté : les portails ne doivent pas exister dans le HTML serveur. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function ToastViewport() {
  const toasts = useWork((s) => s.toasts);
  const { store } = useWorkApi();
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-lg px-4 py-2.5 text-[13px] shadow-dialog nod-rise ${
            toast.kind === "error"
              ? "bg-critical-fg text-white"
              : toast.kind === "success"
                ? "bg-ink text-bg"
                : "bg-ink text-bg"
          }`}
        >
          <span className="flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                toast.action?.run();
                store.dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" aria-label="Fermer" onClick={() => store.dismiss(toast.id)} className="opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ─── Divers ──────────────────────────────────────────────────────────────── */

/** Champ texte qui s'édite sur place et enregistre à la sortie (Entrée / blur). */
export function InlineText({
  value,
  onSave,
  className = "",
  inputClassName = "",
  placeholder,
  disabled,
  label,
  multiline = false,
  autoFocus = false,
  maxLength = 300,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  multiline?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(autoFocus);
  // Valeur changée ailleurs (autre vue, autre utilisateur) : on la reprend,
  // sauf pendant la saisie.
  const [seen, setSeen] = useState(value);
  if (seen !== value && !editing) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };
  if (disabled) return <span className={className}>{value || placeholder}</span>;
  const common = {
    "aria-label": label,
    value: draft,
    maxLength,
    placeholder,
    autoFocus,
    onFocus: () => setEditing(true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        setDraft(value);
        setEditing(false);
        requestAnimationFrame(() => (e.target as HTMLElement).blur());
      }
    },
    className: `w-full rounded-sm border border-transparent bg-transparent px-1 outline-none hover:border-border-subtle focus:border-accent focus:bg-surface ${inputClassName}`,
  };
  // `field-sizing: content` : la zone grandit avec le texte, sans ligne vide.
  return multiline ? <textarea rows={1} style={{ fieldSizing: "content" } as React.CSSProperties} {...common} /> : <input type="text" {...common} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-surface-muted px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}
