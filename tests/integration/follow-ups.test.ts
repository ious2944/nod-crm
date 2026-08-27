import { beforeEach, describe, expect, it } from "vitest";

import { updateFollowUp } from "@/app/(app)/follow-ups/actions";
import { initialEditFollowUpState } from "@/lib/follow-ups/edit-state";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";
import { prisma } from "@/lib/prisma";

import {
  createContactRecord,
  createFollowUpRecord,
  createWorkspaceWithUser,
  dropCookie,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Module Follow-ups V0.6 — recherche et édition.
 *
 * Ces tests vérifient le comportement ajouté en V0.6 : la recherche textuelle
 * dans `getFollowUpBoard` et la nouvelle action `updateFollowUp`.
 * Les quick actions (relancer, terminer, etc.) et la création sont couverts
 * par les tests existants dans `contacts.test.ts` et `authorization.test.ts`.
 */

describe("getFollowUpBoard — recherche textuelle", () => {
  let alice: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-search-ws");
    await signIn(alice);
  });

  async function createFollowUpFull(
    workspaceId: string,
    title: string,
    description?: string,
  ): Promise<string> {
    const followUp = await prisma.followUp.create({
      data: {
        workspaceId,
        title,
        description: description ?? null,
        ballOwner: "THEM",
        dueAt: new Date(Date.now() + 3 * 86_400_000),
      },
      select: { id: true },
    });
    return followUp.id;
  }

  it("retourne tous les ouverts sans recherche", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat Acme");
    await createFollowUpFull(alice.workspaceId, "Rapport Globex");

    const board = await getFollowUpBoard("all");
    expect(board.items.length).toBe(2);
  });

  it("filtre sur le titre avec une recherche exacte", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat Acme");
    await createFollowUpFull(alice.workspaceId, "Rapport Globex");

    const board = await getFollowUpBoard("all", "Acme");
    expect(board.items.length).toBe(1);
    expect(board.items[0].title).toBe("Contrat Acme");
  });

  it("filtre sur le titre, insensible à la casse", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat Acme");
    await createFollowUpFull(alice.workspaceId, "Rapport Globex");

    const board = await getFollowUpBoard("all", "ACME");
    expect(board.items.length).toBe(1);
    expect(board.items[0].title).toBe("Contrat Acme");
  });

  it("filtre sur la description", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat", "Partenariat Acme 2026");
    await createFollowUpFull(alice.workspaceId, "Autre suivi", "Rien de spécial");

    const board = await getFollowUpBoard("all", "Acme");
    expect(board.items.length).toBe(1);
    expect(board.items[0].title).toBe("Contrat");
  });

  it("les stats reflètent tous les ouverts, même avec une recherche active", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat Acme");
    await createFollowUpFull(alice.workspaceId, "Rapport Globex");

    const board = await getFollowUpBoard("all", "Acme");
    // Les items sont filtrés (1 suivi), mais les stats portent sur les 2.
    expect(board.stats.open).toBe(2);
    expect(board.items.length).toBe(1);
  });

  it("retourne une liste vide si aucun suivi ne correspond", async () => {
    await createFollowUpFull(alice.workspaceId, "Contrat Acme");

    const board = await getFollowUpBoard("all", "rien-de-tel");
    expect(board.items.length).toBe(0);
    expect(board.stats.open).toBe(1); // stats toujours correctes
  });

  it("combine recherche et filtre (Chez moi + recherche)", async () => {
    // Suivi chez moi qui correspond à la recherche
    await prisma.followUp.create({
      data: {
        workspaceId: alice.workspaceId,
        title: "Contrat Acme",
        ballOwner: "ME",
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Suivi chez eux qui correspond à la recherche — ne doit pas apparaître
    await prisma.followUp.create({
      data: {
        workspaceId: alice.workspaceId,
        title: "Rapport Acme",
        ballOwner: "THEM",
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });

    const board = await getFollowUpBoard("me", "Acme");
    expect(board.items.length).toBe(1);
    expect(board.items[0].ballOwner).toBe("ME");
  });

  it("recherche dans les terminés via DB (ILIKE)", async () => {
    await prisma.followUp.create({
      data: {
        workspaceId: alice.workspaceId,
        title: "Terminé Acme",
        ballOwner: "THEM",
        dueAt: new Date(Date.now() - 86_400_000),
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await prisma.followUp.create({
      data: {
        workspaceId: alice.workspaceId,
        title: "Terminé Globex",
        ballOwner: "THEM",
        dueAt: new Date(Date.now() - 86_400_000),
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    const board = await getFollowUpBoard("done", "Acme");
    expect(board.items.length).toBe(1);
    expect(board.items[0].title).toBe("Terminé Acme");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// updateFollowUp
// ────────────────────────────────────────────────────────────────────────────

describe("updateFollowUp", () => {
  let alice: TestUser;
  let followUpId: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-edit-ws");
    await signIn(alice);
    followUpId = await createFollowUpRecord(alice.workspaceId, "Suivi initial");
  });

  it("met à jour le titre et la description", async () => {
    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({
        id: followUpId,
        title: "Suivi modifié",
        description: "Contexte mis à jour",
        dueDate: "2026-09-01",
      }),
    );

    expect(result.status).toBe("success");
    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(followUp.title).toBe("Suivi modifié");
    expect(followUp.description).toBe("Contexte mis à jour");
  });

  it("met à jour l'échéance", async () => {
    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpId, title: "Suivi initial", dueDate: "2026-09-15" }),
    );

    expect(result.status).toBe("success");
    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    // `startOfDay` convertit la date en début de journée selon APP_TIME_ZONE
    // (Europe/Paris). En UTC, cela donne la veille à 22 h ou 23 h selon l'heure
    // d'été. On vérifie que la date utc est comprise dans le bon intervalle
    // (entre le 14 sept à 22h et le 15 sept à 2h UTC).
    const dueMs = followUp.dueAt.getTime();
    const lower = new Date("2026-09-14T22:00:00Z").getTime();
    const upper = new Date("2026-09-15T02:00:00Z").getTime();
    expect(dueMs).toBeGreaterThanOrEqual(lower);
    expect(dueMs).toBeLessThan(upper);
  });

  it("efface le contact quand contactId est vide", async () => {
    const contactId = await createContactRecord(alice.workspaceId);
    // Relier le contact au suivi directement en base.
    await prisma.followUp.update({
      where: { id: followUpId },
      data: { contactId },
    });

    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpId, title: "Suivi initial", dueDate: "2026-09-01", contactId: "" }),
    );

    expect(result.status).toBe("success");
    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(followUp.contactId).toBeNull();
  });

  it("lie un contact existant dans le workspace", async () => {
    const contactId = await createContactRecord(alice.workspaceId);

    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpId, title: "Suivi initial", dueDate: "2026-09-01", contactId }),
    );

    expect(result.status).toBe("success");
    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(followUp.contactId).toBe(contactId);
  });

  it("refuse de lier un contact archivé", async () => {
    const archivedContactId = await createContactRecord(alice.workspaceId, {
      archivedAt: new Date(),
    });

    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({
        id: followUpId,
        title: "Suivi initial",
        dueDate: "2026-09-01",
        contactId: archivedContactId,
      }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.contactId).toBeDefined();
  });

  it("refuse un titre vide", async () => {
    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpId, title: "", dueDate: "2026-09-01" }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.title).toBeDefined();
  });

  it("refuse une échéance invalide", async () => {
    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpId, title: "Test", dueDate: "pas-une-date" }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.dueDate).toBeDefined();
  });

  it("refuse sans session authentifiée", async () => {
    dropCookie();

    await expect(
      updateFollowUp(
        initialEditFollowUpState,
        formData({ id: followUpId, title: "Test", dueDate: "2026-09-01" }),
      ),
    ).rejects.toThrow();
  });

  it("n'accepte pas de modifier un suivi d'un autre workspace", async () => {
    const bob = await createWorkspaceWithUser("bob-ws");
    const bobFollowUpId = await createFollowUpRecord(bob.workspaceId, "Suivi de Bob");

    // Alice est connectée — elle essaie de modifier le suivi de Bob.
    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: bobFollowUpId, title: "Piraté", dueDate: "2026-09-01" }),
    );

    expect(result.status).toBe("error");

    // Le suivi de Bob reste inchangé.
    const bobFollowUp = await prisma.followUp.findUniqueOrThrow({ where: { id: bobFollowUpId } });
    expect(bobFollowUp.title).toBe("Suivi de Bob");
  });

  it("ne modifie pas la balle ni le statut (ils restent aux quick actions)", async () => {
    // Préparation : follow-up avec ballOwner THEM et statut OPEN
    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(followUp.ballOwner).toBe("THEM");
    expect(followUp.status).toBe("OPEN");

    await updateFollowUp(
      initialEditFollowUpState,
      formData({
        id: followUpId,
        title: "Titre modifié",
        dueDate: "2026-09-01",
        // On tente d'injecter ballOwner et status — le schéma les ignore.
        ballOwner: "ME",
        status: "COMPLETED",
      }),
    );

    const updated = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(updated.ballOwner).toBe("THEM"); // inchangé
    expect(updated.status).toBe("OPEN"); // inchangé
    expect(updated.title).toBe("Titre modifié"); // bien mis à jour
  });

  it("n'accepte pas de lier un contact d'un autre workspace", async () => {
    const bob = await createWorkspaceWithUser("bob-ws2");
    const bobContactId = await createContactRecord(bob.workspaceId);

    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({
        id: followUpId,
        title: "Test",
        dueDate: "2026-09-01",
        contactId: bobContactId,
      }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.contactId).toBeDefined();
  });

  it("retourne une erreur propre pour un id inexistant (pas de fuite d'information)", async () => {
    // Un UUID valide mais qui n'existe dans aucun workspace.
    const nonExistentId = "00000000-0000-4000-8000-000000000099";

    const result = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: nonExistentId, title: "Test", dueDate: "2026-09-01" }),
    );

    // Le comportement doit être identique à un suivi d'un autre workspace :
    // erreur générique, pas de distinction entre « inexistant » et « étranger ».
    expect(result.status).toBe("error");
    expect(result.message).toBe("Suivi introuvable.");
    // Pas de fieldErrors ici : l'erreur est au niveau de l'action, pas du champ.
    expect(result.fieldErrors).toBeUndefined();
  });
});
