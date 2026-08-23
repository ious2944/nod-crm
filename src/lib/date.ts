/**
 * Helpers de dates « à la journée », indépendants du fuseau du serveur.
 *
 * Tout le module Follow-up raisonne en jours calendaires : une échéance est
 * en retard de 3 jours, pas de 71 heures. On convertit donc les instants en
 * clés `YYYY-MM-DD` dans le fuseau de l'application avant de comparer.
 *
 * Fonctions pures : testées dans `src/lib/date.test.ts`.
 */

const MS_PER_DAY = 86_400_000;

/** Clé calendaire `YYYY-MM-DD` d'un instant, dans le fuseau donné. */
export function dayKey(date: Date, timeZone: string): string {
  // `en-CA` produit nativement le format ISO court.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Numéro de jour absolu, pour soustraire deux dates sans se soucier des heures. */
export function dayIndex(date: Date, timeZone: string): number {
  return Math.round(Date.parse(`${dayKey(date, timeZone)}T00:00:00Z`) / MS_PER_DAY);
}

/** Nombre de jours calendaires entre deux instants (`to - from`). */
export function daysBetween(from: Date, to: Date, timeZone: string): number {
  return dayIndex(to, timeZone) - dayIndex(from, timeZone);
}

/** Décalage du fuseau (en ms) à un instant donné — gère l'heure d'été. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );

  return asUtc - instant.getTime();
}

/**
 * Instant correspondant à minuit (heure locale du fuseau) pour une clé `YYYY-MM-DD`.
 * C'est ce qu'on stocke en base pour une échéance : une date, pas une heure.
 */
export function startOfDay(key: string, timeZone: string): Date {
  const naive = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(naive)) {
    throw new Error(`Date invalide : ${key}`);
  }
  // Deux passes : la première estime le décalage, la seconde le corrige
  // lorsqu'on tombe juste au changement d'heure.
  let instant = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  instant = naive - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Ajoute `days` jours calendaires à une clé `YYYY-MM-DD`. */
export function addDaysToKey(key: string, days: number): string {
  const shifted = new Date(Date.parse(`${key}T00:00:00Z`) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** Échéance décalée de `days` jours, en restant calée sur minuit local. */
export function shiftDueDate(from: Date, days: number, timeZone: string): Date {
  return startOfDay(addDaysToKey(dayKey(from, timeZone), days), timeZone);
}
