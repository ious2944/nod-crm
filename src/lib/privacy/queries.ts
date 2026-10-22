import "server-only";

import { buildPrivacyAlerts } from "@/lib/privacy/alerts";
import { prisma } from "@/lib/prisma";
import { crmReadableWhere } from "@/lib/authz/crm-access";
import { getActorForPage } from "@/lib/workspace";

export async function getPrivacyDashboard() {
  const owned = crmReadableWhere(await getActorForPage());
  const now = new Date();
  // Fenêtre d'alerte : demandes proches de leur échéance dans les 7 jours.
  const soon = new Date(now.getTime() + 7 * 86_400_000);

  // Compteurs via SQL — pas de chargement de tous les enregistrements en mémoire.
  const [treatments, processors, openRequests, openIncidents] = await prisma.$transaction([
    prisma.privacyTreatment.count({ where: { ...owned, archivedAt: null } }),
    prisma.privacyProcessor.count({ where: { ...owned, archivedAt: null } }),
    prisma.privacyRequest.count({
      where: { ...owned, status: { notIn: ["COMPLETED", "REFUSED"] } },
    }),
    prisma.privacyIncident.count({ where: { ...owned, status: { not: "CLOSED" } } }),
  ]);

  // Alertes : seuls les enregistrements susceptibles de générer une alerte
  // sont chargés — pas l'ensemble des traitements archivés ni les demandes closes.
  const [treatmentsForAlerts, processorsForAlerts, requestsForAlerts, incidentsForAlerts] =
    await Promise.all([
      // Tout traitement non archivé peut générer une alerte (base légale, conservation, revue).
      prisma.privacyTreatment.findMany({
        where: { ...owned, archivedAt: null },
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
      // Tout sous-traitant non archivé peut générer une alerte (DPA, EEA, revue).
      prisma.privacyProcessor.findMany({
        where: { ...owned, archivedAt: null },
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
      // Seules les demandes ouvertes dont l'échéance est dans la fenêtre d'alerte.
      prisma.privacyRequest.findMany({
        where: {
          ...owned,
          status: { notIn: ["COMPLETED", "REFUSED"] },
          dueAt: { lte: soon },
        },
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
      // Seuls les incidents ouverts peuvent générer une alerte.
      prisma.privacyIncident.findMany({
        where: { ...owned, status: { not: "CLOSED" } },
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
      treatments,
      processors,
      openRequests,
      openIncidents,
    },
    alerts: buildPrivacyAlerts({
      treatments: treatmentsForAlerts,
      processors: processorsForAlerts,
      requests: requestsForAlerts,
      incidents: incidentsForAlerts,
    }),
  };
}

export async function listPrivacyTreatments() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyTreatment.findMany({
    where: { ...owned, archivedAt: null },
    include: {
      processors: {
        include: { processor: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function listArchivedPrivacyTreatments() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyTreatment.findMany({
    where: { ...owned, archivedAt: { not: null } },
    select: { id: true, name: true, archivedAt: true },
    orderBy: { archivedAt: "desc" },
  });
}

export async function listPrivacyProcessors() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyProcessor.findMany({
    where: { ...owned, archivedAt: null },
    include: {
      treatments: {
        include: { treatment: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function listArchivedPrivacyProcessors() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyProcessor.findMany({
    where: { ...owned, archivedAt: { not: null } },
    select: { id: true, name: true, service: true, archivedAt: true },
    orderBy: { archivedAt: "desc" },
  });
}

export async function listPrivacyRequests() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyRequest.findMany({
    where: { ...owned },
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true, archivedAt: true },
      },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}

export async function listPrivacyIncidents() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyIncident.findMany({
    where: { ...owned },
    orderBy: [{ status: "asc" }, { discoveredAt: "desc" }],
  });
}

export async function listPrivacyProcessorOptions() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.privacyProcessor.findMany({
    where: { ...owned, archivedAt: null },
    select: { id: true, name: true, service: true },
    orderBy: { name: "asc" },
  });
}

export async function listPrivacyContactOptions() {
  const owned = crmReadableWhere(await getActorForPage());
  return prisma.contact.findMany({
    where: { ...owned, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });
}
