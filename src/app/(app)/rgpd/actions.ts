"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import {
  incidentSchema,
  privacyIdSchema,
  processorSchema,
  requestSchema,
  treatmentSchema,
  updateRequestSchema,
} from "@/lib/privacy/schemas";
import { getWorkspaceIdForAction } from "@/lib/workspace";

function revalidatePrivacy(...paths: string[]) {
  revalidatePath("/rgpd");
  for (const path of paths) revalidatePath(path);
}

function processorIdsFrom(formData: FormData) {
  return [...new Set(formData.getAll("processorId").map(String).filter(Boolean))].map((value) =>
    privacyIdSchema.parse(value),
  );
}

async function assertProcessors(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return;
  const count = await prisma.privacyProcessor.count({
    where: { workspaceId, id: { in: ids }, archivedAt: null },
  });
  if (count !== ids.length) throw new Error("Sous-traitant introuvable.");
}

async function assertContact(workspaceId: string, contactId: string | undefined) {
  if (!contactId) return null;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!contact) throw new Error("Contact introuvable.");
  return contact.id;
}

export async function createTreatment(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = treatmentSchema.parse(Object.fromEntries(formData));
  const processorIds = processorIdsFrom(formData);
  await assertProcessors(workspaceId, processorIds);

  await prisma.$transaction(async (tx) => {
    const treatment = await tx.privacyTreatment.create({
      data: {
        workspaceId,
        name: parsed.name,
        purpose: parsed.purpose,
        description: parsed.description,
        owner: parsed.owner,
        dataSubjects: parsed.dataSubjects,
        dataCategories: parsed.dataCategories,
        legalBasis: parsed.legalBasis,
        retentionPeriod: parsed.retentionPeriod,
        recipients: parsed.recipients,
        transferOutsideEea: parsed.transferOutsideEea,
        securityMeasures: parsed.securityMeasures,
        lastReviewedAt: parsed.lastReviewedAt,
        nextReviewAt: parsed.nextReviewAt,
        status: parsed.status,
        archivedAt: parsed.status === "ARCHIVED" ? new Date() : null,
      },
      select: { id: true },
    });

    if (processorIds.length) {
      await tx.privacyTreatmentProcessor.createMany({
        data: processorIds.map((processorId) => ({
          workspaceId,
          treatmentId: treatment.id,
          processorId,
        })),
      });
    }
  });

  revalidatePrivacy("/rgpd/treatments", "/rgpd/processors");
}

export async function updateTreatment(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = treatmentSchema.extend({ id: privacyIdSchema }).parse(Object.fromEntries(formData));
  const processorIds = processorIdsFrom(formData);
  await assertProcessors(workspaceId, processorIds);

  const existing = await prisma.privacyTreatment.findFirst({
    where: { id: parsed.id, workspaceId },
    select: { id: true },
  });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    await tx.privacyTreatment.updateMany({
      where: { id: parsed.id, workspaceId },
      data: {
        name: parsed.name,
        purpose: parsed.purpose,
        description: parsed.description,
        owner: parsed.owner,
        dataSubjects: parsed.dataSubjects,
        dataCategories: parsed.dataCategories,
        legalBasis: parsed.legalBasis,
        retentionPeriod: parsed.retentionPeriod,
        recipients: parsed.recipients,
        transferOutsideEea: parsed.transferOutsideEea,
        securityMeasures: parsed.securityMeasures,
        lastReviewedAt: parsed.lastReviewedAt,
        nextReviewAt: parsed.nextReviewAt,
        status: parsed.status,
        archivedAt: parsed.status === "ARCHIVED" ? new Date() : null,
      },
    });
    await tx.privacyTreatmentProcessor.deleteMany({
      where: { workspaceId, treatmentId: parsed.id },
    });
    if (processorIds.length) {
      await tx.privacyTreatmentProcessor.createMany({
        data: processorIds.map((processorId) => ({ workspaceId, treatmentId: parsed.id, processorId })),
      });
    }
  });

  revalidatePrivacy("/rgpd/treatments", "/rgpd/processors");
}

export async function archiveTreatment(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const id = privacyIdSchema.parse(formData.get("id"));
  await prisma.privacyTreatment.updateMany({
    where: { id, workspaceId },
    data: { archivedAt: new Date(), status: "ARCHIVED" },
  });
  revalidatePrivacy("/rgpd/treatments");
}

export async function createProcessor(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = processorSchema.parse(Object.fromEntries(formData));
  const { id: _ignored, ...data } = parsed;
  await prisma.privacyProcessor.create({ data: { workspaceId, ...data } });
  revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
}

export async function updateProcessor(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = processorSchema.extend({ id: privacyIdSchema }).parse(Object.fromEntries(formData));
  const { id, ...data } = parsed;
  await prisma.privacyProcessor.updateMany({ where: { id, workspaceId }, data });
  revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
}

export async function archiveProcessor(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const id = privacyIdSchema.parse(formData.get("id"));
  await prisma.$transaction([
    prisma.privacyProcessor.updateMany({ where: { id, workspaceId }, data: { archivedAt: new Date() } }),
    prisma.privacyTreatmentProcessor.deleteMany({ where: { workspaceId, processorId: id } }),
  ]);
  revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
}

export async function createPrivacyRequest(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = requestSchema.parse(Object.fromEntries(formData));
  const contactId = await assertContact(workspaceId, parsed.contactId || undefined);
  const closed = parsed.status === "COMPLETED" || parsed.status === "REFUSED";

  await prisma.privacyRequest.create({
    data: {
      workspaceId,
      contactId,
      requesterName: parsed.requesterName,
      requesterEmail: parsed.requesterEmail || undefined,
      requestType: parsed.requestType,
      receivedAt: parsed.receivedAt,
      dueAt: parsed.dueAt,
      status: parsed.status,
      owner: parsed.owner,
      notes: parsed.notes,
      closedAt: closed ? new Date() : null,
    },
  });
  revalidatePrivacy("/rgpd/requests");
}

export async function updatePrivacyRequest(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = updateRequestSchema.parse(Object.fromEntries(formData));
  const contactId = await assertContact(workspaceId, parsed.contactId || undefined);
  const closed = parsed.status === "COMPLETED" || parsed.status === "REFUSED";

  await prisma.privacyRequest.updateMany({
    where: { id: parsed.id, workspaceId },
    data: {
      contactId,
      requesterName: parsed.requesterName,
      requesterEmail: parsed.requesterEmail || null,
      requestType: parsed.requestType,
      receivedAt: parsed.receivedAt,
      dueAt: parsed.dueAt,
      status: parsed.status,
      owner: parsed.owner,
      notes: parsed.notes,
      closedAt: closed ? new Date() : null,
    },
  });
  revalidatePrivacy("/rgpd/requests");
}

export async function createIncident(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = incidentSchema.parse(Object.fromEntries(formData));
  const closed = parsed.status === "CLOSED";
  await prisma.privacyIncident.create({
    data: {
      workspaceId,
      title: parsed.title,
      discoveredAt: parsed.discoveredAt,
      occurredAt: parsed.occurredAt,
      description: parsed.description,
      dataCategories: parsed.dataCategories,
      affectedCount: parsed.affectedCount,
      consequences: parsed.consequences,
      measures: parsed.measures,
      riskLevel: parsed.riskLevel,
      authorityNotification: parsed.authorityNotification,
      notifiedAt: parsed.notifiedAt,
      peopleInformed: parsed.peopleInformed,
      owner: parsed.owner,
      status: parsed.status,
      closedAt: closed ? new Date() : null,
    },
  });
  revalidatePrivacy("/rgpd/incidents");
}

export async function updateIncident(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const parsed = incidentSchema.extend({ id: privacyIdSchema }).parse(Object.fromEntries(formData));
  const closed = parsed.status === "CLOSED";
  await prisma.privacyIncident.updateMany({
    where: { id: parsed.id, workspaceId },
    data: {
      title: parsed.title,
      discoveredAt: parsed.discoveredAt,
      occurredAt: parsed.occurredAt,
      description: parsed.description,
      dataCategories: parsed.dataCategories,
      affectedCount: parsed.affectedCount,
      consequences: parsed.consequences,
      measures: parsed.measures,
      riskLevel: parsed.riskLevel,
      authorityNotification: parsed.authorityNotification,
      notifiedAt: parsed.notifiedAt,
      peopleInformed: parsed.peopleInformed,
      owner: parsed.owner,
      status: parsed.status,
      closedAt: closed ? new Date() : null,
    },
  });
  revalidatePrivacy("/rgpd/incidents");
}
