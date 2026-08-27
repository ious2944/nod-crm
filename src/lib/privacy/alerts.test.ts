import { describe, expect, it } from "vitest";

import { buildPrivacyAlerts } from "@/lib/privacy/alerts";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function empty() {
  return { treatments: [], processors: [], requests: [], incidents: [], now: NOW };
}

describe("buildPrivacyAlerts", () => {
  it("signale base légale et conservation manquantes", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      treatments: [{
        id: "t1",
        name: "Prospection",
        legalBasis: "TO_DETERMINE",
        retentionPeriod: null,
        nextReviewAt: null,
        archivedAt: null,
      }],
    });
    expect(alerts.map((a) => a.key)).toContain("treatment-legal-t1");
    expect(alerts.map((a) => a.key)).toContain("treatment-retention-t1");
  });

  it("ignore un traitement archivé", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      treatments: [{
        id: "t1",
        name: "Ancien",
        legalBasis: "TO_DETERMINE",
        retentionPeriod: null,
        nextReviewAt: NOW,
        archivedAt: NOW,
      }],
    });
    expect(alerts).toHaveLength(0);
  });

  it("classe une demande échue en urgent", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      requests: [{
        id: "r1",
        requestType: "ACCESS",
        requesterName: "Alice",
        requesterEmail: null,
        dueAt: new Date("2026-08-25T12:00:00.000Z"),
        status: "IN_PROGRESS",
      }],
    });
    expect(alerts[0]).toMatchObject({ severity: "urgent", href: "/rgpd/requests" });
  });

  it("ne signale pas une demande terminée", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      requests: [{
        id: "r1",
        requestType: "ACCESS",
        requesterName: "Alice",
        requesterEmail: null,
        dueAt: new Date("2026-08-25T12:00:00.000Z"),
        status: "COMPLETED",
      }],
    });
    expect(alerts).toHaveLength(0);
  });

  it("signale un incident dont l'évaluation reste à faire", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      incidents: [{
        id: "i1",
        title: "Perte ordinateur",
        status: "OPEN",
        riskLevel: "TO_ASSESS",
        authorityNotification: "TO_ASSESS",
      }],
    });
    expect(alerts[0]).toMatchObject({ severity: "urgent", href: "/rgpd/incidents" });
  });

  it("signale DPA manquant et localisation inconnue", () => {
    const alerts = buildPrivacyAlerts({
      ...empty(),
      processors: [{
        id: "p1",
        name: "CloudCo",
        dpaStatus: "MISSING",
        eeaStatus: "UNKNOWN",
        nextReviewAt: null,
        archivedAt: null,
      }],
    });
    expect(alerts.filter((a) => a.severity === "warning")).toHaveLength(2);
  });
});
