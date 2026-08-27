import { beforeEach, describe, expect, it } from "vitest";

import {
  createIncident,
  createPrivacyRequest,
  createProcessor,
  createTreatment,
  updateIncident,
  updateTreatment,
} from "@/app/(app)/rgpd/actions";
import { prisma } from "@/lib/prisma";
import { listPrivacyTreatments } from "@/lib/privacy/queries";

import {
  createContactRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

function treatmentData(overrides: Record<string, string> = {}) {
  return formData({
    name: "Prospection B2B",
    purpose: "Contacter des prospects professionnels",
    description: "",
    owner: "Commercial",
    dataSubjects: "Prospects",
    dataCategories: "Identité, coordonnées professionnelles",
    legalBasis: "LEGITIMATE_INTEREST",
    retentionPeriod: "3 ans après le dernier contact",
    recipients: "Équipe commerciale",
    transferOutsideEea: "NO",
    securityMeasures: "Accès authentifié",
    lastReviewedAt: "",
    nextReviewAt: "",
    status: "ACTIVE",
    ...overrides,
  });
}

function processorData(overrides: Record<string, string> = {}) {
  return formData({
    name: "CloudCo",
    service: "Hébergement",
    category: "Cloud",
    dataCategories: "Données CRM",
    purpose: "Hébergement applicatif",
    country: "France",
    eeaStatus: "YES",
    dpaStatus: "SIGNED",
    dpaUrl: "",
    subprocessorsStatus: "UNKNOWN",
    notes: "",
    lastReviewedAt: "",
    nextReviewAt: "",
    ...overrides,
  });
}

describe("RGPD Essentials — isolation workspace", () => {
  let alice: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("privacy-alice");
    await signIn(alice);
  });

  it("crée un traitement dans le workspace de la session", async () => {
    await createTreatment(treatmentData());
    const treatment = await prisma.privacyTreatment.findFirstOrThrow();
    expect(treatment.workspaceId).toBe(alice.workspaceId);
  });

  it("ignore un workspaceId injecté par le client", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    const data = treatmentData({ workspaceId: bob.workspaceId });
    await createTreatment(data);
    const treatment = await prisma.privacyTreatment.findFirstOrThrow();
    expect(treatment.workspaceId).toBe(alice.workspaceId);
  });

  it("ne modifie pas un traitement d'un autre workspace", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    const foreign = await prisma.privacyTreatment.create({
      data: { workspaceId: bob.workspaceId, name: "Bob", purpose: "Privé" },
    });

    await updateTreatment(treatmentData({ id: foreign.id, name: "Pwned" }));
    const unchanged = await prisma.privacyTreatment.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(unchanged.name).toBe("Bob");
  });

  it("refuse de lier un sous-traitant d'un autre workspace", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    const foreign = await prisma.privacyProcessor.create({
      data: { workspaceId: bob.workspaceId, name: "Bob Cloud", service: "Cloud" },
    });
    const data = treatmentData();
    data.append("processorId", foreign.id);

    await expect(createTreatment(data)).rejects.toThrow("Sous-traitant introuvable");
    expect(await prisma.privacyTreatment.count({ where: { workspaceId: alice.workspaceId } })).toBe(0);
  });

  it("refuse de rattacher une demande à un contact étranger", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    const foreignContactId = await createContactRecord(bob.workspaceId);

    await expect(
      createPrivacyRequest(
        formData({
          contactId: foreignContactId,
          requesterName: "",
          requesterEmail: "",
          requestType: "ACCESS",
          receivedAt: "2026-08-01",
          dueAt: "2026-09-01",
          status: "RECEIVED",
          owner: "",
          notes: "",
        }),
      ),
    ).rejects.toThrow("Contact introuvable");
  });

  it("les requêtes de liste ne renvoient que le workspace courant", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    await prisma.privacyTreatment.create({
      data: { workspaceId: alice.workspaceId, name: "Alice", purpose: "A" },
    });
    await prisma.privacyTreatment.create({
      data: { workspaceId: bob.workspaceId, name: "Bob", purpose: "B" },
    });

    const treatments = await listPrivacyTreatments();
    expect(treatments).toHaveLength(1);
    expect(treatments[0].name).toBe("Alice");
  });

  it("crée un sous-traitant dans le workspace de la session", async () => {
    await createProcessor(processorData());
    const processor = await prisma.privacyProcessor.findFirstOrThrow();
    expect(processor.workspaceId).toBe(alice.workspaceId);
  });

  it("ne modifie pas un incident d'un autre workspace", async () => {
    const bob = await createWorkspaceWithUser("privacy-bob");
    const incident = await prisma.privacyIncident.create({
      data: {
        workspaceId: bob.workspaceId,
        title: "Incident Bob",
        description: "Description",
        discoveredAt: new Date("2026-08-20"),
      },
    });

    await updateIncident(
      formData({
        id: incident.id,
        title: "Pwned",
        discoveredAt: "2026-08-20",
        occurredAt: "",
        description: "Description modifiée",
        dataCategories: "",
        affectedCount: "",
        consequences: "",
        measures: "",
        riskLevel: "LOW",
        authorityNotification: "NO",
        notifiedAt: "",
        peopleInformed: "NO",
        owner: "",
        status: "CLOSED",
      }),
    );

    const unchanged = await prisma.privacyIncident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(unchanged.title).toBe("Incident Bob");
  });

  it("crée un incident valide pour le workspace courant", async () => {
    await createIncident(
      formData({
        title: "Portable perdu",
        discoveredAt: "2026-08-27",
        occurredAt: "",
        description: "Perte d'un ordinateur portable",
        dataCategories: "Coordonnées",
        affectedCount: "12",
        consequences: "À évaluer",
        measures: "Compte révoqué",
        riskLevel: "TO_ASSESS",
        authorityNotification: "TO_ASSESS",
        notifiedAt: "",
        peopleInformed: "TO_ASSESS",
        owner: "Direction",
        status: "OPEN",
      }),
    );
    expect(await prisma.privacyIncident.count({ where: { workspaceId: alice.workspaceId } })).toBe(1);
  });
});
