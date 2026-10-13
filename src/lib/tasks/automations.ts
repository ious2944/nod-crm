import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey, endOfDay, startOfDay } from "@/lib/date";
import { prisma } from "@/lib/prisma";

import {
  conditionsMatch,
  loopGuard,
  ruleInputSchema,
  triggerMatches,
  type AutomationTrigger,
  type RuleAction,
  type TaskEvent,
} from "./automation-model";
import { notify } from "./notify";
import {
  addComment,
  getTaskItem,
  moveTask,
  registerEventSink,
  setTaskTags,
  updateTaskFields,
  type MutationContext,
} from "./service";

/**
 * Moteur des règles d'automatisation.
 *
 * Garanties :
 * - **persistance et traçabilité** : chaque exécution laisse une ligne
 *   `automation_runs` (succès, ignorée, erreur + message), et chaque
 *   changement produit par une règle est inscrit dans l'historique de la tâche
 *   avec l'identifiant de la règle ;
 * - **pas d'exécution en double** : `(rule_id, event_key)` est unique en base.
 *   La ligne est réservée *avant* d'agir ; un second passage du même
 *   événement (requête rejouée, double clic) échoue sur la contrainte et
 *   s'arrête là ;
 * - **pas de boucle** : un événement produit par une règle porte la chaîne des
 *   règles déjà exécutées et sa profondeur. Une règle ne s'exécute jamais deux
 *   fois dans la même chaîne, et la profondeur est bornée
 *   (`MAX_AUTOMATION_DEPTH`).
 *
 * Les règles agissent avec les droits du projet auquel elles appartiennent :
 * une règle de projet ne touche que les tâches de ce projet ; une règle
 * d'espace (sans projet) que les tâches de l'espace.
 */

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

interface RuleRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  trigger: string;
  triggerConfig: Prisma.JsonValue;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  createdById: string | null;
}

function parseRule(row: RuleRow) {
  const parsed = ruleInputSchema.safeParse({
    name: row.name,
    trigger: row.trigger,
    triggerConfig: row.triggerConfig ?? {},
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    isEnabled: true,
  });
  return parsed.success ? parsed.data : null;
}

async function reserveRun(ruleId: string, workspaceId: string, taskId: string, eventKey: string) {
  try {
    const run = await prisma.automationRun.create({
      data: { ruleId, workspaceId, taskId, eventKey, status: "RUNNING" },
      select: { id: true },
    });
    return run.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

async function finishRun(runId: string, ruleId: string, status: "SUCCESS" | "SKIPPED" | "ERROR", message?: string) {
  await prisma.automationRun.update({ where: { id: runId }, data: { status, message: message?.slice(0, 500) ?? null } });
  if (status === "SUCCESS") {
    await prisma.automationRule.update({
      where: { id: ruleId },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });
  }
}

async function executeAction(ruleCtx: MutationContext, rule: RuleRow, action: RuleAction, taskId: string, projectId: string | null) {
  const workspaceId = rule.workspaceId;
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    select: { id: true, title: true, assigneeId: true, parentId: true, dueAt: true, followers: { select: { userId: true } } },
  });
  if (!task) return;

  switch (action.kind) {
    case "set_status":
      await updateTaskFields(ruleCtx, taskId, { status: action.status });
      return;
    case "set_priority":
      await updateTaskFields(ruleCtx, taskId, { priority: action.priority });
      return;
    case "set_assignee":
      await updateTaskFields(ruleCtx, taskId, { assigneeId: action.userId });
      return;
    case "set_due_in_days": {
      const due = addDaysToKey(dayKey(new Date(), APP_TIME_ZONE), action.days);
      await updateTaskFields(ruleCtx, taskId, { dueDate: due });
      return;
    }
    case "move_to_section": {
      const section = await prisma.projectSection.findFirst({
        where: { id: action.sectionId, workspaceId },
        select: { projectId: true },
      });
      if (!section) throw new Error("Section cible introuvable.");
      if (rule.projectId && section.projectId !== rule.projectId) throw new Error("Section hors du projet de la règle.");
      await moveTask(ruleCtx, { taskId, projectId: section.projectId, sectionId: action.sectionId });
      return;
    }
    case "add_tag": {
      const item = await getTaskItem(ruleCtx, taskId);
      if (!item.tagIds.includes(action.tagId)) await setTaskTags(ruleCtx, taskId, [...item.tagIds, action.tagId]);
      return;
    }
    case "add_comment":
      await addComment(ruleCtx, taskId, `🤖 ${action.body}`);
      return;
    case "notify": {
      let recipients: (string | null)[] = [];
      if (action.target === "assignee") recipients = [task.assigneeId];
      if (action.target === "followers") recipients = task.followers.map((f) => f.userId);
      if (action.target === "user") recipients = [action.userId ?? null];
      if (action.target === "project_owner" && (projectId ?? rule.projectId)) {
        const project = await prisma.project.findUnique({ where: { id: (projectId ?? rule.projectId)! }, select: { ownerId: true } });
        recipients = [project?.ownerId ?? null];
      }
      await notify({
        workspaceId,
        recipients,
        actorId: null,
        includeActor: true,
        type: "AUTOMATION",
        title: action.message?.trim() || `${rule.name} : ${task.title}`,
        body: `Règle « ${rule.name} »`,
        taskId,
      });
      return;
    }
    case "create_reminder": {
      const due = task.dueAt ? dayKey(task.dueAt, APP_TIME_ZONE) : null;
      await notify({
        workspaceId,
        recipients: [task.assigneeId],
        actorId: null,
        includeActor: true,
        type: "DUE_SOON",
        title: action.message?.trim() || `Rappel : ${task.title}${due ? ` — échéance le ${due.split("-").reverse().join("/")}` : ""}`,
        body: `Règle « ${rule.name} »`,
        taskId,
        dedupeKey: `rule:${rule.id}:reminder:${taskId}:${due ?? "none"}`,
      });
      return;
    }
    case "suggest_complete_parent": {
      // Sur l'événement « toutes les sous-tâches terminées », `taskId` est la
      // parente ; sur un autre événement, on remonte à la parente.
      const targetId = task.parentId ?? taskId;
      const target = await prisma.task.findUnique({ where: { id: targetId }, select: { id: true, title: true, assigneeId: true, status: true } });
      if (!target || target.status === "DONE") return;
      const open = await prisma.task.count({ where: { parentId: target.id, status: { not: "DONE" } } });
      if (open > 0) return;
      await notify({
        workspaceId,
        recipients: [target.assigneeId],
        actorId: null,
        includeActor: true,
        type: "AUTOMATION",
        title: `Toutes les sous-tâches de « ${target.title} » sont terminées. Terminer la tâche ?`,
        body: `Règle « ${rule.name} »`,
        taskId: target.id,
        actionKind: "COMPLETE_TASK",
        dedupeKey: `rule:${rule.id}:suggest:${target.id}`,
      });
      return;
    }
  }
}

async function runRule(rule: RuleRow, event: TaskEvent, eventKey: string) {
  const definition = parseRule(rule);
  if (!definition) return;
  if (!triggerMatches({ trigger: definition.trigger, triggerConfig: definition.triggerConfig }, event)) return;

  // Une règle de projet ne s'applique qu'aux tâches de ce projet.
  if (rule.projectId) {
    const inProject = await prisma.taskProject.findFirst({
      where: { taskId: event.taskId, projectId: rule.projectId },
      select: { taskId: true },
    });
    const parentInProject =
      !inProject &&
      (await prisma.task.findFirst({
        where: { id: event.taskId, parent: { projects: { some: { projectId: rule.projectId } } } },
        select: { id: true },
      }));
    if (!inProject && !parentInProject) return;
  }

  const runId = await reserveRun(rule.id, rule.workspaceId, event.taskId, eventKey);
  if (!runId) return; // déjà exécutée pour cet événement

  const guard = loopGuard(rule.id, event);
  if (guard) {
    await finishRun(runId, rule.id, "SKIPPED", guard);
    return;
  }

  const ruleCtx: MutationContext = {
    actor: { id: rule.createdById ?? SYSTEM_ACTOR_ID, workspaceId: rule.workspaceId },
    automation: { ruleId: rule.id, depth: event.depth, chain: event.chain },
  };

  try {
    const snapshot = await getTaskItem(ruleCtx, event.taskId);
    if (!conditionsMatch(definition.conditions, snapshot, rule.projectId ?? event.projectId ?? null)) {
      await finishRun(runId, rule.id, "SKIPPED", "Conditions non remplies.");
      return;
    }
    for (const action of definition.actions) {
      await executeAction(ruleCtx, rule, action, event.taskId, event.projectId ?? null);
    }
    await finishRun(runId, rule.id, "SUCCESS");
  } catch (error) {
    await finishRun(runId, rule.id, "ERROR", error instanceof Error ? error.message : "Erreur inconnue.");
  }
}

/** Point d'entrée : exécute les règles concernées par une série d'événements. */
export async function processEvents(ctx: MutationContext, events: TaskEvent[]): Promise<void> {
  const workspaceId = ctx.actor.workspaceId;
  const triggers = [...new Set(events.map((e) => e.type))] as AutomationTrigger[];
  const rules = await prisma.automationRule.findMany({
    where: { workspaceId, isEnabled: true, trigger: { in: triggers } },
    orderBy: { createdAt: "asc" },
  });
  if (rules.length === 0) return;

  for (const event of events) {
    for (const rule of rules) {
      if (rule.trigger !== event.type) continue;
      if (rule.projectId && event.projectId && rule.projectId !== event.projectId) continue;
      // Les événements d'un même changement partagent leur identifiant (un par
      // projet de la tâche) : une règle d'espace ne s'exécute qu'une fois.
      const key = rule.projectId ? `${event.id}:${event.projectId ?? "none"}` : `${event.id}:${event.taskId}`;
      await runRule(rule, event, key);
    }
  }
}

registerEventSink(processEvents);

// ─── Balayage des échéances ───────────────────────────────────────────────────

const lastSweep = new Map<string, number>();
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Rappels d'échéance : (1) la notification intégrée « veille de l'échéance »
 * au responsable, (2) les règles `DUE_DATE_APPROACHING`.
 *
 * Il n'existe pas d'ordonnanceur dans NOD CRM : le balayage est déclenché
 * paresseusement par l'activité de l'espace (chargement du contexte), au plus
 * toutes les 5 minutes par processus. L'idempotence ne dépend pas de ce
 * minuteur : les clés `dedupeKey` / `event_key` incluent la tâche et la date
 * d'échéance, un rappel n'est donc jamais envoyé deux fois, même après un
 * redémarrage ou avec plusieurs instances.
 */
export async function sweepDueDates(workspaceId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastSweep.get(workspaceId) ?? 0) < SWEEP_INTERVAL_MS) return;
  lastSweep.set(workspaceId, now);

  const today = dayKey(new Date(), APP_TIME_ZONE);
  const tomorrow = addDaysToKey(today, 1);

  const dueTomorrow = await prisma.task.findMany({
    where: {
      workspaceId,
      status: { not: "DONE" },
      assigneeId: { not: null },
      dueAt: { gte: startOfDay(today, APP_TIME_ZONE), lte: endOfDay(tomorrow, APP_TIME_ZONE) },
      NOT: { projects: { some: { project: { isTemplate: true } } } },
    },
    select: { id: true, title: true, assigneeId: true, dueAt: true },
    take: 500,
  });
  for (const task of dueTomorrow) {
    const due = dayKey(task.dueAt!, APP_TIME_ZONE);
    await notify({
      workspaceId,
      recipients: [task.assigneeId],
      actorId: null,
      includeActor: true,
      type: "DUE_SOON",
      title: due === today ? `Échéance aujourd'hui : ${task.title}` : `Échéance demain : ${task.title}`,
      taskId: task.id,
      dedupeKey: `due:${task.id}:${due}`,
    });
  }

  const rules = await prisma.automationRule.findMany({
    where: { workspaceId, isEnabled: true, trigger: "DUE_DATE_APPROACHING" },
  });
  for (const rule of rules) {
    const definition = parseRule(rule);
    if (!definition) continue;
    const days = definition.triggerConfig.days ?? 1;
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: "DONE" },
        dueAt: { gte: startOfDay(today, APP_TIME_ZONE), lte: endOfDay(addDaysToKey(today, days), APP_TIME_ZONE) },
        ...(rule.projectId
          ? {
              OR: [
                { projects: { some: { projectId: rule.projectId } } },
                { parent: { projects: { some: { projectId: rule.projectId } } } },
              ],
            }
          : { NOT: { projects: { some: { project: { isTemplate: true } } } } }),
      },
      select: { id: true, dueAt: true },
      take: 500,
    });
    for (const task of tasks) {
      const due = dayKey(task.dueAt!, APP_TIME_ZONE);
      const event: TaskEvent = {
        id: `due:${task.id}:${due}`,
        type: "DUE_DATE_APPROACHING",
        taskId: task.id,
        projectId: rule.projectId,
        depth: 0,
        chain: [],
      };
      await runRule(rule, event, event.id);
    }
  }
}
