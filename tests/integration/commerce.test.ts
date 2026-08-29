import { beforeEach, describe, expect, it } from "vitest";

import {
  changeOpportunityStatus,
  createOpportunity,
  deleteOpportunity,
  findOpportunities,
  updateOpportunity,
} from "@/app/(app)/commerce/actions";
import { getCommerceStats, getOpportunityDetail, listOpportunities } from "@/lib/commerce/queries";
import { initialCreateOpportunityState, initialUpdateOpportunityState } from "@/lib/commerce/create-state";

import {
  createOpportunityRecord,
  createOrganizationRecord,
  createContactRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Tests d'intégration du module Commerce.
 *
 * Structure : création, lecture, mise à jour, changement de statut, suppression,
 * et isolation inter-workspace.
 */

describe("commerce — CRUD", () => {
  let alice: TestUser;
  let orgId: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-commerce");
    orgId = await createOrganizationRecord(alice.workspaceId, { name: "Acme Corp" });
    await signIn(alice);
  });

  it("crée une opportunité et la retrouve dans la liste", async () => {
    const result = await createOpportunity(
      initialCreateOpportunityState,
      formData({
        name: "Refonte site web",
        organizationId: orgId,
        status: "A_QUALIFIER",
      }),
    );

    expect(result.status).toBe("success");

    const items = await listOpportunities("open");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Refonte site web");
    expect(items[0].status).toBe("A_QUALIFIER");
    expect(items[0].organizationName).toBe("Acme Corp");
  });

  it("rejette la création sans nom", async () => {
    const result = await createOpportunity(
      initialCreateOpportunityState,
      formData({ name: "", organizationId: orgId, status: "A_QUALIFIER" }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toBeTruthy();
  });

  it("rejette la création sans organisation", async () => {
    const result = await createOpportunity(
      initialCreateOpportunityState,
      formData({ name: "Affaire test", organizationId: "", status: "A_QUALIFIER" }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.organizationId).toBeTruthy();
  });

  it("crée une opportunité avec montant et date prévisionnelle", async () => {
    const result = await createOpportunity(
      initialCreateOpportunityState,
      formData({
        name: "Gros projet",
        organizationId: orgId,
        status: "EN_DISCUSSION",
        estimatedAmount: "50000",
        expectedCloseDate: "2026-12-31",
      }),
    );

    expect(result.status).toBe("success");

    const items = await listOpportunities("open");
    expect(items[0].estimatedAmount).not.toBeNull();
    expect(items[0].expectedCloseDate).toBe("2026-12-31");
  });

  it("met à jour une opportunité existante", async () => {
    const oppId = await createOpportunityRecord(alice.workspaceId, orgId, {
      name: "Nom initial",
    });

    const result = await updateOpportunity(
      initialUpdateOpportunityState,
      formData({
        id: oppId,
        name: "Nom mis à jour",
        organizationId: orgId,
      }),
    );

    expect(result.status).toBe("success");

    const detail = await getOpportunityDetail(oppId);
    expect(detail?.name).toBe("Nom mis à jour");
  });

  it("change le statut dans la machine à états", async () => {
    const oppId = await createOpportunityRecord(alice.workspaceId, orgId);

    await changeOpportunityStatus(formData({ id: oppId, status: "EN_DISCUSSION" }));

    const detail = await getOpportunityDetail(oppId);
    expect(detail?.status).toBe("EN_DISCUSSION");
    expect(detail?.isOpen).toBe(true);
  });

  it("marque une affaire comme gagnée et enregistre closedAt", async () => {
    const oppId = await createOpportunityRecord(alice.workspaceId, orgId);

    await changeOpportunityStatus(formData({ id: oppId, status: "GAGNEE" }));

    const detail = await getOpportunityDetail(oppId);
    expect(detail?.status).toBe("GAGNEE");
    expect(detail?.isOpen).toBe(false);
    expect(detail?.closedDate).not.toBeNull();
  });

  it("supprime une opportunité et la retire de la liste", async () => {
    const oppId = await createOpportunityRecord(alice.workspaceId, orgId);

    await deleteOpportunity(formData({ id: oppId }));

    const items = await listOpportunities("all");
    expect(items).toHaveLength(0);
  });

  it("le sélecteur ne renvoie que les opportunités ouvertes", async () => {
    await createOpportunityRecord(alice.workspaceId, orgId, {
      name: "Affaire ouverte",
      status: "EN_DISCUSSION",
    });
    await createOpportunityRecord(alice.workspaceId, orgId, {
      name: "Affaire gagnée",
      status: "GAGNEE",
    });

    const options = await findOpportunities("");
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("Affaire ouverte");
  });

  it("getCommerceStats renvoie les bons compteurs", async () => {
    await createOpportunityRecord(alice.workspaceId, orgId, { status: "A_QUALIFIER" });
    await createOpportunityRecord(alice.workspaceId, orgId, { status: "GAGNEE" });
    await createOpportunityRecord(alice.workspaceId, orgId, { status: "PERDUE" });

    const stats = await getCommerceStats();
    expect(stats.openCount).toBe(1);
    expect(stats.closedCount).toBe(2);
  });

  it("la fiche détail charge les tâches et suivis liés", async () => {
    const oppId = await createOpportunityRecord(alice.workspaceId, orgId);

    // Liaison directe en base (les actions de création incluent l'opportunityId)
    const { prisma } = await import("@/lib/prisma");
    await prisma.task.create({
      data: {
        workspaceId: alice.workspaceId,
        opportunityId: oppId,
        title: "Tâche liée",
        dueAt: new Date(),
      },
    });

    const detail = await getOpportunityDetail(oppId);
    expect(detail?.openTasks).toHaveLength(1);
    expect(detail?.openTasks[0].title).toBe("Tâche liée");
  });

  it("un contact peut être lié à la création", async () => {
    const contactId = await createContactRecord(alice.workspaceId, {
      firstName: "Jean",
      lastName: "Dupont",
    });

    const result = await createOpportunity(
      initialCreateOpportunityState,
      formData({
        name: "Affaire avec contact",
        organizationId: orgId,
        status: "A_QUALIFIER",
        contactId,
      }),
    );

    expect(result.status).toBe("success");

    const items = await listOpportunities("open");
    expect(items[0].contactName).toBe("Jean Dupont");
  });
});

describe("commerce — isolation des workspaces", () => {
  let alice: TestUser;
  let bob: TestUser;
  let bobOrgId: string;
  let bobOppId: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-commerce-iso");
    bob = await createWorkspaceWithUser("bob-commerce-iso");

    bobOrgId = await createOrganizationRecord(bob.workspaceId, { name: "Org de Bob" });
    bobOppId = await createOpportunityRecord(bob.workspaceId, bobOrgId, {
      name: "Secret de Bob",
    });

    await signIn(alice);
  });

  it("Alice ne voit pas les opportunités de Bob", async () => {
    const items = await listOpportunities("open");
    expect(items).toHaveLength(0);
  });

  it("Alice ne peut pas mettre à jour une opportunité de Bob", async () => {
    // Alice crée sa propre org pour avoir un orgId valide
    const aliceOrgId = await createOrganizationRecord(alice.workspaceId);

    const result = await updateOpportunity(
      initialUpdateOpportunityState,
      formData({
        id: bobOppId,
        name: "Hack",
        organizationId: aliceOrgId,
      }),
    );

    expect(result.status).toBe("error");
  });

  it("Alice ne peut pas changer le statut d'une opportunité de Bob", async () => {
    await expect(
      changeOpportunityStatus(formData({ id: bobOppId, status: "GAGNEE" })),
    ).rejects.toThrow();
  });

  it("Alice ne peut pas supprimer une opportunité de Bob", async () => {
    await expect(
      deleteOpportunity(formData({ id: bobOppId })),
    ).rejects.toThrow();

    // L'opportunité de Bob est intacte
    await signIn(bob);
    const items = await listOpportunities("open");
    expect(items).toHaveLength(1);
  });

  it("le sélecteur d'opportunité ne renvoie que celles d'Alice", async () => {
    const aliceOrgId = await createOrganizationRecord(alice.workspaceId);
    await createOpportunityRecord(alice.workspaceId, aliceOrgId, {
      name: "Affaire d'Alice",
    });

    const options = await findOpportunities("");
    expect(options.map((o) => o.name)).toEqual(["Affaire d'Alice"]);
    expect(options.map((o) => o.name)).not.toContain("Secret de Bob");
  });

  it("getOpportunityDetail renvoie null pour une opportunité d'un autre workspace", async () => {
    const detail = await getOpportunityDetail(bobOppId);
    expect(detail).toBeNull();
  });
});
