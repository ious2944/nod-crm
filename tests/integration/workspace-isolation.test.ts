import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction, createFollowUp } from "@/app/(app)/follow-ups/actions";
import { applyTaskAction, createTask, findFollowUps } from "@/app/(app)/tasks/actions";
import {
  archiveOrganization,
  findOrganizations,
  updateOrganization,
} from "@/app/(app)/organizations/actions";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { searchContactOptions } from "@/lib/contacts/queries";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";
import { getOrganizationDetail, listOrganizationsPage, searchOrganizationOptions } from "@/lib/organizations/queries";
import { DEFAULT_ORG_LIST_PARAMS } from "@/lib/organizations/filters";
import { initialOrganizationFormState } from "@/lib/organizations/form-state";
import { prisma } from "@/lib/prisma";
import { initialCreateTaskState } from "@/lib/tasks/create-state";
import { getTaskList } from "@/lib/tasks/queries";
import { getTodayFeed } from "@/lib/today/queries";

import {
  createContactRecord,
  createFollowUpRecord,
  createOrganizationRecord,
  createTaskRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Isolation entre workspaces.
 *
 * La V0.1 n'utilise qu'un workspace, mais la frontière doit être correcte
 * maintenant : la corriger après avoir accumulé des données coûterait bien plus
 * cher, et une faille d'isolation ne se voit pas tant qu'il n'y a qu'un espace.
 *
 * Deux utilisateurs, deux workspaces, et A ne doit jamais atteindre B —
 * ni en lecture, ni en écriture, même en fournissant l'identifiant exact.
 */
describe("isolation des workspaces", () => {
  let alice: TestUser;
  let bob: TestUser;
  let bobFollowUpId: string;
  let bobContactId: string;
  let bobTaskId: string;
  let bobOrganizationId: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-ws");
    bob = await createWorkspaceWithUser("bob-ws");

    bobFollowUpId = await createFollowUpRecord(bob.workspaceId, "Secret de Bob");
    bobContactId = await createContactRecord(bob.workspaceId);
    bobTaskId = await createTaskRecord(bob.workspaceId, {
      title: "Tâche de Bob",
      dueInDays: -1,
    });
    bobOrganizationId = await createOrganizationRecord(bob.workspaceId, { name: "Org de Bob" });

    await createFollowUpRecord(alice.workspaceId, "Sujet d'Alice");
    await signIn(alice);
  });

  it("ne montre à Alice que ses propres suivis", async () => {
    const board = await getFollowUpBoard("all");

    expect(board.items.map((item) => item.title)).toEqual(["Sujet d'Alice"]);
    expect(board.stats.open).toBe(1);
  });

  it("ne montre à Alice que ses propres contacts", async () => {
    await createContactRecord(alice.workspaceId);

    const contacts = await searchContactOptions("");

    expect(contacts).toHaveLength(1);
    expect(contacts.map((contact) => contact.id)).not.toContain(bobContactId);
  });

  it("ne compte pas les suivis terminés de Bob dans les statistiques d'Alice", async () => {
    await prisma.followUp.update({
      where: { id: bobFollowUpId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const board = await getFollowUpBoard("done");

    expect(board.stats.completed).toBe(0);
    expect(board.items).toHaveLength(0);
  });

  it.each(["nudge", "handoff", "received", "snooze", "complete", "abandon", "reopen"])(
    "refuse à Alice l'action « %s » sur un suivi de Bob",
    async (intent) => {
      const before = await prisma.followUp.findUniqueOrThrow({ where: { id: bobFollowUpId } });

      await expect(
        applyQuickAction(formData({ id: bobFollowUpId, intent, days: 7 })),
      ).rejects.toThrow(/introuvable/i);

      const after = await prisma.followUp.findUniqueOrThrow({ where: { id: bobFollowUpId } });
      expect(after).toEqual(before);
    },
  );

  it("refuse à Alice de rattacher son suivi à un contact de Bob", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Tentative de rattachement",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId: bobContactId,
      }),
    );

    expect(result.status).toBe("error");
    expect(await prisma.followUp.count({ where: { title: "Tentative de rattachement" } })).toBe(0);
  });

  it("ne laisse jamais le client choisir son workspace", async () => {
    // Le champ est ignoré : `workspaceId` vient de la session, pas du formulaire.
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Injection de workspace",
        dueDate: "2026-05-01",
        ballOwner: "ME",
        workspaceId: bob.workspaceId,
        workspace_id: bob.workspaceId,
      }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.followUp.findFirstOrThrow({
      where: { title: "Injection de workspace" },
    });
    expect(created.workspaceId).toBe(alice.workspaceId);
  });

  it("ne montre à Alice que ses propres tâches", async () => {
    await createTaskRecord(alice.workspaceId, { title: "Tâche d'Alice", dueInDays: -1 });

    const list = await getTaskList("todo");
    const feed = await getTodayFeed();

    expect(list.todoCount).toBe(1);
    expect(list.sections.flatMap((section) => section.items).map((item) => item.title)).toEqual([
      "Tâche d'Alice",
    ]);
    expect(feed.map((item) => item.title)).not.toContain("Tâche de Bob");
  });

  it("ne compte pas les tâches terminées de Bob", async () => {
    await prisma.task.update({
      where: { id: bobTaskId },
      data: { completedAt: new Date() },
    });

    const list = await getTaskList("done");

    expect(list.completedCount).toBe(0);
    expect(list.completed).toHaveLength(0);
  });

  it.each(["complete", "reopen", "snooze"])(
    "refuse à Alice l'action « %s » sur une tâche de Bob",
    async (intent) => {
      const before = await prisma.task.findUniqueOrThrow({ where: { id: bobTaskId } });

      await expect(
        applyTaskAction(formData({ id: bobTaskId, intent, days: 7 })),
      ).rejects.toThrow(/introuvable/i);

      const after = await prisma.task.findUniqueOrThrow({ where: { id: bobTaskId } });
      expect(after).toEqual(before);
    },
  );

  it("refuse à Alice de rattacher sa tâche à un contact de Bob", async () => {
    const result = await createTask(
      initialCreateTaskState,
      formData({
        title: "Tâche cross-workspace",
        dueDate: "2026-05-01",
        contactId: bobContactId,
      }),
    );

    expect(result.status).toBe("error");
    expect(await prisma.task.count({ where: { title: "Tâche cross-workspace" } })).toBe(0);
  });

  it("refuse à Alice de rattacher sa tâche à un suivi de Bob", async () => {
    const result = await createTask(
      initialCreateTaskState,
      formData({
        title: "Tâche cross-suivi",
        dueDate: "2026-05-01",
        followUpId: bobFollowUpId,
      }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.followUpId).toMatch(/introuvable/i);
    expect(await prisma.task.count({ where: { title: "Tâche cross-suivi" } })).toBe(0);
  });

  it("ne laisse jamais une tâche choisir son workspace", async () => {
    const result = await createTask(
      initialCreateTaskState,
      formData({
        title: "Tâche injectée",
        dueDate: "2026-05-01",
        workspaceId: bob.workspaceId,
        workspace_id: bob.workspaceId,
      }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.task.findFirstOrThrow({ where: { title: "Tâche injectée" } });
    expect(created.workspaceId).toBe(alice.workspaceId);
  });

  it("ne propose jamais un suivi de Bob au sélecteur d'Alice", async () => {
    const options = await findFollowUps("");

    expect(options.map((option) => option.id)).not.toContain(bobFollowUpId);
  });

  it("résiste à un identifiant inexistant ou malformé", async () => {
    await expect(
      applyQuickAction(
        formData({ id: "00000000-0000-4000-8000-000000000000", intent: "complete" }),
      ),
    ).rejects.toThrow(/introuvable/i);

    // Un identifiant non-UUID est arrêté par la validation, pas par la base.
    await expect(
      applyQuickAction(formData({ id: "'; DROP TABLE follow_ups; --", intent: "complete" })),
    ).rejects.toThrow(/invalide/i);

    expect(await prisma.followUp.count()).toBe(2);

    await expect(
      applyTaskAction(formData({ id: "00000000-0000-4000-8000-000000000000", intent: "complete" })),
    ).rejects.toThrow(/introuvable/i);

    await expect(
      applyTaskAction(formData({ id: "'; DROP TABLE tasks; --", intent: "complete" })),
    ).rejects.toThrow(/invalide/i);

    expect(await prisma.task.count()).toBe(1);
  });

  // ── Isolation Organisations (V0.5) ─────────────────────────────────────────

  it("ne montre à Alice que ses propres organisations dans la liste", async () => {
    await createOrganizationRecord(alice.workspaceId, { name: "Org Alice" });

    const page = await listOrganizationsPage(DEFAULT_ORG_LIST_PARAMS);

    expect(page.items.map((item) => item.name)).toEqual(["Org Alice"]);
    expect(page.items.map((item) => item.id)).not.toContain(bobOrganizationId);
  });

  it("ne montre pas l'organisation de Bob dans le sélecteur d'Alice", async () => {
    await createOrganizationRecord(alice.workspaceId, { name: "Org Alice" });

    const options = await searchOrganizationOptions("");
    const actionOptions = await findOrganizations("");

    expect(options.map((o) => o.id)).not.toContain(bobOrganizationId);
    expect(actionOptions.map((o) => o.id)).not.toContain(bobOrganizationId);
  });

  it("refuse à Alice de lire la fiche de l'organisation de Bob", async () => {
    const detail = await getOrganizationDetail(bobOrganizationId);
    expect(detail).toBeNull();
  });

  it("refuse à Alice de modifier l'organisation de Bob", async () => {
    const result = await updateOrganization(
      initialOrganizationFormState,
      formData({ id: bobOrganizationId, name: "Détournée par Alice" }),
    );

    expect(result.status).toBe("error");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: bobOrganizationId } });
    expect(org.name).toBe("Org de Bob");
  });

  it("refuse à Alice d'archiver l'organisation de Bob", async () => {
    await archiveOrganization(formData({ id: bobOrganizationId }));

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: bobOrganizationId } });
    expect(org.archivedAt).toBeNull();
  });
});
