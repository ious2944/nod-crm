"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { privacyIdSchema } from "@/lib/privacy/schemas";
import { runCrmAction } from "@/lib/authz/run-crm-action";

function refresh(...paths: string[]) {
  revalidatePath("/rgpd");
  for (const path of paths) revalidatePath(path);
}

export async function restoreTreatment(formData: FormData) {
  return runCrmAction("privacy.treatment.archive", async ({ id: userId, workspaceId }) => {
    const id = privacyIdSchema.parse(formData.get("id"));
    await prisma.privacyTreatment.updateMany({
      where: { id, workspaceId, ownerId: userId },
      data: { archivedAt: null, status: "REVIEW" },
    });
    refresh("/rgpd/treatments");
  });
}

export async function restoreProcessor(formData: FormData) {
  return runCrmAction("privacy.processor.archive", async ({ id: userId, workspaceId }) => {
    const id = privacyIdSchema.parse(formData.get("id"));
    await prisma.privacyProcessor.updateMany({
      where: { id, workspaceId, ownerId: userId },
      data: { archivedAt: null },
    });
    refresh("/rgpd/processors", "/rgpd/treatments");
  });
}
