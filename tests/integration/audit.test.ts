import { beforeEach, describe, expect, it, vi } from "vitest";

import { archiveContact, createContact, restoreContact, updateContact } from "@/app/(app)/contacts/actions";
import { deleteOpportunity } from "@/app/(app)/commerce/actions";
import { createTreatment } from "@/app/(app)/rgpd/actions";
import { UnauthenticatedError } from "@/lib/auth/dal";
import { initialContactFormState } from "@/lib/contacts/form-state";
import { prisma } from "@/lib/prisma";

import { headerJar } from "./cookie-jar";
import {
  createOpportunityRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  dropCookie,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Audit trail — comportement, isolation, et ce qu'il ne doit JAMAIS faire :
 * bloquer une mutation métier, ni servir de second endroit où vivent des
 * données personnelles.
 */

async function create(fields: Record<string, string>) {
  return createContact(initialContactFormState, formData(fields));
}

function auditRows() {
  return prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
}

describe("écriture — cas nominaux", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("audit-ws");
    await signIn(user);
  });

  it("CREATE : une ligne d'audit exacte après une création réussie", async () => {
    const result = await create({ firstName: "Julien", lastName: "Doussot" });
    expect(result.status).toBe("success");

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: user.workspaceId,
      userId: user.userId,
      action: "CREATE",
      entityType: "Contact",
      entityId: result.contactId,
    });
    expect(rows[0].requestId).toEqual(expect.any(String));
  });

  it("UPDATE : journalisé seulement après le succès réel de la mutation", async () => {
    const created = await create({ firstName: "Julien", lastName: "Doussot" });
    const result = await updateContact(
      initialContactFormState,
      formData({ id: created.contactId!, firstName: "Julie", lastName: "Doussot" }),
    );
    expect(result.status).toBe("success");

    const rows = await auditRows();
    // Une ligne CREATE, une ligne UPDATE — pas plus.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: "UPDATE", entityType: "Contact", entityId: created.contactId });
  });

  it("ARCHIVE puis RESTORE : deux lignes distinctes, dans l'ordre", async () => {
    const created = await create({ firstName: "Julien", lastName: "Doussot" });

    await archiveContact(formData({ id: created.contactId! }));
    await restoreContact(formData({ id: created.contactId! }));

    const rows = await auditRows();
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(["CREATE", "ARCHIVE", "RESTORE"]);
  });

  it("DELETE : suppression définitive d'une opportunité journalisée", async () => {
    const org = await createOrganizationRecord(user.workspaceId);
    const opportunityId = await createOpportunityRecord(user.workspaceId, org);

    await deleteOpportunity(formData({ id: opportunityId }));

    const rows = await auditRows();
    expect(rows.filter((r) => r.entityType === "Opportunity")).toHaveLength(1);
    expect(rows.find((r) => r.entityType === "Opportunity")).toMatchObject({
      action: "DELETE",
      entityId: opportunityId,
    });
    // L'entité elle-même a bien disparu — l'audit est la seule trace restante.
    expect(await prisma.opportunity.findUnique({ where: { id: opportunityId } })).toBeNull();
  });

  it("double appel (archive deux fois de suite) : deux lignes ARCHIVE cohérentes, pas de crash", async () => {
    const created = await create({ firstName: "Julien", lastName: "Doussot" });

    await archiveContact(formData({ id: created.contactId! }));
    await archiveContact(formData({ id: created.contactId! }));

    const rows = await auditRows();
    expect(rows.filter((r) => r.action === "ARCHIVE")).toHaveLength(2);
  });
});

describe("isolation stricte par tenant", () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    userA = await createWorkspaceWithUser("audit-tenant-a");
    userB = await createWorkspaceWithUser("audit-tenant-b");
  });

  it("un acteur de A ne peut ni lire ni produire d'audit pour B via un id d'entité de B", async () => {
    await signIn(userB);
    const bContact = await create({ firstName: "Voisin", lastName: "B" });

    await signIn(userA);
    // A tente d'archiver le contact de B en connaissant seulement son id.
    await expect(archiveContact(formData({ id: bContact.contactId! }))).rejects.toThrow(
      "Contact introuvable.",
    );

    const rows = await auditRows();
    // Une seule ligne : le CREATE de B. Rien pour la tentative avortée de A.
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBe(userB.workspaceId);

    // Et la requête directe confirme qu'aucune ligne n'existe sous le
    // workspace de A pour cette entité.
    const leaked = await prisma.auditLog.findMany({
      where: { workspaceId: userA.workspaceId, entityId: bContact.contactId! },
    });
    expect(leaked).toHaveLength(0);
  });

  it("un workspaceId injecté dans le FormData ne peut pas forcer l'audit dans un autre tenant", async () => {
    await signIn(userA);

    // Champ hostile : le client tente de se faire passer pour B.
    const result = await create({
      firstName: "Attaque",
      lastName: "Injection",
      // @ts-expect-error — champ hors schéma, volontairement injecté pour le test
      workspaceId: userB.workspaceId,
    });
    expect(result.status).toBe("success");

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    // L'acteur et le workspace viennent de la session (getActorForAction),
    // jamais du corps de la requête : la ligne appartient à A, pas à B.
    expect(rows[0].workspaceId).toBe(userA.workspaceId);
    expect(rows[0].userId).toBe(userA.userId);

    const forB = await prisma.auditLog.findMany({ where: { workspaceId: userB.workspaceId } });
    expect(forB).toHaveLength(0);
  });

  it("supprimer le workspace de A n'affecte pas le journal de B (cascade scopée)", async () => {
    await signIn(userA);
    await create({ firstName: "A", lastName: "Contact" });
    await signIn(userB);
    await create({ firstName: "B", lastName: "Contact" });

    await prisma.workspace.delete({ where: { id: userA.workspaceId } });

    const remaining = await auditRows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe(userB.workspaceId);
  });
});

describe("acteur et cas limites", () => {
  beforeEach(async () => {
    await resetDatabase();
    dropCookie();
  });

  it("acteur absent : la mutation échoue avant toute écriture, et rien n'est audité", async () => {
    await expect(create({ firstName: "Sans", lastName: "Session" })).rejects.toThrow(UnauthenticatedError);
    expect(await auditRows()).toHaveLength(0);
  });

  it("ressource inexistante : aucune ligne d'audit pour une entité qui n'existe pas", async () => {
    const user = await createWorkspaceWithUser("audit-missing-ws");
    await signIn(user);

    await expect(
      archiveContact(formData({ id: "00000000-0000-0000-0000-000000000000" })),
    ).rejects.toThrow("Contact introuvable.");

    expect(await auditRows()).toHaveLength(0);
  });

  it("requestId non-UUID dans l'en-tête entrant : ignoré, un identifiant valide est généré", async () => {
    const user = await createWorkspaceWithUser("audit-reqid-ws");
    await signIn(user);
    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10", "x-request-id": "not-a-uuid" });

    await create({ firstName: "Test", lastName: "RequestId" });

    const [row] = await auditRows();
    expect(row.requestId).not.toBe("not-a-uuid");
    expect(row.requestId).toMatch(/^[0-9a-f-]{36}$/i);

    // Restaure l'état par défaut pour ne pas influencer d'autres tests.
    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10" });
  });

  it("un en-tête x-request-id valide (UUID) est repris tel quel", async () => {
    const user = await createWorkspaceWithUser("audit-reqid-valid-ws");
    await signIn(user);
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10", "x-request-id": uuid });

    await create({ firstName: "Test", lastName: "RequestId" });

    const [row] = await auditRows();
    expect(row.requestId).toBe(uuid);

    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10" });
  });
});

describe("échecs de validation et de mutation : jamais de fausse ligne d'audit", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("audit-failure-ws");
    await signIn(user);
  });

  it("validation métier échouée (Zod) : aucune ligne créée", async () => {
    const result = await create({ phone: "0612345678", notes: "sans identité" });
    expect(result.status).toBe("error");
    expect(await auditRows()).toHaveLength(0);
  });

  it("échec avant la transaction (sous-traitant introuvable) : ni traitement, ni ligne d'audit", async () => {
    await expect(
      createTreatment(
        formData({
          name: "Traitement test",
          purpose: "Test",
          processorId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toThrow("Sous-traitant introuvable.");

    expect(await prisma.privacyTreatment.count()).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it("panne DB au niveau de la mutation elle-même : rien n'est audité, l'erreur remonte", async () => {
    const spy = vi.spyOn(prisma.organization, "findFirst").mockRejectedValueOnce(new Error("DB down"));

    await expect(create({ firstName: "X", organizationId: "does-not-matter" })).rejects.toThrow("DB down");

    spy.mockRestore();
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("panne d'écriture de l'audit (best-effort)", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("audit-outage-ws");
    await signIn(user);
  });

  it("une panne d'écriture de l'audit ne fait pas échouer la mutation métier", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const auditSpy = vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error("audit db down"));

    const result = await create({ firstName: "Résilient", lastName: "Test" });

    expect(result.status).toBe("success");
    expect(await prisma.contact.count()).toBe(1);
    // L'échec est bien signalé côté serveur...
    expect(errorSpy).toHaveBeenCalled();
    // ...mais la ligne d'audit correspondante n'existe pas : c'est le
    // compromis assumé du best-effort, pas une écriture partielle.
    expect(await auditRows()).toHaveLength(0);

    auditSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("l'erreur de panne n'est jamais journalisée telle quelle (pas de fuite de détails internes)", async () => {
    const sensitive = "postgresql://nodcrm:s3cr3t-password@10.0.0.5:5432/nod_crm";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const auditSpy = vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error(sensitive));

    await create({ firstName: "Résilient", lastName: "Deux" });

    const loggedText = errorSpy.mock.calls.map((call) => call.map((p) => JSON.stringify(p)).join(" ")).join("\n");
    expect(loggedText).not.toContain("s3cr3t-password");
    expect(loggedText).not.toContain("postgresql://");

    auditSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("contenu du journal : rien de plus que le minimum", () => {
  it("aucune donnée personnelle du contact ne se retrouve dans sa ligne d'audit", async () => {
    await resetDatabase();
    const user = await createWorkspaceWithUser("audit-content-ws");
    await signIn(user);

    const secretEmail = "tres-secret@example.com";
    const secretNotes = "Informations confidentielles à ne jamais dupliquer.";
    await create({ firstName: "Confidentiel", lastName: "Contact", email: secretEmail, notes: secretNotes });

    const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      'SELECT * FROM "audit_logs" LIMIT 1',
    );
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain(secretEmail);
    expect(serialized).not.toContain(secretNotes);
    expect(serialized).not.toContain("Confidentiel");

    // Et le jeu de colonnes est bien celui, minimal, du schéma — pas un
    // `metadata` fourre-tout glissé plus tard sans qu'on s'en aperçoive.
    expect(Object.keys(raw[0]).sort()).toEqual(
      ["id", "workspace_id", "user_id", "action", "entity_type", "entity_id", "request_id", "created_at"].sort(),
    );
  });
});
