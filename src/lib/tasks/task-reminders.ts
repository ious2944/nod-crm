import "server-only";

import { randomUUID } from "node:crypto";

import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey, endOfDay, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";

import type { TaskEvent } from "./automation-model";
import { parseRule, runScheduledRule } from "./automations";
import { acquireLease, releaseLease, renewLease } from "./jobs";
import { notify } from "./notify";

/**
 * Rappels d'échéance — traitement **planifié**, indépendant de l'activité des
 * utilisateurs (aucune session n'est nécessaire).
 *
 * Deux sortes de rappels, une seule déduplication :
 * - `builtin` : la notification intégrée au responsable, une fois par tâche et
 *   par échéance (la veille, ou le jour même si la veille a été manquée) ;
 * - `rule` : les règles `DUE_DATE_APPROACHING` (« N jours avant »).
 *
 * Chaque rappel dû reçoit d'abord une ligne `task_reminders` dont la clé
 * (`reminder_key`, unique) identifie *tâche + échéance + type* :
 *
 *   builtin:<tâche>:<AAAA-MM-JJ>        rule:<règle>:<tâche>:<AAAA-MM-JJ>
 *
 * La même clé sert ensuite de `dedupe_key` à la notification et d'`event_key`
 * à l'exécution de règle (`automation_runs`). Un rappel n'est donc jamais
 * envoyé deux fois, quel que soit le nombre d'exécutions, d'instances ou de
 * reprises.
 *
 * Exécutions simultanées : un bail (`job_leases`) n'en laisse passer qu'une.
 * Reprise : les lignes restées `PENDING` (processus interrompu) sont reprises
 * à l'exécution suivante ; une erreur est retentée jusqu'à `MAX_ATTEMPTS`.
 *
 * Politique des rappels anciens : on ne rattrape pas le passé. Une tâche dont
 * l'échéance est dépassée ne déclenche aucun rappel ; une ligne en attente
 * dont l'échéance est passée, dont la tâche a changé d'échéance, a été
 * terminée, mise à la corbeille ou désaffectée est classée `SKIPPED` avec la
 * raison.
 *
 * Fuseau : les jours sont ceux d'`APP_TIME_ZONE` (le même fuseau que les
 * échéances), jamais celui du serveur.
 */

export const REMINDER_JOB = "task-reminders";
const DEFAULT_LEASE_SECONDS = 600;

/**
 * Durée du bail (`TASK_REMINDER_LEASE_SECONDS`, 30–3600 s, 600 par défaut) :
 * c'est le délai maximal avant qu'une autre instance reprenne le travail d'un
 * processus arrêté brutalement en cours d'exécution.
 */
export function leaseTtlMs(raw = process.env.TASK_REMINDER_LEASE_SECONDS): number {
  const seconds = Number(raw);
  return (Number.isFinite(seconds) && seconds >= 30 && seconds <= 3600 ? seconds : DEFAULT_LEASE_SECONDS) * 1000;
}
const MAX_ATTEMPTS = 5;
const BATCH = 500;

export interface ReminderRunReport {
  skipped?: "locked";
  /** Le bail a expiré pendant le traitement (processus suspendu) : arrêt immédiat. */
  lostLease?: boolean;
  planned: number;
  sent: number;
  skippedStale: number;
  failed: number;
  pendingLeft: number;
}

const builtinKey = (taskId: string, due: string) => `builtin:${taskId}:${due}`;
const ruleKey = (ruleId: string, taskId: string, due: string) => `rule:${ruleId}:${taskId}:${due}`;

const OPEN_TASK = {
  status: { not: "DONE" as const },
  deletedAt: null,
  NOT: { projects: { some: { project: { isTemplate: true } } } },
};

/** Étape 1 : réserve les rappels dus aujourd'hui (idempotent). */
async function planReminders(today: string): Promise<number> {
  const tomorrow = addDaysToKey(today, 1);
  let planned = 0;

  const builtin = await prisma.task.findMany({
    where: {
      ...OPEN_TASK,
      assigneeId: { not: null },
      dueAt: { gte: startOfDay(today, APP_TIME_ZONE), lte: endOfDay(tomorrow, APP_TIME_ZONE) },
    },
    select: { id: true, workspaceId: true, dueAt: true },
  });
  if (builtin.length) {
    const { count } = await prisma.taskReminder.createMany({
      data: builtin.map((t) => {
        const due = dayKey(t.dueAt!, APP_TIME_ZONE);
        return { workspaceId: t.workspaceId, taskId: t.id, kind: "builtin", dueKey: due, reminderKey: builtinKey(t.id, due) };
      }),
      skipDuplicates: true,
    });
    planned += count;
  }

  const rules = await prisma.automationRule.findMany({
    where: { isEnabled: true, trigger: "DUE_DATE_APPROACHING", OR: [{ projectId: null }, { project: { deletedAt: null } }] },
  });
  for (const rule of rules) {
    const definition = parseRule(rule);
    if (!definition) continue;
    const days = definition.triggerConfig.days ?? 1;
    const tasks = await prisma.task.findMany({
      where: {
        ...OPEN_TASK,
        workspaceId: rule.workspaceId,
        dueAt: { gte: startOfDay(today, APP_TIME_ZONE), lte: endOfDay(addDaysToKey(today, days), APP_TIME_ZONE) },
        ...(rule.projectId
          ? {
              OR: [
                { projects: { some: { projectId: rule.projectId } } },
                { parent: { projects: { some: { projectId: rule.projectId } } } },
              ],
            }
          : {}),
      },
      select: { id: true, dueAt: true },
    });
    if (!tasks.length) continue;
    const { count } = await prisma.taskReminder.createMany({
      data: tasks.map((t) => {
        const due = dayKey(t.dueAt!, APP_TIME_ZONE);
        return { workspaceId: rule.workspaceId, taskId: t.id, kind: `rule:${rule.id}`, dueKey: due, reminderKey: ruleKey(rule.id, t.id, due) };
      }),
      skipDuplicates: true,
    });
    planned += count;
  }
  return planned;
}

type Outcome = { status: "SENT" } | { status: "SKIPPED"; reason: string };

/** Étape 2 : envoie un rappel réservé, après revalidation. */
async function deliver(
  reminder: { id: string; workspaceId: string; taskId: string; kind: string; dueKey: string; reminderKey: string },
  today: string,
): Promise<Outcome> {
  if (reminder.dueKey < today) return { status: "SKIPPED", reason: "Échéance dépassée : rappel trop ancien." };
  const task = await prisma.task.findFirst({
    where: { id: reminder.taskId, workspaceId: reminder.workspaceId },
    select: { id: true, title: true, status: true, assigneeId: true, dueAt: true, deletedAt: true },
  });
  if (!task || task.deletedAt) return { status: "SKIPPED", reason: "Tâche supprimée." };
  if (task.status === "DONE") return { status: "SKIPPED", reason: "Tâche terminée." };
  if (!task.dueAt || dayKey(task.dueAt, APP_TIME_ZONE) !== reminder.dueKey) {
    return { status: "SKIPPED", reason: "Échéance modifiée depuis la planification." };
  }

  if (reminder.kind === "builtin") {
    if (!task.assigneeId) return { status: "SKIPPED", reason: "Tâche désaffectée." };
    await notify({
      workspaceId: reminder.workspaceId,
      recipients: [task.assigneeId],
      actorId: null,
      includeActor: true,
      type: "DUE_SOON",
      title: reminder.dueKey === today ? `Échéance aujourd'hui : ${task.title}` : `Échéance demain : ${task.title}`,
      taskId: task.id,
      dedupeKey: reminder.reminderKey,
    });
    return { status: "SENT" };
  }

  const ruleId = reminder.kind.slice("rule:".length);
  // Exécution de règle interrompue (processus arrêté entre la réservation de
  // `automation_runs` et sa fin) : elle n'est pas rejouée — les actions d'une
  // règle ne sont pas toutes idempotentes — mais elle est rendue visible.
  const interrupted = await prisma.automationRun.findFirst({
    where: { ruleId, eventKey: reminder.reminderKey },
    select: { id: true, status: true, createdAt: true },
  });
  if (interrupted) {
    if (interrupted.status === "RUNNING" && interrupted.createdAt.getTime() < Date.now() - leaseTtlMs()) {
      await prisma.automationRun.update({
        where: { id: interrupted.id },
        data: { status: "ERROR", message: "Exécution interrompue par l'arrêt du processus ; non rejouée." },
      });
      return { status: "SKIPPED", reason: "Exécution de règle interrompue ; non rejouée (voir automation_runs)." };
    }
    if (interrupted.status !== "RUNNING") return { status: "SENT" }; // déjà exécutée
  }
  const event: TaskEvent = {
    id: reminder.reminderKey,
    type: "DUE_DATE_APPROACHING",
    taskId: task.id,
    projectId: null,
    depth: 0,
    chain: [],
  };
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId }, select: { projectId: true } });
  event.projectId = rule?.projectId ?? null;
  const result = await runScheduledRule(ruleId, event, reminder.reminderKey);
  return result === "missing" ? { status: "SKIPPED", reason: "Règle supprimée, désactivée ou projet dans la corbeille." } : { status: "SENT" };
}

export interface ReminderRunOptions {
  now?: Date;
  holder?: string;
  leaseTtlMs?: number;
  /**
   * Points d'observation pour les tests de reprise (arrêt brutal entre la
   * notification et la validation, processus suspendu). Jamais utilisés par
   * l'application.
   */
  hooks?: {
    beforeDeliver?: (index: number) => Promise<void> | void;
    afterDeliver?: (index: number) => Promise<void> | void;
  };
}

/**
 * Une exécution complète. Sûre à appeler n'importe quand, autant de fois que
 * l'on veut, depuis n'importe quelle instance.
 *
 * Garde-fou contre un ancien détenteur : avant **chaque** envoi, le bail est
 * prolongé ; s'il a été perdu (processus suspendu plus longtemps que le bail,
 * repris entre-temps par une autre instance), le traitement s'arrête aussitôt.
 * La validation d'une ligne n'a lieu que si elle est encore `PENDING`. Dans
 * l'intervalle de quelques millisecondes qui subsiste, la clé de
 * déduplication de la notification et l'unicité de `automation_runs`
 * empêchent tout doublon.
 */
export async function runTaskReminders(options: ReminderRunOptions = {}): Promise<ReminderRunReport> {
  const holder = options.holder ?? `${process.pid}:${randomUUID()}`;
  const ttl = options.leaseTtlMs ?? leaseTtlMs();
  const report: ReminderRunReport = { planned: 0, sent: 0, skippedStale: 0, failed: 0, pendingLeft: 0 };
  if (!(await acquireLease(REMINDER_JOB, holder, ttl))) return { ...report, skipped: "locked" };

  try {
    const today = dayKey(options.now ?? new Date(), APP_TIME_ZONE);
    report.planned = await planReminders(today);

    // Reprise incluse : toutes les lignes en attente, les plus anciennes d'abord.
    const pending = await prisma.taskReminder.findMany({
      where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    for (const [index, reminder] of pending.entries()) {
      await options.hooks?.beforeDeliver?.(index);
      if (!(await renewLease(REMINDER_JOB, holder, ttl))) {
        report.lostLease = true;
        break;
      }
      try {
        const outcome = await deliver(reminder, today);
        await options.hooks?.afterDeliver?.(index);
        const { count } = await prisma.taskReminder.updateMany({
          where: { id: reminder.id, status: "PENDING" },
          data: {
            status: outcome.status,
            processedAt: new Date(),
            attempts: { increment: 1 },
            lastError: outcome.status === "SKIPPED" ? outcome.reason : null,
          },
        });
        if (count === 0) continue; // validée entre-temps par une autre exécution
        if (outcome.status === "SENT") report.sent += 1;
        else report.skippedStale += 1;
      } catch (error) {
        const attempts = reminder.attempts + 1;
        await prisma.taskReminder.updateMany({
          where: { id: reminder.id, status: "PENDING" },
          data: {
            attempts,
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            lastError: (error instanceof Error ? error.message : "Erreur inconnue.").slice(0, 500),
          },
        });
        report.failed += 1;
      }
    }
    report.pendingLeft = await prisma.taskReminder.count({ where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } } });
    const summary = `planifiés ${report.planned}, envoyés ${report.sent}, ignorés ${report.skippedStale}, en erreur ${report.failed}, en attente ${report.pendingLeft}`;
    // Bail perdu : rien à libérer (il appartient à une autre instance).
    if (!report.lostLease) await releaseLease(REMINDER_JOB, holder, "SUCCESS", summary);
    return report;
  } catch (error) {
    await releaseLease(REMINDER_JOB, holder, "ERROR", error instanceof Error ? error.message : "Erreur inconnue.").catch(() => {});
    throw error;
  }
}
