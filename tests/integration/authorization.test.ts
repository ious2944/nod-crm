import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction, createFollowUp } from "@/app/(app)/follow-ups/actions";
import { UnauthenticatedError } from "@/lib/auth/dal";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { getFollowUpBoard, listContacts } from "@/lib/follow-ups/queries";
import { prisma } from "@/lib/prisma";

import { TestRedirect } from "./cookie-jar";
import {
  createFollowUpRecord,
  createWorkspaceWithUser,
  dropCookie,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Le contrat de cette suite : **aucune mutation ne s'exécute sans session**.
 *
 * Ces actions sont des points d'entrée HTTP à part entière. Le fait que
 * l'interface ne les affiche pas ne protège rien : elles sont testées ici
 * appelées directement, comme le ferait un POST forgé.
 */

const ALL_INTENTS = [
  "nudge",
  "handoff",
  "received",
  "snooze",
  "complete",
  "abandon",
  "reopen",
] as const;

describe("mutations sans session", () => {
  let user: TestUser;
  let followUpId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("authz-ws");
    followUpId = await createFollowUpRecord(user.workspaceId, "Suivi protégé");
    dropCookie();
  });

  it("refuse la création d'un suivi", async () => {
    await expect(
      createFollowUp(
        initialCreateState,
        formData({ title: "Injecté", dueDate: "2026-01-01", ballOwner: "THEM" }),
      ),
    ).rejects.toThrow(UnauthenticatedError);

    expect(await prisma.followUp.count({ where: { title: "Injecté" } })).toBe(0);
  });

  it("refuse la création d'un contact via la création rapide", async () => {
    await expect(
      createFollowUp(
        initialCreateState,
        formData({
          title: "Injecté",
          dueDate: "2026-01-01",
          ballOwner: "THEM",
          contactId: "new",
          newContactFirstName: "Intrus",
        }),
      ),
    ).rejects.toThrow(UnauthenticatedError);

    expect(await prisma.contact.count()).toBe(0);
  });

  it.each(ALL_INTENTS)("refuse l'action rapide « %s »", async (intent) => {
    await expect(
      applyQuickAction(formData({ id: followUpId, intent, days: 3 })),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("laisse le suivi rigoureusement intact", async () => {
    const before = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });

    for (const intent of ALL_INTENTS) {
      await expect(
        applyQuickAction(formData({ id: followUpId, intent, days: 7 })),
      ).rejects.toThrow(UnauthenticatedError);
    }

    const after = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(after).toEqual(before);
  });

  it("refuse la lecture du tableau et de la liste de contacts", async () => {
    // Les lectures passent par `requireUser()` : elles redirigent vers /login.
    await expect(getFollowUpBoard("all")).rejects.toThrow(TestRedirect);
    await expect(listContacts()).rejects.toThrow(TestRedirect);
  });
});

describe("mutations avec session", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("authz-ok-ws");
    await signIn(user);
  });

  it("autorise la création et rattache au workspace de la session", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({ title: "Autorisé", dueDate: "2026-05-01", ballOwner: "ME" }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.followUp.findFirstOrThrow({ where: { title: "Autorisé" } });
    expect(created.workspaceId).toBe(user.workspaceId);
  });

  it("autorise les actions rapides sur ses propres suivis", async () => {
    const followUpId = await createFollowUpRecord(user.workspaceId);

    await applyQuickAction(formData({ id: followUpId, intent: "nudge" }));

    const updated = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(updated.nudgeCount).toBe(1);
    expect(updated.ballOwner).toBe("THEM");
  });

  it("expire : une session détruite en base coupe l'accès immédiatement", async () => {
    await prisma.session.deleteMany({});

    await expect(
      applyQuickAction(
        formData({ id: await createFollowUpRecord(user.workspaceId), intent: "complete" }),
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });
});
