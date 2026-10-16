import "server-only";

import { runTaskReminders } from "./task-reminders";

/**
 * Ordonnanceur intégré au processus Next (`instrumentation.ts`).
 *
 * NOD CRM est auto-hébergé en un conteneur `next start` : un minuteur dans le
 * processus serveur suffit et ne demande aucun service en plus. Il ne dépend
 * d'aucune requête ni d'aucune session. Avec plusieurs instances, chacune a
 * son minuteur ; le bail `job_leases` garantit qu'une seule exécution a lieu à
 * la fois.
 *
 * Réglages (variables d'environnement) :
 * - `NOD_SCHEDULER=off` : désactive le minuteur (par ex. pour une instance
 *   dédiée aux requêtes) ;
 * - `TASK_REMINDER_INTERVAL_MINUTES` : période, 5 minutes par défaut (1–60).
 */

const DEFAULT_INTERVAL_MINUTES = 5;
const FIRST_RUN_DELAY_MS = 20_000;

declare global {
  var __nodSchedulerStarted: boolean | undefined;
}

export function schedulerIntervalMs(raw = process.env.TASK_REMINDER_INTERVAL_MINUTES): number {
  const minutes = Number(raw);
  const valid = Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? minutes : DEFAULT_INTERVAL_MINUTES;
  return Math.round(valid * 60_000);
}

export function schedulerEnabled(raw = process.env.NOD_SCHEDULER): boolean {
  return !["off", "false", "0", "no"].includes((raw ?? "").trim().toLowerCase());
}

async function tick() {
  try {
    const report = await runTaskReminders();
    if (!report.skipped && (report.sent || report.failed || report.skippedStale)) {
      console.info("[scheduler] rappels d'échéance", report);
    }
  } catch (error) {
    console.error("[scheduler] rappels d'échéance en échec", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : undefined,
    });
  }
}

export function startScheduler(): void {
  if (!schedulerEnabled() || globalThis.__nodSchedulerStarted) return;
  globalThis.__nodSchedulerStarted = true;
  const interval = schedulerIntervalMs();
  const first = setTimeout(() => void tick(), FIRST_RUN_DELAY_MS);
  const timer = setInterval(() => void tick(), interval);
  // Le minuteur ne doit pas empêcher l'arrêt du processus.
  first.unref?.();
  timer.unref?.();
  console.info(`[scheduler] rappels d'échéance toutes les ${interval / 60_000} min`);
}
