/**
 * Formats d'affichage en français — fonctions pures, client-safe.
 * Les dates arrivent en clés `YYYY-MM-DD` (fuseau de l'application).
 */

import { addDays, isoWeekday } from "./recurrence";

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WEEKDAYS_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const WEEKDAYS_LONG = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export { MONTHS_LONG, WEEKDAYS_SHORT, WEEKDAYS_LONG };

export function parts(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** « 13 oct. », avec l'année si elle diffère de l'année courante. */
export function shortDate(key: string, today?: string): string {
  const { y, m, d } = parts(key);
  const sameYear = today ? parts(today).y === y : true;
  return `${d} ${MONTHS_SHORT[m - 1]}${sameYear ? "" : ` ${y}`}`;
}

export function longDate(key: string): string {
  const { y, m, d } = parts(key);
  return `${WEEKDAYS_LONG[isoWeekday(key) - 1]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** Étiquette d'échéance à la Asana : Aujourd'hui, Demain, Hier, jeu., 13 oct. */
export function dueLabel(key: string, today: string, time?: string | null): string {
  const diff = dayDiff(today, key);
  let label: string;
  if (diff === 0) label = "Aujourd'hui";
  else if (diff === 1) label = "Demain";
  else if (diff === -1) label = "Hier";
  else if (diff > 1 && diff < 7) label = WEEKDAYS_SHORT[isoWeekday(key) - 1];
  else label = shortDate(key, today);
  return time ? `${label} ${time}` : label;
}

export type DueTone = "overdue" | "today" | "soon" | "normal" | "done";

export function dueTone(key: string | null, today: string, done: boolean): DueTone {
  if (!key) return "normal";
  if (done) return "done";
  const diff = dayDiff(today, key);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "soon";
  return "normal";
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: "text-critical-fg",
  today: "text-today-fg",
  soon: "text-soon-fg",
  normal: "text-muted",
  done: "text-muted",
};

export function rangeLabel(start: string | null, due: string | null, today: string, time?: string | null): string {
  if (start && due && start !== due) return `${shortDate(start, today)} – ${dueLabel(due, today, time)}`;
  if (due) return dueLabel(due, today, time);
  if (start) return `Dès le ${shortDate(start, today)}`;
  return "";
}

/** 95 → « 1 h 35 », 30 → « 30 min ». */
export function minutesLabel(minutes: number | null | undefined): string {
  if (!minutes) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** « 1h30 », « 90 », « 1,5h », « 45m » → minutes. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(",", ".");
  if (!text) return null;
  const hm = /^(\d+(?:\.\d+)?)\s*h\s*(\d{1,2})?\s*(?:m|min)?$/.exec(text);
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const m = /^(\d+)\s*(?:m|min)?$/.exec(text);
  if (m) return Number(m[1]);
  return null;
}

/** « il y a 5 min », « hier à 14:02 », « 3 oct. à 09:15 ». */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return "à l'instant";
  if (seconds < 3600) return `il y a ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 6 * 3600) return `il y a ${Math.round(seconds / 3600)} h`;
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `aujourd'hui à ${time}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `hier à ${time}`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ""} à ${time}`;
}

/** Lundi de la semaine d'une clé. */
export function startOfWeekKey(key: string): string {
  return addDays(key, 1 - isoWeekday(key));
}

export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = startOfWeekKey(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? (pluralForm ?? `${singular}s`) : singular}`;
}
