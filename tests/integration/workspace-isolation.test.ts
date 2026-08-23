import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction, createFollowUp } from "@/app/(app)/follow-ups/actions";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { getFollowUpBoard, listContacts } from "@/lib/follow-ups/queries";
import { prisma } from "@/lib/prisma";

import {
  createContactRecord,
  createFollowUpRecord,
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

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-ws");
    bob = await createWorkspaceWithUser("bob-ws");

    bobFollowUpId = await createFollowUpRecord(bob.workspaceId, "Secret de Bob");
    bobContactId = await createContactRecord(bob.workspaceId);

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

    const contacts = await listContacts();

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
  });
});
