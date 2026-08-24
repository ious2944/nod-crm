import { dayKey } from "@/lib/date";
import {
  ageLabel,
  computeTiming,
  type BallOwner,
  type FollowUpStatus,
  type Timing,
  type UrgencyLevel,
} from "./domain";

/** Données minimales attendues d'une ligne `follow_ups` (+ son contact). */
export interface FollowUpRecord {
  id: string;
  title: string;
  description: string | null;
  status: FollowUpStatus;
  ballOwner: BallOwner;
  dueAt: Date;
  nudgeCount: number;
  lastNudgedAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
  completedAt: Date | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    organizationName: string | null;
    archivedAt: Date | null;
  } | null;
}

/** Ce que reçoivent les composants React : sérialisable, sans logique restante. */
export interface FollowUpView {
  id: string;
  title: string;
  description: string | null;
  status: FollowUpStatus;
  ballOwner: BallOwner;
  /** `YYYY-MM-DD`, pré-rempli dans les formulaires de report. */
  dueDate: string;
  dueLabel: string;
  level: UrgencyLevel;
  overdueDays: number;
  ageLabel: string;
  needsAttention: boolean;
  ballLabel: string;
  contactName: string | null;
  contactInitials: string | null;
  /** Le contact lié a été archivé : on le dit, on ne le fait pas disparaître. */
  contactArchived: boolean;
  organizationName: string | null;
  nudgeCount: number;
  nudgeLabel: string | null;
  isDemo: boolean;
}

export function contactFullName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

function initials(contact: { firstName: string; lastName: string }): string {
  const first = contact.firstName.trim()[0] ?? "";
  const last = contact.lastName.trim()[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

/** « Chez moi » / « Chez Patrick » : la métaphore de la balle, en clair. */
export function ballLabel(ballOwner: BallOwner, firstName?: string | null): string {
  if (ballOwner === "ME") return "Chez moi";
  return firstName ? `Chez ${firstName}` : "Chez eux";
}

export function toFollowUpView(
  record: FollowUpRecord,
  now: Date,
  timeZone: string,
): FollowUpView & { timing: Timing } {
  const timing = computeTiming(record, now, timeZone);

  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    ballOwner: record.ballOwner,
    dueDate: dayKey(record.dueAt, timeZone),
    dueLabel: timing.dueLabel,
    level: timing.level,
    overdueDays: timing.overdueDays,
    ageLabel: ageLabel(timing.ageDays),
    needsAttention: timing.needsAttention,
    ballLabel: ballLabel(record.ballOwner, record.contact?.firstName),
    contactName: record.contact ? contactFullName(record.contact) : null,
    contactInitials: record.contact ? initials(record.contact) : null,
    contactArchived: record.contact?.archivedAt != null,
    organizationName: record.contact?.organizationName ?? null,
    nudgeCount: record.nudgeCount,
    nudgeLabel: nudgeLabel(record.nudgeCount),
    isDemo: record.isDemo,
    timing,
  };
}

function nudgeLabel(nudgeCount: number): string | null {
  if (nudgeCount <= 0) return null;
  return nudgeCount === 1 ? "Relancé 1 fois" : `Relancé ${nudgeCount} fois`;
}
