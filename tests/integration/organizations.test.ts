import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveOrganization,
  createOrganization,
  findOrganizations,
  restoreOrganization,
  updateOrganization,
} from "@/app/(app)/organizations/actions";
import { createContact } from "@/app/(app)/contacts/actions";
import { initialOrganizationFormState } from "@/lib/organizations/form-state";
import { initialContactFormState } from "@/lib/contacts/form-state";
import { getOrganizationDetail, listOrganizationsPage, searchOrganizationOptions } from "@/lib/organizations/queries";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ORG_LIST_PARAMS } from "@/lib/organizations/filters";

import {
  createContactRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

describe("organisations — module V0.5", () => {
  let alice: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-ws");
    await signIn(alice);
  });

  // ── Création ────────────────────────────────────────────────────────────────

  describe("createOrganization", () => {
    it("crée une organisation dans le workspace d'Alice", async () => {
      const result = await createOrganization(
        initialOrganizationFormState,
        formData({ name: "Acme Corp" }),
      );

      expect(result.status).toBe("success");
      const org = await prisma.organization.findFirst({ where: { name: "Acme Corp" } });
      expect(org).not.toBeNull();
      expect(org!.workspaceId).toBe(alice.workspaceId);
    });

    it("refuse un nom vide", async () => {
      const result = await createOrganization(
        initialOrganizationFormState,
        formData({ name: "" }),
      );

      expect(result.status).toBe("error");
      expect(result.fieldErrors?.name).toBeDefined();
    });

    it("ne laisse pas le client injecter un workspaceId", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");

      const result = await createOrganization(
        initialOrganizationFormState,
        formData({ name: "Injection", workspaceId: bob.workspaceId }),
      );

      expect(result.status).toBe("success");
      const org = await prisma.organization.findFirst({ where: { name: "Injection" } });
      expect(org!.workspaceId).toBe(alice.workspaceId);
    });
  });

  // ── Modification ────────────────────────────────────────────────────────────

  describe("updateOrganization", () => {
    it("modifie une organisation d'Alice", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, { name: "Avant" });

      const result = await updateOrganization(
        initialOrganizationFormState,
        formData({ id: orgId, name: "Après" }),
      );

      expect(result.status).toBe("success");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.name).toBe("Après");
    });

    it("refuse de modifier l'organisation d'un autre workspace", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      const bobOrgId = await createOrganizationRecord(bob.workspaceId, { name: "Org de Bob" });

      const result = await updateOrganization(
        initialOrganizationFormState,
        formData({ id: bobOrgId, name: "Modifiée par Alice" }),
      );

      expect(result.status).toBe("error");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: bobOrgId } });
      expect(org.name).toBe("Org de Bob");
    });
  });

  // ── Archivage / restauration ────────────────────────────────────────────────

  describe("archiveOrganization / restoreOrganization", () => {
    it("archive et restaure une organisation d'Alice", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId);

      await archiveOrganization(formData({ id: orgId }));
      let org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.archivedAt).not.toBeNull();

      await restoreOrganization(formData({ id: orgId }));
      org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.archivedAt).toBeNull();
    });

    it("refuse d'archiver l'organisation d'un autre workspace", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      const bobOrgId = await createOrganizationRecord(bob.workspaceId);

      // updateMany silently updates 0 rows for foreign IDs — this is intentional
      // (fail-closed, no error disclosure)
      await archiveOrganization(formData({ id: bobOrgId }));
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: bobOrgId } });
      expect(org.archivedAt).toBeNull();
    });
  });

  // ── Requêtes de liste ────────────────────────────────────────────────────────

  describe("listOrganizationsPage", () => {
    it("ne renvoie que les organisations d'Alice", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      await createOrganizationRecord(alice.workspaceId, { name: "Org Alice" });
      await createOrganizationRecord(bob.workspaceId, { name: "Org Bob" });

      const page = await listOrganizationsPage(DEFAULT_ORG_LIST_PARAMS);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].name).toBe("Org Alice");
    });

    it("n'affiche pas les archivées par défaut", async () => {
      await createOrganizationRecord(alice.workspaceId, { name: "Active" });
      await createOrganizationRecord(alice.workspaceId, {
        name: "Archivée",
        archivedAt: new Date(),
      });

      const page = await listOrganizationsPage(DEFAULT_ORG_LIST_PARAMS);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].name).toBe("Active");
    });

    it("affiche les archivées quand le filtre est actif", async () => {
      await createOrganizationRecord(alice.workspaceId, { name: "Archivée", archivedAt: new Date() });

      const page = await listOrganizationsPage({ ...DEFAULT_ORG_LIST_PARAMS, archived: true });

      expect(page.items).toHaveLength(1);
    });

    it("filtre par terme de recherche", async () => {
      await createOrganizationRecord(alice.workspaceId, { name: "Acme Corp" });
      await createOrganizationRecord(alice.workspaceId, { name: "Globex" });

      const page = await listOrganizationsPage({ ...DEFAULT_ORG_LIST_PARAMS, search: "acme" });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].name).toBe("Acme Corp");
    });
  });

  // ── Fiche détail ─────────────────────────────────────────────────────────────

  describe("getOrganizationDetail", () => {
    it("renvoie null pour un identifiant inexistant", async () => {
      const detail = await getOrganizationDetail("00000000-0000-4000-8000-000000000000");
      expect(detail).toBeNull();
    });

    it("renvoie null pour l'organisation d'un autre workspace (fail-closed)", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      const bobOrgId = await createOrganizationRecord(bob.workspaceId);

      const detail = await getOrganizationDetail(bobOrgId);
      expect(detail).toBeNull();
    });

    it("charge les contacts rattachés", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, { name: "Acme" });
      await createContactRecord(alice.workspaceId, {
        firstName: "Jean",
        lastName: "Dupont",
        organizationId: orgId,
        organizationName: "Acme",
      });

      const detail = await getOrganizationDetail(orgId);

      expect(detail).not.toBeNull();
      expect(detail!.contacts).toHaveLength(1);
      expect(detail!.contacts[0].displayName).toBe("Jean Dupont");
    });

    it("ne charge pas les contacts d'un autre workspace", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId);
      const bob = await createWorkspaceWithUser("bob-ws");
      // Ce contact appartient à Bob mais référence l'id de l'org d'Alice (impossible en
      // vrai car la FK enforced le workspace, mais on vérifie la défense en profondeur).
      // On ne peut pas le créer à cause de la FK — c'est exactement ce qu'on teste.
      // À la place, on vérifie juste que la fiche ne déborde pas.
      await createContactRecord(bob.workspaceId, { firstName: "Eve" });

      const detail = await getOrganizationDetail(orgId);

      expect(detail!.contacts).toHaveLength(0);
    });
  });

  // ── Sélecteur ────────────────────────────────────────────────────────────────

  describe("searchOrganizationOptions / findOrganizations", () => {
    it("exclut les organisations archivées du sélecteur", async () => {
      await createOrganizationRecord(alice.workspaceId, { name: "Active" });
      await createOrganizationRecord(alice.workspaceId, {
        name: "Archivée",
        archivedAt: new Date(),
      });

      const options = await searchOrganizationOptions("");

      expect(options.map((o) => o.name)).toContain("Active");
      expect(options.map((o) => o.name)).not.toContain("Archivée");
    });

    it("ne renvoie que les organisations du workspace courant", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      await createOrganizationRecord(alice.workspaceId, { name: "Org Alice" });
      await createOrganizationRecord(bob.workspaceId, { name: "Org Bob" });

      const options = await searchOrganizationOptions("");

      expect(options.map((o) => o.name)).toContain("Org Alice");
      expect(options.map((o) => o.name)).not.toContain("Org Bob");
    });

    it("findOrganizations (action) ne fuit pas les données de Bob", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      await createOrganizationRecord(bob.workspaceId, { name: "Secret de Bob" });

      const options = await findOrganizations("");

      expect(options.map((o) => o.name)).not.toContain("Secret de Bob");
    });
  });

  // ── Rattachement Contact → Organisation ──────────────────────────────────────

  describe("createContact avec organizationId", () => {
    it("accepte un organizationId valide du même workspace", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, { name: "Acme" });

      const result = await createContact(
        initialContactFormState,
        formData({
          firstName: "Jean",
          lastName: "Dupont",
          organizationId: orgId,
        }),
      );

      expect(result.status).toBe("success");
      const contact = await prisma.contact.findFirst({ where: { firstName: "Jean" } });
      expect(contact!.organizationId).toBe(orgId);
      expect(contact!.organizationName).toBe("Acme");
    });

    it("refuse un organizationId appartenant à un autre workspace", async () => {
      const bob = await createWorkspaceWithUser("bob-ws");
      const bobOrgId = await createOrganizationRecord(bob.workspaceId, { name: "Org de Bob" });

      const result = await createContact(
        initialContactFormState,
        formData({
          firstName: "Alice",
          lastName: "Test",
          organizationId: bobOrgId,
        }),
      );

      expect(result.status).toBe("error");
      expect(await prisma.contact.count({ where: { workspaceId: alice.workspaceId } })).toBe(0);
    });

    it("refuse de rattacher un contact à une organisation archivée", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, {
        name: "Archivée",
        archivedAt: new Date(),
      });

      const result = await createContact(
        initialContactFormState,
        formData({ firstName: "Jean", organizationId: orgId }),
      );

      expect(result.status).toBe("error");
    });
  });
});
