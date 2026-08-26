import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction } from "@/app/(app)/follow-ups/actions";
import { applyTaskAction, createTask, findFollowUps } from "@/app/(app)/tasks/actions";
import { APP_TIME_ZONE } from "@/lib/config";
import { addDaysToKey, dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { initialCreateTaskState } from "@/lib/tasks/create-state";
import { getTaskList } from "@/lib/tasks/queries";
import { getTodayFeed } from "@/lib/today/queries";

import {
  createContactRecord,
  createFollowUpRecord,
  createTaskRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Module Tâches, contre une vraie base.
 *
 * Trois propriétés y sont vérifiées de bout en bout : ce qu'une tâche est (deux
 * états, une échéance), où elle apparaît (liste et cockpit), et surtout ce
 * qu'elle **ne fait pas** — jamais synchroniser l'état d'un suivi, jamais
 * franchir la frontière d'un workspace.
 */

const today = () => dayKey(new Date(), APP_TIME_ZONE);
const inDays = (days: number) => addDaysToKey(today(), days);

describe("module Tâches", () => {
  let alice: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("tasks-ws");
    await signIn(alice);
  });

  describe("création", () => {
    it("crée une tâche indépendante avec un titre et une échéance", async () => {
      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Préparer la présentation", dueDate: today() }),
      );

      expect(result.status).toBe("success");

      const task = await prisma.task.findFirstOrThrow({
        where: { workspaceId: alice.workspaceId },
      });
      expect(task.title).toBe("Préparer la présentation");
      expect(task.contactId).toBeNull();
      expect(task.followUpId).toBeNull();
      expect(task.completedAt).toBeNull();
      expect(task.notes).toBeNull();
    });

    it("refuse une tâche sans titre", async () => {
      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "   ", dueDate: today() }),
      );

      expect(result.status).toBe("error");
      expect(result.fieldErrors?.title).toMatch(/obligatoire/i);
      expect(await prisma.task.count()).toBe(0);
    });

    it("refuse une échéance qui n'existe pas", async () => {
      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Tâche", dueDate: "2026-02-31" }),
      );

      expect(result.status).toBe("error");
      expect(result.fieldErrors?.dueDate).toMatch(/invalide/i);
      expect(await prisma.task.count()).toBe(0);
    });

    it("attache un contact du workspace sans en faire un suivi", async () => {
      const contactId = await createContactRecord(alice.workspaceId, {
        firstName: "Sophie",
        lastName: "Martin",
      });

      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Préparer le contrat", dueDate: inDays(1), contactId }),
      );

      expect(result.status).toBe("success");

      const task = await prisma.task.findFirstOrThrow({ where: { title: "Préparer le contrat" } });
      expect(task.contactId).toBe(contactId);
      // Aucun suivi n'est né de cette tâche : ce sont deux objets distincts.
      expect(await prisma.followUp.count()).toBe(0);
    });

    it("refuse un contact archivé", async () => {
      const contactId = await createContactRecord(alice.workspaceId, {
        archivedAt: new Date(),
      });

      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Tâche", dueDate: today(), contactId }),
      );

      expect(result.status).toBe("error");
      expect(await prisma.task.count()).toBe(0);
    });

    it("attache un suivi du workspace", async () => {
      const followUpId = await createFollowUpRecord(alice.workspaceId, "Validation commerciale");

      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Préparer la proposition", dueDate: today(), followUpId }),
      );

      expect(result.status).toBe("success");

      const task = await prisma.task.findFirstOrThrow({
        where: { title: "Préparer la proposition" },
      });
      expect(task.followUpId).toBe(followUpId);
    });

    it("accepte les deux liens à la fois", async () => {
      const contactId = await createContactRecord(alice.workspaceId);
      const followUpId = await createFollowUpRecord(alice.workspaceId);

      const result = await createTask(
        initialCreateTaskState,
        formData({ title: "Tâche liée", dueDate: today(), contactId, followUpId }),
      );

      expect(result.status).toBe("success");
      const task = await prisma.task.findFirstOrThrow({ where: { title: "Tâche liée" } });
      expect(task.contactId).toBe(contactId);
      expect(task.followUpId).toBe(followUpId);
    });

    it("ignore les champs que le formulaire n'a pas le droit de poser", async () => {
      const result = await createTask(
        initialCreateTaskState,
        formData({
          title: "Injection",
          dueDate: today(),
          // Affectation de masse : ni le workspace, ni l'état, ni le drapeau
          // démo ne doivent pouvoir venir du client.
          workspaceId: "00000000-0000-4000-8000-000000000000",
          workspace_id: "00000000-0000-4000-8000-000000000000",
          completedAt: new Date().toISOString(),
          isDemo: "true",
        }),
      );

      expect(result.status).toBe("success");
      const task = await prisma.task.findFirstOrThrow({ where: { title: "Injection" } });
      expect(task.workspaceId).toBe(alice.workspaceId);
      expect(task.completedAt).toBeNull();
      expect(task.isDemo).toBe(false);
    });
  });

  describe("liste", () => {
    it("range les tâches en retard, du jour, puis à venir", async () => {
      await createTaskRecord(alice.workspaceId, { title: "En retard", dueInDays: -3 });
      await createTaskRecord(alice.workspaceId, { title: "Aujourd'hui", dueInDays: 0 });
      await createTaskRecord(alice.workspaceId, { title: "Demain", dueInDays: 1 });
      await createTaskRecord(alice.workspaceId, { title: "Plus tard", dueInDays: 9 });

      const list = await getTaskList("todo");

      expect(list.todoCount).toBe(4);
      expect(list.sections.map((section) => section.bucket)).toEqual([
        "overdue",
        "today",
        "upcoming",
      ]);
      expect(list.sections[2].items.map((item) => item.title)).toEqual(["Demain", "Plus tard"]);
    });

    it("sort les tâches terminées de la liste principale", async () => {
      await createTaskRecord(alice.workspaceId, { title: "À faire", dueInDays: 0 });
      await createTaskRecord(alice.workspaceId, {
        title: "Déjà faite",
        dueInDays: -1,
        completedAt: new Date(),
      });

      const list = await getTaskList("todo");

      expect(list.todoCount).toBe(1);
      expect(list.completedCount).toBe(1);
      expect(list.sections.flatMap((section) => section.items).map((item) => item.title)).toEqual([
        "À faire",
      ]);
    });

    it("les retrouve derrière le filtre « Terminées »", async () => {
      await createTaskRecord(alice.workspaceId, {
        title: "Déjà faite",
        dueInDays: -1,
        completedAt: new Date(),
      });

      const list = await getTaskList("done");

      expect(list.completed.map((item) => item.title)).toEqual(["Déjà faite"]);
      expect(list.completed[0].completed).toBe(true);
    });
  });

  describe("actions", () => {
    it("termine une tâche", async () => {
      const id = await createTaskRecord(alice.workspaceId, { dueInDays: -2 });

      await applyTaskAction(formData({ id, intent: "complete" }));

      const task = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect(task.completedAt).not.toBeNull();
    });

    it("refuse de terminer deux fois", async () => {
      const id = await createTaskRecord(alice.workspaceId, { completedAt: new Date() });

      await expect(applyTaskAction(formData({ id, intent: "complete" }))).rejects.toThrow(
        /changé entre-temps/i,
      );
    });

    it("rouvre une tâche terminée", async () => {
      const id = await createTaskRecord(alice.workspaceId, { completedAt: new Date() });

      await applyTaskAction(formData({ id, intent: "reopen" }));

      const task = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect(task.completedAt).toBeNull();
    });

    it("reporte une tâche en retard à partir d'aujourd'hui, pas de son échéance", async () => {
      const id = await createTaskRecord(alice.workspaceId, { dueInDays: -10 });

      await applyTaskAction(formData({ id, intent: "snooze", days: 1 }));

      const task = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect(dayKey(task.dueAt, APP_TIME_ZONE)).toBe(inDays(1));
    });

    it("refuse une intention inconnue", async () => {
      const id = await createTaskRecord(alice.workspaceId);

      await expect(applyTaskAction(formData({ id, intent: "abandon" }))).rejects.toThrow(
        /invalide/i,
      );
    });
  });

  describe("cockpit Aujourd'hui", () => {
    it("montre les tâches en retard et celles du jour", async () => {
      await createTaskRecord(alice.workspaceId, { title: "En retard", dueInDays: -4 });
      await createTaskRecord(alice.workspaceId, { title: "Aujourd'hui", dueInDays: 0 });

      const feed = await getTodayFeed();

      expect(feed.map((item) => item.title)).toEqual(["En retard", "Aujourd'hui"]);
      expect(feed.every((item) => item.kind === "task")).toBe(true);
    });

    it("laisse dehors demain, plus tard, et ce qui est terminé", async () => {
      await createTaskRecord(alice.workspaceId, { title: "Demain", dueInDays: 1 });
      await createTaskRecord(alice.workspaceId, { title: "Dans 10 j", dueInDays: 10 });
      await createTaskRecord(alice.workspaceId, {
        title: "Terminée",
        dueInDays: -1,
        completedAt: new Date(),
      });

      expect(await getTodayFeed()).toEqual([]);
    });

    it("réunit suivis et tâches actionnables", async () => {
      await createFollowUpRecord(alice.workspaceId, "Relancer Étienne");
      await createTaskRecord(alice.workspaceId, { title: "Préparer la présentation" });

      const feed = await getTodayFeed();

      expect(feed).toHaveLength(2);
      expect(feed.map((item) => item.kind).sort()).toEqual(["follow-up", "task"]);
    });

    it("retire la tâche du feed dès qu'elle est terminée", async () => {
      const id = await createTaskRecord(alice.workspaceId, { dueInDays: -1 });
      expect(await getTodayFeed()).toHaveLength(1);

      await applyTaskAction(formData({ id, intent: "complete" }));

      expect(await getTodayFeed()).toHaveLength(0);
    });

    it("retire la tâche du feed dès qu'elle est reportée à demain", async () => {
      const id = await createTaskRecord(alice.workspaceId, { dueInDays: 0 });
      expect(await getTodayFeed()).toHaveLength(1);

      await applyTaskAction(formData({ id, intent: "snooze", days: 1 }));

      expect(await getTodayFeed()).toHaveLength(0);
      // Elle reste disponible dans Tâches, à sa nouvelle place.
      const list = await getTaskList("todo");
      expect(list.todoCount).toBe(1);
      expect(list.sections.map((section) => section.bucket)).toEqual(["upcoming"]);
    });
  });

  describe("indépendance des états", () => {
    it("terminer la tâche ne termine pas le suivi lié", async () => {
      const followUpId = await createFollowUpRecord(alice.workspaceId, "Envoyer le devis");
      const taskId = await createTaskRecord(alice.workspaceId, {
        title: "Préparer le devis",
        followUpId,
      });

      await applyTaskAction(formData({ id: taskId, intent: "complete" }));

      const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
      expect(followUp.status).toBe("OPEN");
      expect(followUp.completedAt).toBeNull();
    });

    it("terminer le suivi ne termine pas la tâche liée", async () => {
      const followUpId = await createFollowUpRecord(alice.workspaceId, "Envoyer le devis");
      const taskId = await createTaskRecord(alice.workspaceId, {
        title: "Préparer le devis",
        followUpId,
      });

      await applyQuickAction(formData({ id: followUpId, intent: "complete" }));

      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.completedAt).toBeNull();
    });

    it("reporter la tâche ne déplace pas l'échéance du suivi", async () => {
      const followUpId = await createFollowUpRecord(alice.workspaceId);
      const before = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
      const taskId = await createTaskRecord(alice.workspaceId, { followUpId });

      await applyTaskAction(formData({ id: taskId, intent: "snooze", days: 7 }));

      const after = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
      expect(after.dueAt).toEqual(before.dueAt);
    });

    it("supprimer le suivi conserve la tâche, sans son lien", async () => {
      const followUpId = await createFollowUpRecord(alice.workspaceId);
      const taskId = await createTaskRecord(alice.workspaceId, { followUpId });

      await prisma.followUp.delete({ where: { id: followUpId } });

      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.followUpId).toBeNull();
    });
  });

  describe("sélecteur de suivi", () => {
    it("ne propose que les suivis ouverts du workspace", async () => {
      const openId = await createFollowUpRecord(alice.workspaceId, "Suivi ouvert");
      const closedId = await createFollowUpRecord(alice.workspaceId, "Suivi terminé");
      await prisma.followUp.update({
        where: { id: closedId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      const options = await findFollowUps("");

      expect(options.map((option) => option.id)).toEqual([openId]);
    });
  });
});
