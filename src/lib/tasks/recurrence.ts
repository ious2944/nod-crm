/**
 * Récurrence des tâches — fonctions pures, testées dans `recurrence.test.ts`.
 *
 * Tout le calcul se fait sur des clés calendaires `YYYY-MM-DD` : on ajoute des
 * jours, des semaines ou des mois au **calendrier**, jamais des millisecondes.
 * La conversion en instant (minuit local dans `APP_TIME_ZONE`) n'a lieu qu'à
 * l'écriture, via `startOfDay`. Une tâche quotidienne reste donc due chaque
 * jour à la même heure locale, y compris aux changements d'heure.
 */

import { z } from "zod";

import type { RecurrenceRule } from "./types";

export const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).max(365),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).nullable().optional(),
  })
  .transform((rule) => ({
    ...rule,
    weekdays: rule.weekdays ? [...new Set(rule.weekdays)].sort((a, b) => a - b) : undefined,
  }));

function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function toKey(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(key: string, days: number): string {
  const { y, m, d } = parseKey(key);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Ajoute des mois en bornant au dernier jour du mois (31 janv. + 1 mois → 28/29 févr.). */
export function addMonths(key: string, months: number, targetDay?: number | null): string {
  const { y, m, d } = parseKey(key);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(targetDay ?? d, daysInMonth(ny, nm));
  return toKey(ny, nm, day);
}

/** Jour ISO de la semaine : 1 = lundi … 7 = dimanche. */
export function isoWeekday(key: string): number {
  const { y, m, d } = parseKey(key);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Prochaine occurrence strictement après `fromKey`.
 *
 * - DAILY : +interval jours ;
 * - WEEKLY sans jours : +interval semaines ; avec jours : prochain jour coché
 *   de la semaine courante, sinon premier jour coché `interval` semaines plus
 *   loin ;
 * - MONTHLY : +interval mois, au `monthDay` (ou au jour d'origine), borné ;
 * - YEARLY : +interval années (29 févr. → 28 févr. les années non bissextiles).
 */
export function nextOccurrence(rule: RecurrenceRule, fromKey: string): string {
  const interval = Math.max(1, Math.floor(rule.interval || 1));

  switch (rule.freq) {
    case "DAILY":
      return addDays(fromKey, interval);
    case "WEEKLY": {
      const days = (rule.weekdays ?? []).filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
      if (days.length === 0) return addDays(fromKey, 7 * interval);
      const current = isoWeekday(fromKey);
      const laterThisWeek = days.find((d) => d > current);
      if (laterThisWeek !== undefined) return addDays(fromKey, laterThisWeek - current);
      // Lundi de la semaine courante, puis `interval` semaines plus loin.
      const monday = addDays(fromKey, 1 - current);
      return addDays(monday, 7 * interval + (days[0] - 1));
    }
    case "MONTHLY":
      return addMonths(fromKey, interval, rule.monthDay ?? null);
    case "YEARLY":
      return addMonths(fromKey, 12 * interval);
  }
}

const WEEKDAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Libellé lisible : « Toutes les 2 semaines (lun., jeu.) ». */
export function describeRecurrence(rule: RecurrenceRule | null): string {
  if (!rule) return "Ne se répète pas";
  const n = rule.interval;
  switch (rule.freq) {
    case "DAILY":
      return n === 1 ? "Tous les jours" : `Tous les ${n} jours`;
    case "WEEKLY": {
      const base = n === 1 ? "Toutes les semaines" : `Toutes les ${n} semaines`;
      const days = (rule.weekdays ?? []).map((d) => WEEKDAY_SHORT[d - 1]).filter(Boolean);
      return days.length ? `${base} (${days.join(", ")})` : base;
    }
    case "MONTHLY": {
      const base = n === 1 ? "Tous les mois" : `Tous les ${n} mois`;
      return rule.monthDay ? `${base}, le ${rule.monthDay}` : base;
    }
    case "YEARLY":
      return n === 1 ? "Tous les ans" : `Tous les ${n} ans`;
  }
}
