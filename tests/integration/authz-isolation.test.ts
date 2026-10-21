import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { updateOpportunity } from "@/app/(app)/commerce/actions";
import { archiveContact } from "@/app/(app)/contacts/actions";
import { importContacts } from "@/app/(app)/contacts/import-actions";
import { updateFollowUp } from "@/app/(app)/follow-ups/actions";
import { updateOrganization } from "@/app/(app)/organizations/actions";
import { archiveTreatment, updateProcessor } from "@/app/(app)/rgpd/actions";
import { applyTaskAction } from "@/app/(app)/tasks/actions";
import {
  createProjectAction,
  createTagAction,
  deleteTagAction,
  updateProjectAction,
  updateTaskAction,
} from "@/app/(app)/tasks/work-actions";
import { POST as attachmentPost } from "@/app/api/tasks/items/[id]/attachments/route";
import { initialUpdateOpportunityState } from "@/lib/commerce/create-state";
import { initialEditFollowUpState } from "@/lib/follow-ups/edit-state";
import { initialOrganizationFormState } from "@/lib/organizations/form-state";
import { prisma } from "@/lib/prisma";
import { initialProcessorFormState } from "@/lib/privacy/processor-form-state";
import type { ActionResult } from "@/lib/tasks/types";

import {
  createContactRecord,
  createFollowUpRecord,
  createOpportunityRecord,
  createOrganizationRecord,
  createTaskRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
  defaultOwnerId,
} from "./fixtures";

/**
 * Isolation A/B, une action par module, depuis le point de contrôle central
 * (`src/lib/authz`, lot 0).
 *
 * Bob (espace B) vise l'identifiant exact d'une donnée d'Alice (espace A).
 * Chaque cas vérifie deux choses : la réponse est **celle d'avant le lot 0**
 * (même message, même code, même absence d'erreur quand l'action était déjà
 * silencieuse), et la donnée d'Alice n'a pas bougé.
 */

const FIXTURE = path.resolve(__dirname, "../fixtures/outlook/contacts-outlook-fixture.csv");

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`Action refusée : ${result.error}`);
  return result.data;
}

function csvUpload(mode: "skip" | "complete"): FormData {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(readFileSync(FIXTURE)) as BlobPart], "contacts.csv", { type: "text/csv" }));
  data.set("mode", mode);
  return data;
}

describe("point de contrôle central : isolation A/B par module", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("authz-alice");
    bob = await createWorkspaceWithUser("authz-bob");
  });

  it("commerce : modifier l'opportunité d'Alice → « introuvable », rien n'est écrit", async () => {
    const orgA = await createOrganizationRecord(alice.workspaceId);
    const oppA = await createOpportunityRecord(alice.workspaceId, orgA, { name: "Affaire d'Alice" });
    const orgB = await createOrganizationRecord(bob.workspaceId);
    await signIn(bob);

    const state = await updateOpportunity(
      initialUpdateOpportunityState,
      formData({ id: oppA, name: "Volée", organizationId: orgB, contactId: "", estimatedAmount: "", expectedCloseDate: "", notes: "" }),
    );

    expect(state).toEqual({
      status: "error",
      message: "Cette opportunité est introuvable.",
      fieldErrors: { id: "Opportunité introuvable." },
    });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: oppA } })).name).toBe("Affaire d'Alice");
  });

  it("contacts : archiver le contact d'Alice → « Contact introuvable. »", async () => {
    const contactA = await createContactRecord(alice.workspaceId);
    await signIn(bob);

    await expect(archiveContact(formData({ id: contactA }))).rejects.toThrow("Contact introuvable.");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactA } })).archivedAt).toBeNull();
  });

  it("import : les contacts d'Alice ne sont ni vus comme doublons ni complétés", async () => {
    await signIn(alice);
    const first = await importContacts(csvUpload("skip"));
    const aliceBefore = await prisma.contact.findMany({ where: { workspaceId: alice.workspaceId }, orderBy: { id: "asc" } });

    await signIn(bob);
    const second = await importContacts(csvUpload("complete"));

    // Bob part d'un espace vierge : exactement le même résultat qu'Alice.
    expect(second).toEqual(first);
    expect(await prisma.contact.findMany({ where: { workspaceId: alice.workspaceId }, orderBy: { id: "asc" } })).toEqual(aliceBefore);
  });

  it("suivis : modifier le suivi d'Alice → « Suivi introuvable. »", async () => {
    const followUpA = await createFollowUpRecord(alice.workspaceId, "Suivi d'Alice");
    await signIn(bob);

    const state = await updateFollowUp(
      initialEditFollowUpState,
      formData({ id: followUpA, title: "Volé", description: "", dueDate: "2026-12-01", contactId: "" }),
    );

    expect(state).toEqual({ status: "error", message: "Suivi introuvable." });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: followUpA } })).title).toBe("Suivi d'Alice");
  });

  it("organisations : modifier l'organisation d'Alice → « n'existe pas »", async () => {
    const orgA = await createOrganizationRecord(alice.workspaceId, { name: "Org d'Alice" });
    await signIn(bob);

    const state = await updateOrganization(
      initialOrganizationFormState,
      formData({ id: orgA, name: "Volée", website: "", phone: "", email: "", notes: "" }),
    );

    expect(state).toEqual({ status: "error", message: "Cette organisation n'existe pas." });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).name).toBe("Org d'Alice");
  });

  it("RGPD : viser un traitement ou un sous-traitant d'Alice n'a aucun effet (réponse inchangée)", async () => {
    const treatmentA = await prisma.privacyTreatment.create({
      data: { workspaceId: alice.workspaceId, ownerId: await defaultOwnerId(alice.workspaceId), name: "Traitement d'Alice", purpose: "Prospection" },
      select: { id: true },
    });
    const processorA = await prisma.privacyProcessor.create({
      data: { workspaceId: alice.workspaceId, ownerId: await defaultOwnerId(alice.workspaceId), name: "CloudCo", service: "Hébergement" },
      select: { id: true },
    });
    await signIn(bob);

    // Comportement historique : `updateMany` borné à l'espace, sans erreur.
    await expect(archiveTreatment(formData({ id: treatmentA.id }))).resolves.toBeUndefined();
    const state = await updateProcessor(
      initialProcessorFormState,
      formData({
        id: processorA.id,
        name: "Volé",
        service: "Hébergement",
        category: "",
        dataCategories: "",
        purpose: "",
        country: "",
        eeaStatus: "YES",
        dpaStatus: "SIGNED",
        dpaUrl: "",
        subprocessorsStatus: "UNKNOWN",
        notes: "",
        lastReviewedAt: "",
        nextReviewAt: "",
      }),
    );
    expect(state).toEqual({ status: "success", message: "Modifications enregistrées." });

    expect((await prisma.privacyTreatment.findUniqueOrThrow({ where: { id: treatmentA.id } })).archivedAt).toBeNull();
    expect((await prisma.privacyProcessor.findUniqueOrThrow({ where: { id: processorA.id } })).name).toBe("CloudCo");
    expect(await prisma.auditLog.count({ where: { workspaceId: bob.workspaceId } })).toBe(0);
  });

  it("tâches : modifier une tâche d'Alice → NOT_FOUND (action V1 et action rapide historique)", async () => {
    const taskA = await createTaskRecord(alice.workspaceId, { title: "Tâche d'Alice" });
    await signIn(bob);

    expect(await updateTaskAction(taskA, { title: "Volée" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      error: "Élément introuvable.",
    });
    await expect(applyTaskAction(formData({ id: taskA, intent: "complete" }))).rejects.toThrow("Tâche introuvable.");

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskA } });
    expect(task.title).toBe("Tâche d'Alice");
    expect(task.completedAt).toBeNull();
  });

  it("tâches : envoyer une pièce jointe sur une tâche d'Alice → 404", async () => {
    const taskA = await createTaskRecord(alice.workspaceId);
    await signIn(bob);

    const body = new FormData();
    body.append("file", new File([new TextEncoder().encode("contenu")], "note.txt"));
    const response = await attachmentPost(
      new Request(`http://localhost/api/tasks/items/${taskA}/attachments`, {
        method: "POST",
        body,
        headers: { origin: "http://localhost", host: "localhost" },
      }),
      { params: Promise.resolve({ id: taskA }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Élément introuvable." });
    expect(await prisma.taskAttachment.count()).toBe(0);
  });

  it("projets : modifier le projet d'Alice → NOT_FOUND", async () => {
    await signIn(alice);
    const projectId = ok(await createProjectAction({ name: "Projet d'Alice" }));
    await signIn(bob);

    expect(await updateProjectAction(projectId, { name: "Volé" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      error: "Projet introuvable.",
    });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).name).toBe("Projet d'Alice");
  });

  it("espace : supprimer une étiquette d'Alice → refus identique, l'étiquette reste", async () => {
    await signIn(alice);
    const tag = ok(await createTagAction({ name: "alice" }));
    await signIn(bob);

    expect(await deleteTagAction(tag.id)).toEqual({ ok: false, code: "NOT_FOUND", error: "Élément introuvable." });
    expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(1);
  });
});
