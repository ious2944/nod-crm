"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ENTITY_TYPES } from "@/lib/audit/types";
import { prisma } from "@/lib/prisma";
import {
  incidentSchema,
  privacyIdSchema,
  processorSchema,
  requestSchema,
  treatmentSchema,
  updateRequestSchema,
} from "@/lib/privacy/schemas";
import type { ProcessorFormState } from "@/lib/privacy/processor-form-state";
import { getActorForAction } from "@/lib/workspace";

// `.parse()` throws the raw ZodError straight into the Server Action's
// rejection, which is what the segment's error.tsx ends up catching. It
// works, but it's an implementation detail leaking out as the failure mode:
// the message is whatever Zod's default formatting produces, not something
// this module chose. `safeParse` plus this helper makes the failure explicit
// and gives every schema in this file one place from which its errors read
// the same way — a normal thrown Error with a message this module wrote.
function parseOrThrow<Schema extends z.ZodTypeAny>(
  schema: Schema,
  data: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first
      ? `${String(first.path[0] ?? "champ")} : ${first.message}`
      : "valeur invalide";

    throw new Error(`Formulaire invalide (${detail}).`);
  }

  return parsed.data;
}

function revalidatePrivacy(...paths: string[]) {
  revalidatePath("/rgpd");

  for (const path of paths) {
    revalidatePath(path);
  }
}

function processorIdsFrom(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("processorId")
        .map(String)
        .filter(Boolean),
    ),
  ].map((value) => parseOrThrow(privacyIdSchema, value));
}

async function assertProcessors(workspaceId: string, ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  const count = await prisma.privacyProcessor.count({
    where: {
      workspaceId,
      id: { in: ids },
      archivedAt: null,
    },
  });

  if (count !== ids.length) {
    throw new Error("Sous-traitant introuvable.");
  }
}

async function assertContact(
  workspaceId: string,
  contactId: string | undefined,
) {
  if (!contactId) {
    return null;
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      workspaceId,
      archivedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!contact) {
    throw new Error("Contact introuvable.");
  }

  return contact.id;
}

export async function createTreatment(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    treatmentSchema,
    Object.fromEntries(formData),
  );

  const processorIds = processorIdsFrom(formData);

  await assertProcessors(workspaceId, processorIds);

  const treatment = await prisma.$transaction(async (tx) => {
    const createdTreatment = await tx.privacyTreatment.create({
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
      select: {
        id: true,
      },
    });

    if (processorIds.length > 0) {
      await tx.privacyTreatmentProcessor.createMany({
        data: processorIds.map((processorId) => ({
          workspaceId,
          treatmentId: createdTreatment.id,
          processorId,
        })),
      });
    }

    return createdTreatment;
  });

  await recordAudit({
    workspaceId,
    userId,
    action: "CREATE",
    entityType: AUDIT_ENTITY_TYPES.PRIVACY_TREATMENT,
    entityId: treatment.id,
  });

  revalidatePrivacy("/rgpd/treatments", "/rgpd/processors");
}

export async function updateTreatment(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    treatmentSchema.extend({
      id: privacyIdSchema,
    }),
    Object.fromEntries(formData),
  );

  const processorIds = processorIdsFrom(formData);

  await assertProcessors(workspaceId, processorIds);

  const existing = await prisma.privacyTreatment.findFirst({
    where: {
      id: parsed.id,
      workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.privacyTreatment.updateMany({
      where: {
        id: parsed.id,
        workspaceId,
      },
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
      where: {
        workspaceId,
        treatmentId: parsed.id,
      },
    });

    if (processorIds.length > 0) {
      await tx.privacyTreatmentProcessor.createMany({
        data: processorIds.map((processorId) => ({
          workspaceId,
          treatmentId: parsed.id,
          processorId,
        })),
      });
    }
  });

  await recordAudit({
    workspaceId,
    userId,
    action: "UPDATE",
    entityType: AUDIT_ENTITY_TYPES.PRIVACY_TREATMENT,
    entityId: parsed.id,
  });

  revalidatePrivacy("/rgpd/treatments", "/rgpd/processors");
}

export async function archiveTreatment(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const id = parseOrThrow(
    privacyIdSchema,
    formData.get("id"),
  );

  const result = await prisma.privacyTreatment.updateMany({
    where: {
      id,
      workspaceId,
    },
    data: {
      archivedAt: new Date(),
      status: "ARCHIVED",
    },
  });

  if (result.count > 0) {
    await recordAudit({
      workspaceId,
      userId,
      action: "ARCHIVE",
      entityType: AUDIT_ENTITY_TYPES.PRIVACY_TREATMENT,
      entityId: id,
    });
  }

  revalidatePrivacy("/rgpd/treatments");
}

export async function createProcessor(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    processorSchema,
    Object.fromEntries(formData),
  );

  const processor = await prisma.privacyProcessor.create({
    data: {
      workspaceId,
      name: parsed.name,
      service: parsed.service,
      category: parsed.category,
      dataCategories: parsed.dataCategories,
      purpose: parsed.purpose,
      country: parsed.country,
      eeaStatus: parsed.eeaStatus,
      dpaStatus: parsed.dpaStatus,
      dpaUrl: parsed.dpaUrl,
      subprocessorsStatus: parsed.subprocessorsStatus,
      notes: parsed.notes,
      lastReviewedAt: parsed.lastReviewedAt,
      nextReviewAt: parsed.nextReviewAt,
    },
    select: {
      id: true,
    },
  });

  await recordAudit({
    workspaceId,
    userId,
    action: "CREATE",
    entityType: AUDIT_ENTITY_TYPES.PRIVACY_PROCESSOR,
    entityId: processor.id,
  });

  revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
}

/**
 * Met à jour un sous-traitant existant.
 *
 * Signature compatible avec `useActionState` : `(prevState, formData) => state`.
 * Retourne un état explicite au lieu de lancer une exception, afin que le
 * composant client puisse afficher le feedback directement.
 */
export async function updateProcessor(
  _prevState: ProcessorFormState,
  formData: FormData,
): Promise<ProcessorFormState> {
  try {
    const { id: userId, workspaceId } = await getActorForAction();

    const parsed = parseOrThrow(
      processorSchema.extend({
        id: privacyIdSchema,
      }),
      Object.fromEntries(formData),
    );

    const { id, ...data } = parsed;

    const result = await prisma.privacyProcessor.updateMany({
      where: {
        id,
        workspaceId,
      },
      data,
    });

    if (result.count > 0) {
      await recordAudit({
        workspaceId,
        userId,
        action: "UPDATE",
        entityType: AUDIT_ENTITY_TYPES.PRIVACY_PROCESSOR,
        entityId: id,
      });
    }

    revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
    return { status: "success", message: "Modifications enregistrées." };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
    return { status: "error", message };
  }
}

export async function archiveProcessor(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const id = parseOrThrow(
    privacyIdSchema,
    formData.get("id"),
  );

  const [result] = await prisma.$transaction([
    prisma.privacyProcessor.updateMany({
      where: {
        id,
        workspaceId,
      },
      data: {
        archivedAt: new Date(),
      },
    }),

    prisma.privacyTreatmentProcessor.deleteMany({
      where: {
        workspaceId,
        processorId: id,
      },
    }),
  ]);

  if (result.count > 0) {
    await recordAudit({
      workspaceId,
      userId,
      action: "ARCHIVE",
      entityType: AUDIT_ENTITY_TYPES.PRIVACY_PROCESSOR,
      entityId: id,
    });
  }

  revalidatePrivacy("/rgpd/processors", "/rgpd/treatments");
}

export async function createPrivacyRequest(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    requestSchema,
    Object.fromEntries(formData),
  );

  const contactId = await assertContact(
    workspaceId,
    parsed.contactId || undefined,
  );

  const closed =
    parsed.status === "COMPLETED" ||
    parsed.status === "REFUSED";

  const request = await prisma.privacyRequest.create({
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
    select: {
      id: true,
    },
  });

  await recordAudit({
    workspaceId,
    userId,
    action: "CREATE",
    entityType: AUDIT_ENTITY_TYPES.PRIVACY_REQUEST,
    entityId: request.id,
  });

  revalidatePrivacy("/rgpd/requests");
}

export async function updatePrivacyRequest(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    updateRequestSchema,
    Object.fromEntries(formData),
  );

  const contactId = await assertContact(
    workspaceId,
    parsed.contactId || undefined,
  );

  const closed =
    parsed.status === "COMPLETED" ||
    parsed.status === "REFUSED";

  const result = await prisma.privacyRequest.updateMany({
    where: {
      id: parsed.id,
      workspaceId,
    },
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

  if (result.count > 0) {
    await recordAudit({
      workspaceId,
      userId,
      action: "UPDATE",
      entityType: AUDIT_ENTITY_TYPES.PRIVACY_REQUEST,
      entityId: parsed.id,
    });
  }

  revalidatePrivacy("/rgpd/requests");
}

export async function createIncident(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    incidentSchema,
    Object.fromEntries(formData),
  );

  const closed = parsed.status === "CLOSED";

  const incident = await prisma.privacyIncident.create({
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
    select: {
      id: true,
    },
  });

  await recordAudit({
    workspaceId,
    userId,
    action: "CREATE",
    entityType: AUDIT_ENTITY_TYPES.PRIVACY_INCIDENT,
    entityId: incident.id,
  });

  revalidatePrivacy("/rgpd/incidents");
}

export async function updateIncident(formData: FormData) {
  const { id: userId, workspaceId } = await getActorForAction();

  const parsed = parseOrThrow(
    incidentSchema.extend({
      id: privacyIdSchema,
    }),
    Object.fromEntries(formData),
  );

  const closed = parsed.status === "CLOSED";

  const result = await prisma.privacyIncident.updateMany({
    where: {
      id: parsed.id,
      workspaceId,
    },
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

  if (result.count > 0) {
    await recordAudit({
      workspaceId,
      userId,
      action: "UPDATE",
      entityType: AUDIT_ENTITY_TYPES.PRIVACY_INCIDENT,
      entityId: parsed.id,
    });
  }

  revalidatePrivacy("/rgpd/incidents");
}