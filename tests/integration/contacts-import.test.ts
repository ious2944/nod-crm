import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { importContacts, previewContactImport } from "@/app/(app)/contacts/import-actions";
import { UnauthenticatedError } from "@/lib/auth/dal";
import { IMPORT_MAX_BYTES } from "@/lib/contacts/import/limits";
import { prisma } from "@/lib/prisma";

import {
  createContactRecord,
  createOrganizationRecord,
  createWorkspaceWithUser,
  dropCookie,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Import CSV Outlook, de bout en bout : vraie base, vraies Server Actions.
 *
 * Le fichier de référence (`tests/fixtures/outlook/`) est lu tel quel, octet
 * pour octet : son BOM et ses CRLF font partie de ce qui est testé.
 */

const FIXTURE = path.resolve(__dirname, "../fixtures/outlook/contacts-outlook-fixture.csv");
const fixtureBytes = () => new Uint8Array(readFileSync(FIXTURE));

function upload(bytes: Uint8Array, fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("file", new File([bytes as BlobPart], "contacts.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const csvBytes = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));

async function contactsOf(workspaceId: string) {
  return prisma.contact.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }, { lastName: "asc" }],
  });
}

async function previewOk(data: FormData) {
  const result = await previewContactImport(data);
  if (!result.ok) throw new Error(result.error);
  return result.preview;
}

describe("import de contacts Outlook", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-import");
    bob = await createWorkspaceWithUser("bob-import");
    await signIn(alice);
  });

  describe("fichier de référence", () => {
    it("l'aperçu analyse sans rien écrire", async () => {
      const preview = await previewOk(upload(fixtureBytes()));

      expect(preview).toMatchObject({
        encoding: "utf-8",
        rowCount: 4,
        toCreate: 3,
        existingDuplicates: [],
        errorCount: 0,
        warningCount: 0,
        unknownColumns: [],
      });
      expect(preview.recognizedColumns.length + preview.ignoredColumns.length).toBe(61);
      expect(preview.ignoredColumns).toEqual(
        expect.arrayContaining(["Given Yomi", "Surname Yomi", "Telex", "Pager", "Home Street", "Spouse", "Anniversary"]),
      );
      expect(preview.fileDuplicates).toEqual([
        {
          line: 4,
          keptLine: 2,
          email: "jean.dupont@EXEMPLE.fr",
          lost: [
            { label: "Prénom", value: "Marc" },
            { label: "Nom", value: "Martin" },
            { label: "Notes", value: "Rencontré au salon, rappeler en janvier.\nIntéressé par : audit, formation" },
            { label: "Date de naissance", value: "14/05/1980" },
          ],
        },
      ]);

      expect(await prisma.contact.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it("importe les 4 lignes : 3 contacts créés, le doublon écarté, le contact sans nom gardé", async () => {
      const outcome = await importContacts(upload(fixtureBytes(), { mode: "skip" }));
      expect(outcome).toEqual({ ok: true, created: 3, updated: 0, skipped: 1, rejected: 0 });

      const contacts = await contactsOf(alice.workspaceId);
      const byLast = new Map(contacts.map((c) => [c.lastName, c]));
      expect(contacts).toHaveLength(3);

      expect(byLast.get("Dupont")).toMatchObject({
        firstName: "Jean",
        email: "jean.dupont@exemple.fr",
        phone: "+33 6 12 34 56 78",
        organizationName: "Exemple SARL",
        organizationId: null,
        notes: null,
        archivedAt: null,
        isDemo: false,
      });
      expect(byLast.get("Lefèvre-Çaron")).toMatchObject({
        firstName: "Hélène",
        email: "Helene.Lefevre@Exemple.com",
        phone: "04 68 00 00 00",
        jobTitle: "Directrice générale",
        organizationName: "Société Générale d’Études, Conseil & Co",
      });
      expect(byLast.get("Lefèvre-Çaron")!.notes).toContain("E-mail 2 : helene.perso@exemple.org");
      expect(byLast.get("Lefèvre-Çaron")!.notes).toContain(
        "Adresse professionnelle : 12 rue de l’Église, 11100 Narbonne, France",
      );
      expect(byLast.get("")).toMatchObject({
        firstName: "",
        email: null,
        phone: "01 23 45 67 89",
        organizationName: "Contact sans nom ni e-mail",
      });
      // Marc Martin (doublon du contact 1) n'a pas été créé.
      expect(contacts.some((c) => c.firstName === "Marc")).toBe(false);

      // Une seule ligne d'audit pour tout l'import, sans donnée de contact.
      const audit = await prisma.auditLog.findMany();
      expect(audit).toEqual([
        expect.objectContaining({
          workspaceId: alice.workspaceId,
          userId: alice.userId,
          action: "CREATE",
          entityType: "ContactImport",
          entityId: null,
        }),
      ]);
    });
  });

  describe("doublons avec les contacts existants", () => {
    let existingId: string;

    beforeEach(async () => {
      existingId = await createContactRecord(alice.workspaceId, {
        firstName: "Jean",
        lastName: "",
        email: "  JEAN.Dupont@exemple.fr ",
        phone: "07 77 77 77 77",
        notes: "Note existante",
      });
    });

    it("sont détectés sans tenir compte de la casse", async () => {
      const preview = await previewOk(upload(fixtureBytes()));
      expect(preview.toCreate).toBe(2);
      expect(preview.existingDuplicates).toEqual([
        {
          line: 2,
          email: "jean.dupont@exemple.fr",
          contactName: "Jean",
          archived: false,
          otherMatches: 0,
          fillable: ["Nom", "Entreprise"],
        },
      ]);
    });

    it("« ignorer » ne touche pas au contact existant", async () => {
      const before = await prisma.contact.findUniqueOrThrow({ where: { id: existingId } });
      const outcome = await importContacts(upload(fixtureBytes(), { mode: "skip" }));
      expect(outcome).toEqual({ ok: true, created: 2, updated: 0, skipped: 2, rejected: 0 });
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: existingId } })).toEqual(before);
    });

    it("« compléter » remplit les champs vides et n'écrase jamais", async () => {
      const outcome = await importContacts(upload(fixtureBytes(), { mode: "complete" }));
      expect(outcome).toEqual({ ok: true, created: 2, updated: 1, skipped: 1, rejected: 0 });

      expect(await prisma.contact.findUniqueOrThrow({ where: { id: existingId } })).toMatchObject({
        firstName: "Jean",
        lastName: "Dupont",
        email: "  JEAN.Dupont@exemple.fr ",
        phone: "07 77 77 77 77",
        organizationName: "Exemple SARL",
        notes: "Note existante",
      });
    });

    it("un contact archivé compte comme existant", async () => {
      await prisma.contact.update({ where: { id: existingId }, data: { archivedAt: new Date() } });
      const preview = await previewOk(upload(fixtureBytes()));
      expect(preview.existingDuplicates).toEqual([expect.objectContaining({ archived: true })]);
      expect(preview.toCreate).toBe(2);
    });
  });

  describe("doublons probables (lignes sans e-mail)", () => {
    it("réimporter le fichier de référence ne crée plus rien", async () => {
      expect(await importContacts(upload(fixtureBytes(), { mode: "skip" }))).toMatchObject({ created: 3 });

      const preview = await previewOk(upload(fixtureBytes()));
      expect(preview.toCreate).toBe(0);
      expect(preview.probableDuplicates).toEqual([
        {
          line: 5,
          label: "Contact sans nom ni e-mail",
          contactName: "Contact sans nom ni e-mail",
          archived: false,
          reasons: ["même prénom, nom et organisation", "même téléphone"],
        },
      ]);

      for (const mode of ["skip", "complete"]) {
        expect(await importContacts(upload(fixtureBytes(), { mode }))).toEqual({
          ok: true,
          created: 0,
          updated: 0,
          skipped: 4,
          rejected: 0,
        });
      }
      expect(await prisma.contact.count({ where: { workspaceId: alice.workspaceId } })).toBe(3);
    });

    it("détecte aussi par téléphone normalisé, contre un contact archivé", async () => {
      await createContactRecord(alice.workspaceId, {
        firstName: "",
        lastName: "Standard",
        phone: "+33 (0)1 23 45 67 89",
        archivedAt: new Date(),
      });
      const preview = await previewOk(upload(fixtureBytes()));
      expect(preview.probableDuplicates).toEqual([
        expect.objectContaining({ line: 5, contactName: "Standard", archived: true, reasons: ["même téléphone"] }),
      ]);
    });

    it("une ligne cochée est importée quand même", async () => {
      await importContacts(upload(fixtureBytes(), { mode: "skip" }));

      const data = upload(fixtureBytes(), { mode: "skip" });
      data.append("include", "5");
      // Une ligne qui n'est pas un doublon probable ne change rien.
      data.append("include", "2");
      expect(await importContacts(data)).toEqual({ ok: true, created: 1, updated: 0, skipped: 3, rejected: 0 });
      expect(
        await prisma.contact.count({ where: { workspaceId: alice.workspaceId, organizationName: "Contact sans nom ni e-mail" } }),
      ).toBe(2);
    });

    it("refuse une sélection de lignes invalide", async () => {
      const data = upload(fixtureBytes(), { mode: "skip" });
      data.append("include", "abc");
      expect(await importContacts(data)).toEqual({ ok: false, error: "Sélection de lignes invalide." });
      expect(await prisma.contact.count()).toBe(0);
    });
  });

  describe("organisations", () => {
    it("rattache à une organisation existante par nom normalisé, sans en créer", async () => {
      const orgId = await createOrganizationRecord(alice.workspaceId, { name: "  exemple   SARL " });
      await createOrganizationRecord(alice.workspaceId, {
        name: "Contact sans nom ni e-mail",
        archivedAt: new Date(),
      });

      await importContacts(upload(fixtureBytes(), { mode: "skip" }));

      const contacts = await contactsOf(alice.workspaceId);
      expect(contacts.find((c) => c.lastName === "Dupont")!.organizationId).toBe(orgId);
      // Organisation archivée : pas de rattachement, le nom reste en texte.
      expect(contacts.find((c) => c.lastName === "")!.organizationId).toBeNull();
      // Société Générale… n'existait pas : pas de création automatique.
      expect(await prisma.organization.count({ where: { workspaceId: alice.workspaceId } })).toBe(2);
    });
  });

  describe("isolation des workspaces", () => {
    let bobContactId: string;
    let bobOrgId: string;

    beforeEach(async () => {
      bobOrgId = await createOrganizationRecord(bob.workspaceId, { name: "Exemple SARL" });
      bobContactId = await createContactRecord(bob.workspaceId, {
        firstName: "Jean",
        lastName: "",
        email: "jean.dupont@exemple.fr",
        phone: null,
        organizationName: null,
      });
      // Même nom d'organisation et même téléphone que la ligne 5, mais chez Bob.
      await createContactRecord(bob.workspaceId, {
        firstName: "",
        lastName: "",
        organizationName: "Contact sans nom ni e-mail",
        phone: "01 23 45 67 89",
      });
    });

    it("l'aperçu ne voit pas les contacts d'un autre workspace", async () => {
      const preview = await previewOk(upload(fixtureBytes()));
      expect(preview.existingDuplicates).toEqual([]);
      expect(preview.probableDuplicates).toEqual([]);
      expect(preview.toCreate).toBe(3);
    });

    it("l'import ne crée, ne lit ni ne modifie rien chez un autre workspace", async () => {
      const bobBefore = await contactsOf(bob.workspaceId);

      // Un workspaceId glissé dans le formulaire est ignoré.
      const outcome = await importContacts(
        upload(fixtureBytes(), { mode: "complete", workspaceId: bob.workspaceId }),
      );
      expect(outcome).toEqual({ ok: true, created: 3, updated: 0, skipped: 1, rejected: 0 });

      expect(await contactsOf(bob.workspaceId)).toEqual(bobBefore);
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: bobContactId } })).toMatchObject({
        lastName: "",
        phone: null,
        organizationName: null,
        organizationId: null,
      });

      const aliceContacts = await contactsOf(alice.workspaceId);
      expect(aliceContacts).toHaveLength(3);
      // L'organisation de Bob, de même nom, n'est jamais rattachée.
      expect(aliceContacts.every((c) => c.organizationId !== bobOrgId)).toBe(true);
      expect(await prisma.auditLog.count({ where: { workspaceId: bob.workspaceId } })).toBe(0);
    });
  });

  describe("tout ou rien", () => {
    it("une erreur dans un lot tardif annule tout l'import", async () => {
      // Un déclencheur de test fait échouer l'insertion d'une ligne du 2ᵉ lot.
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_import_boom() RETURNS trigger AS $$
        BEGIN
          IF NEW.last_name = 'BOOM' THEN RAISE EXCEPTION 'boom'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_import_boom BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION test_import_boom()`,
      );
      try {
        const lines = ["First Name,Last Name,E-mail Address"];
        for (let i = 0; i < 700; i += 1) {
          lines.push(`P${i},${i === 650 ? "BOOM" : `N${i}`},p${i}@exemple.fr`);
        }
        const outcome = await importContacts(upload(csvBytes(lines), { mode: "skip" }));
        expect(outcome).toEqual({ ok: false, error: expect.stringContaining("aucun contact") });
        expect(await prisma.contact.count()).toBe(0);
        expect(await prisma.auditLog.count()).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_import_boom ON contacts`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_import_boom()`);
      }
    });
  });

  describe("fichiers refusés et droits", () => {
    it("refuse un fichier trop gros avec un message clair, sans le lire", async () => {
      const result = await previewContactImport(upload(new Uint8Array(IMPORT_MAX_BYTES + 1)));
      expect(result).toEqual({ ok: false, error: expect.stringContaining("2,5 Mo maximum") });
    });

    it("refuse un fichier vide, un fichier sans contact et l'absence de fichier", async () => {
      expect(await previewContactImport(upload(new Uint8Array()))).toEqual({
        ok: false,
        error: "Le fichier est vide.",
      });
      expect(await previewContactImport(upload(csvBytes(["First Name,Last Name", ""])))).toEqual({
        ok: false,
        error: expect.stringContaining("que l'en-tête"),
      });
      expect(await previewContactImport(new FormData())).toEqual({
        ok: false,
        error: expect.stringContaining("Choisis un fichier"),
      });
    });

    it("refuse un choix de doublon inconnu", async () => {
      const outcome = await importContacts(upload(fixtureBytes(), { mode: "overwrite" }));
      expect(outcome.ok).toBe(false);
      expect(await prisma.contact.count()).toBe(0);
    });

    it("exige une session", async () => {
      dropCookie();
      await expect(previewContactImport(upload(fixtureBytes()))).rejects.toThrow(UnauthenticatedError);
      await expect(importContacts(upload(fixtureBytes(), { mode: "skip" }))).rejects.toThrow(
        UnauthenticatedError,
      );
      expect(await prisma.contact.count()).toBe(0);
    });
  });

  describe("performance", () => {
    it("importe 5 000 contacts, puis complète 5 000 doublons, par lots", async () => {
      const header = "First Name,Last Name,E-mail Address,Mobile Phone,Company,Notes";
      const first = [header];
      const second = [header];
      for (let i = 0; i < 5000; i += 1) {
        first.push(`Prénom${i},Nom${i},contact${i}@exemple.fr,,,`);
        second.push(`Prénom${i},Nom${i},CONTACT${i}@exemple.fr,06 00 00 ${String(i).padStart(4, "0")},"Société ${i}, SA","Note ${i}"`);
      }

      let started = Date.now();
      const created = await importContacts(upload(csvBytes(first), { mode: "skip" }));
      const createMs = Date.now() - started;
      expect(created).toEqual({ ok: true, created: 5000, updated: 0, skipped: 0, rejected: 0 });

      started = Date.now();
      const completed = await importContacts(upload(csvBytes(second), { mode: "complete" }));
      const completeMs = Date.now() - started;
      expect(completed).toEqual({ ok: true, created: 0, updated: 5000, skipped: 0, rejected: 0 });

      expect(await prisma.contact.count({ where: { workspaceId: alice.workspaceId } })).toBe(5000);
      expect(
        await prisma.contact.count({ where: { workspaceId: alice.workspaceId, phone: null } }),
      ).toBe(0);
      expect(await prisma.auditLog.count()).toBe(2);

      console.info(`[perf] import 5 000 : création ${createMs} ms, complétion ${completeMs} ms`);
      expect(createMs).toBeLessThan(20_000);
      expect(completeMs).toBeLessThan(20_000);
    }, 60_000);
  });
});
