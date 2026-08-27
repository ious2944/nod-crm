import { beforeEach, describe, expect, it } from "vitest";

import { restoreProcessor, restoreTreatment } from "@/app/(app)/rgpd/archive-actions";
import { archiveProcessor, archiveTreatment } from "@/app/(app)/rgpd/actions";
import { prisma } from "@/lib/prisma";

import { createWorkspaceWithUser, formData, resetDatabase, signIn, type TestUser } from "./fixtures";

describe("RGPD Essentials — archive / restore", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("privacy-archive");
    await signIn(user);
  });

  it("archive puis restaure un traitement du workspace", async () => {
    const item = await prisma.privacyTreatment.create({
      data: { workspaceId: user.workspaceId, name: "Support", purpose: "Support client" },
    });

    await archiveTreatment(formData({ id: item.id }));
    expect((await prisma.privacyTreatment.findUniqueOrThrow({ where: { id: item.id } })).archivedAt).not.toBeNull();

    await restoreTreatment(formData({ id: item.id }));
    const restored = await prisma.privacyTreatment.findUniqueOrThrow({ where: { id: item.id } });
    expect(restored.archivedAt).toBeNull();
    expect(restored.status).toBe("REVIEW");
  });

  it("ne restaure pas le traitement d'un autre workspace", async () => {
    const foreignUser = await createWorkspaceWithUser("privacy-archive-other");
    const foreign = await prisma.privacyTreatment.create({
      data: {
        workspaceId: foreignUser.workspaceId,
        name: "Foreign",
        purpose: "Foreign",
        status: "ARCHIVED",
        archivedAt: new Date(),
      },
    });

    await restoreTreatment(formData({ id: foreign.id }));
    expect((await prisma.privacyTreatment.findUniqueOrThrow({ where: { id: foreign.id } })).archivedAt).not.toBeNull();
  });

  it("archive puis restaure un sous-traitant du workspace", async () => {
    const processor = await prisma.privacyProcessor.create({
      data: { workspaceId: user.workspaceId, name: "Cloud", service: "Hosting" },
    });

    await archiveProcessor(formData({ id: processor.id }));
    expect((await prisma.privacyProcessor.findUniqueOrThrow({ where: { id: processor.id } })).archivedAt).not.toBeNull();

    await restoreProcessor(formData({ id: processor.id }));
    expect((await prisma.privacyProcessor.findUniqueOrThrow({ where: { id: processor.id } })).archivedAt).toBeNull();
  });

  it("ne restaure pas le sous-traitant d'un autre workspace", async () => {
    const foreignUser = await createWorkspaceWithUser("privacy-archive-other");
    const foreign = await prisma.privacyProcessor.create({
      data: {
        workspaceId: foreignUser.workspaceId,
        name: "Foreign Cloud",
        service: "Hosting",
        archivedAt: new Date(),
      },
    });

    await restoreProcessor(formData({ id: foreign.id }));
    expect((await prisma.privacyProcessor.findUniqueOrThrow({ where: { id: foreign.id } })).archivedAt).not.toBeNull();
  });
});
