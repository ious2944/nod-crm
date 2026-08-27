import { dayKey } from "@/lib/date";
import { contactFullName } from "@/lib/follow-ups/view";
import { computeTaskTiming, type TaskBucket, type UrgencyLevel } from "./domain";

/** Données minimales attendues d'une ligne `tasks` (+ son contact et son suivi). */
export interface TaskRecord {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date;
  completedAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    archivedAt: Date | null;
  } | null;
  followUp: {
    id: string;
    title: string;
    contact: { firstName: string; lastName: string } | null;
  } | null;
}

/** Ce que reçoivent les composants React : sérialisable, sans logique restante. */
export interface TaskView {
  id: string;
  title: string;
  notes: string | null;
  /** `YYYY-MM-DD`, pré-rempli dans le formulaire de report. */
  dueDate: string;
  dueLabel: string;
  level: UrgencyLevel;
  bucket: TaskBucket;
  overdueDays: number;
  isActionable: boolean;
  completed: boolean;
  contactId: string | null;
  contactName: string | null;
  /** Le contact lié a été archivé : on le dit, on ne le fait pas disparaître. */
  contactArchived: boolean;
  followUpId: string | null;
  /** « Validation commerciale — Camille » : de quoi comprendre le lien sans le suivre. */
  followUpLabel: string | null;
  isDemo: boolean;
}

export function toTaskView(record: TaskRecord, now: Date, timeZone: string): TaskView {
  const timing = computeTaskTiming(record, now, timeZone);

  return {
    id: record.id,
    title: record.title,
    notes: record.notes,
    dueDate: dayKey(record.dueAt, timeZone),
    dueLabel: timing.dueLabel,
    level: timing.level,
    bucket: timing.bucket,
    overdueDays: timing.overdueDays,
    isActionable: timing.isActionable,
    completed: record.completedAt !== null,
    contactId: record.contact?.id ?? null,
    contactName: record.contact ? contactFullName(record.contact) : null,
    contactArchived: record.contact?.archivedAt != null,
    followUpId: record.followUp?.id ?? null,
    followUpLabel: record.followUp ? followUpLinkLabel(record.followUp) : null,
    isDemo: record.isDemo,
  };
}

/**
 * Étiquette du suivi lié. Le prénom suffit à situer l'interlocuteur — la ligne
 * de tâche doit rester lisible, pas devenir une seconde carte de suivi.
 */
export function followUpLinkLabel(followUp: {
  title: string;
  contact: { firstName: string } | null;
}): string {
  const first = followUp.contact?.firstName.trim();
  return first ? `${followUp.title} — ${first}` : followUp.title;
}
