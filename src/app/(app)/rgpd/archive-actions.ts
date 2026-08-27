"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { privacyIdSchema } from "@/lib/privacy/schemas";
import { getWorkspaceIdForAction } from "@/lib/workspace";

function refresh(...paths: string[]) {
  revalidatePath("/rgpd");
  for (const path of paths) revalidatePath(path);
}

export async function restoreTreatment(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const id = privacyIdSchema.parse(formData.get("id"));
  await prisma.privacyTreatment.updateMany({
    where: { id, workspaceId },
    data: { archivedAt: null, status: "REVIEW" },
  });
  refresh("/rgpd/treatments");
}

export async function restoreProcessor(formData: FormData) {
  const workspaceId = await getWorkspaceIdForAction();
  const id = privacyIdSchema.parse(formData.get("id"));
  await prisma.privacyProcessor.updateMany({
    where: { id, workspaceId },
    data: { archivedAt: null },
  });
  refresh("/rgpd/processors", "/rgpd/treatments");
}
