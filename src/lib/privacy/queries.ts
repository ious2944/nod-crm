import "server-only";

import { buildPrivacyAlerts } from "@/lib/privacy/alerts";
import { prisma } from "@/lib/prisma";
import { getWorkspaceIdForPage } from "@/lib/workspace";

export async function getPrivacyDashboard() {
  const workspaceId = await getWorkspaceIdForPage();

  const [treatments, processors, requests, incidents] = await Promise.all([
    prisma.privacyTreatment.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        legalBasis: true,
        retentionPeriod: true,
        nextReviewAt: true,
        archivedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.privacyProcessor.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        dpaStatus: true,
        eeaStatus: true,
        nextReviewAt: true,
        archivedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.privacyRequest.findMany({
      where: { workspaceId },
      select: {
        id: true,
        requestType: true,
        requesterName: true,
        requesterEmail: true,
        dueAt: true,
        status: true,
      },
      orderBy: { dueAt: "asc" },
    }),
    prisma.privacyIncident.findMany({
      where: { workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        riskLevel: true,
        authorityNotification: true,
      },
      orderBy: { discoveredAt: "desc" },
    }),
  ]);

  return {
    counts: {
      treatments: treatments.filter((item) => !item.archivedAt).length,
      processors: processors.filter((item) => !item.archivedAt).length,
      openRequests: requests.filter(
        (item) => item.status !== "COMPLETED" && item.status !== "REFUSED",
      ).length,
      openIncidents: incidents.filter((item) => item.status !== "CLOSED").length,
    },
    alerts: buildPrivacyAlerts({ treatments, processors, requests, incidents }),
  };
}

export async function listPrivacyTreatments() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.privacyTreatment.findMany({
    where: { workspaceId, archivedAt: null },
    include: {
      processors: {
        include: { processor: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function listPrivacyProcessors() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.privacyProcessor.findMany({
    where: { workspaceId, archivedAt: null },
    include: {
      treatments: {
        include: { treatment: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function listPrivacyRequests() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.privacyRequest.findMany({
    where: { workspaceId },
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true, archivedAt: true },
      },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}

export async function listPrivacyIncidents() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.privacyIncident.findMany({
    where: { workspaceId },
    orderBy: [{ status: "asc" }, { discoveredAt: "desc" }],
  });
}

export async function listPrivacyProcessorOptions() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.privacyProcessor.findMany({
    where: { workspaceId, archivedAt: null },
    select: { id: true, name: true, service: true },
    orderBy: { name: "asc" },
  });
}

export async function listPrivacyContactOptions() {
  const workspaceId = await getWorkspaceIdForPage();
  return prisma.contact.findMany({
    where: { workspaceId, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });
}
