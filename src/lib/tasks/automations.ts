import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
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
import {
  canAutomateTask,
  canEditProjectContent,
  canReadProject,
  evaluateTaskAccess,
  projectAccessSelect,
  taskAccessSelect,
  type Actor,
} from "./access";
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
 * Droits : une règle agit avec les droits **actuels** de la personne qui l'a
 * enregistrée en dernier (création ou modification, `created_by_id`), jamais
 * avec plus :
 *   - elle ne s'exécute que sur les tâches que cette personne peut modifier ;
 *     chaque action est ensuite contrôlée comme une action manuelle de cette
 *     personne (réaffecter demande de pouvoir gérer la tâche, etc.) ;
 *   - une règle de projet ne touche que les tâches de ce projet, et seulement
 *     tant que cette personne peut modifier le contenu du projet ;
 *   - si cette personne est désactivée ou supprimée, la règle ne fait rien.
 * Une tâche que la personne ne peut pas modifier est ignorée sans laisser de
 * trace d'exécution (le journal des règles ne cite donc que des tâches qu'elle
 * pouvait modifier ; il est en plus filtré à la lecture).
 */

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
    where: { id: taskId, workspaceId, deletedAt: null },
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
    case "add_tag":
      // Ajout seul (différence appliquée à l'état courant, sous verrou) : ne
      // retire jamais un tag posé entre-temps.
      await setTaskTags(ruleCtx, taskId, [action.tagId], { base: [] });
      return;
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
      const target = await prisma.task.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, title: true, assigneeId: true, status: true } });
      if (!target || target.status === "DONE") return;
      const open = await prisma.task.count({ where: { parentId: target.id, status: { not: "DONE" }, deletedAt: null } });
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

/**
 * La personne au nom de qui la règle s'exécute, si elle peut encore agir :
 * active, dans l'espace, et (règle de projet) capable de modifier le projet.
 */
async function ruleActor(rule: RuleRow): Promise<Actor | null> {
  if (!rule.createdById) return null;
  const user = await prisma.user.findFirst({
    where: { id: rule.createdById, workspaceId: rule.workspaceId, isActive: true },
    select: { id: true },
  });
  if (!user) return null;
  const actor = { id: user.id, workspaceId: rule.workspaceId };
  if (rule.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: rule.projectId, workspaceId: rule.workspaceId },
      select: projectAccessSelect(actor),
    });
    if (!project || !canReadProject(project, actor) || !canEditProjectContent(project, actor)) return null;
  }
  return actor;
}

async function runRule(rule: RuleRow, event: TaskEvent, eventKey: string) {
  const definition = parseRule(rule);
  if (!definition) return;
  if (!triggerMatches({ trigger: definition.trigger, triggerConfig: definition.triggerConfig }, event)) return;

  const actor = await ruleActor(rule);
  if (!actor) return;
  // Seulement sur une tâche que cette personne peut modifier, dans son
  // périmètre d'automatisation (`canAutomateTask`) : ses données, ou un projet
  // où elle a l'Édition. Une personne qui déclenche la règle n'agit donc
  // jamais, par son intermédiaire, au-delà de ce que l'auteur pourrait faire.
  const access = await prisma.task.findFirst({
    where: { id: event.taskId, workspaceId: rule.workspaceId, deletedAt: null },
    select: taskAccessSelect(actor),
  });
  if (!access || !evaluateTaskAccess(access, actor).canEdit || !canAutomateTask(access, actor)) return;

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
    actor,
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
    // Les règles d'un projet de la corbeille ne s'exécutent plus.
    where: { workspaceId, isEnabled: true, trigger: { in: triggers }, OR: [{ projectId: null }, { project: { deletedAt: null } }] },
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

// Les rappels d'échéance (intégrés et règles `DUE_DATE_APPROACHING`) sont
// traités par la tâche planifiée `task-reminders.ts`, pas par l'activité.

/** Exécute une règle pour un événement produit hors requête (tâche planifiée). */
export async function runScheduledRule(ruleId: string, event: TaskEvent, eventKey: string): Promise<"done" | "missing"> {
  const rule = await prisma.automationRule.findFirst({
    where: { id: ruleId, isEnabled: true, OR: [{ projectId: null }, { project: { deletedAt: null } }] },
  });
  if (!rule) return "missing";
  await runRule(rule, event, eventKey);
  return "done";
}

export { parseRule };
