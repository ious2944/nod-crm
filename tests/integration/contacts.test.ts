import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveContact,
  createContact,
  findContacts,
  restoreContact,
  updateContact,
} from "@/app/(app)/contacts/actions";
import { createFollowUp } from "@/app/(app)/follow-ups/actions";
import { UnauthenticatedError } from "@/lib/auth/dal";
import {
  CONTACTS_PAGE_SIZE,
  DEFAULT_CONTACT_LIST_PARAMS,
  NO_ORGANIZATION,
  type ContactListParams,
} from "@/lib/contacts/filters";
import { initialContactFormState } from "@/lib/contacts/form-state";
import {
  getContactDetail,
  listContactsPage,
  listOrganizationOptions,
  searchContactOptions,
} from "@/lib/contacts/queries";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";

import { TestRedirect } from "./cookie-jar";
import {
  createContactRecord,
  createWorkspaceWithUser,
  dropCookie,
  formData,
  formDataWithFile,
  pngBytes,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Module Contacts — comportement, isolation et non-régression Follow-Up.
 *
 * Le fil directeur : un contact est un référentiel autonome, et rien de ce que
 * le client envoie n'est pris pour argent comptant.
 */

function listParams(overrides: Partial<ContactListParams> = {}): ContactListParams {
  return { ...DEFAULT_CONTACT_LIST_PARAMS, ...overrides };
}

async function create(fields: Record<string, string>) {
  return createContact(initialContactFormState, formData(fields));
}

const JULIEN = {
  firstName: "Julien",
  lastName: "Doussot",
  email: "julien@example.com",
  phone: "06 12 34 56 78",
  jobTitle: "Responsable commercial",
  organizationName: "EASYLAB",
  notes: "Rencontré au salon.",
};

describe("création d'un contact", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-create-ws");
    await signIn(user);
  });

  it("enregistre tous les champs du formulaire", async () => {
    const result = await create(JULIEN);

    expect(result.status).toBe("success");
    const contact = await prisma.contact.findFirstOrThrow({
      where: { email: JULIEN.email },
    });
    expect(contact).toMatchObject({ ...JULIEN, workspaceId: user.workspaceId });
    expect(contact.archivedAt).toBeNull();
    expect(contact.photoKey).toBeNull();
  });

  it("accepte un contact identifié par son seul email", async () => {
    expect((await create({ email: "seul@example.com" })).status).toBe("success");
  });

  it("accepte un contact identifié par sa seule organisation", async () => {
    expect((await create({ organizationName: "ACME" })).status).toBe("success");
  });

  it("refuse un contact que rien ne permet d'identifier", async () => {
    const result = await create({ phone: "0612345678", notes: "?" });

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.firstName).toContain("au moins un prénom");
    expect(await prisma.contact.count()).toBe(0);
  });

  it("ignore les champs internes glissés dans le formulaire", async () => {
    const other = await createWorkspaceWithUser("voisin-ws");

    await create({
      ...JULIEN,
      workspaceId: other.workspaceId,
      isDemo: "true",
      archivedAt: new Date().toISOString(),
      photoKey: "contacts/deadbeef.png",
    });

    const contact = await prisma.contact.findFirstOrThrow({
      where: { email: JULIEN.email },
    });
    expect(contact.workspaceId).toBe(user.workspaceId);
    expect(contact.isDemo).toBe(false);
    expect(contact.archivedAt).toBeNull();
    expect(contact.photoKey).toBeNull();
  });
});

describe("consultation et modification", () => {
  let user: TestUser;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-read-ws");
    await signIn(user);
    contactId = await createContactRecord(user.workspaceId, JULIEN);
  });

  it("rend la fiche complète", async () => {
    const detail = await getContactDetail(contactId);

    expect(detail).toMatchObject({
      displayName: "Julien Doussot",
      initials: "JD",
      organizationName: "EASYLAB",
      jobTitle: "Responsable commercial",
      archived: false,
    });
    expect(detail?.followUps).toEqual([]);
  });

  it("modifie chacun des champs", async () => {
    const result = await updateContact(
      initialContactFormState,
      formData({
        id: contactId,
        firstName: "Julie",
        lastName: "Dussot",
        email: "julie@example.org",
        phone: "+33 1 02 03 04 05",
        jobTitle: "Direction",
        organizationName: "ACME",
        notes: "Note revue.",
      }),
    );

    expect(result.status).toBe("success");
    expect(
      await prisma.contact.findUniqueOrThrow({ where: { id: contactId } }),
    ).toMatchObject({
      firstName: "Julie",
      lastName: "Dussot",
      email: "julie@example.org",
      jobTitle: "Direction",
      organizationName: "ACME",
    });
  });

  it("vide un champ facultatif quand il est effacé", async () => {
    await updateContact(
      initialContactFormState,
      formData({ id: contactId, firstName: "Julien", lastName: "Doussot", jobTitle: "" }),
    );

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.jobTitle).toBeNull();
    expect(contact.email).toBeNull();
  });

  it("refuse une modification qui viderait l'identité", async () => {
    const result = await updateContact(
      initialContactFormState,
      formData({
        id: contactId,
        firstName: "",
        lastName: "",
        email: "",
        organizationName: "",
      }),
    );

    expect(result.status).toBe("error");
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).firstName,
    ).toBe("Julien");
  });
});

describe("archivage", () => {
  let user: TestUser;
  let contactId: string;
  let followUpId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-archive-ws");
    await signIn(user);
    contactId = await createContactRecord(user.workspaceId, JULIEN);

    const followUp = await prisma.followUp.create({
      data: {
        workspaceId: user.workspaceId,
        contactId,
        title: "Devis à relancer",
        ballOwner: "THEM",
        dueAt: new Date(),
      },
      select: { id: true },
    });
    followUpId = followUp.id;
  });

  it("n'efface rien : il pose seulement une date", async () => {
    await archiveContact(formData({ id: contactId }));

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.archivedAt).toBeInstanceOf(Date);
  });

  it("conserve les suivis ET leur rattachement", async () => {
    await archiveContact(formData({ id: contactId }));

    const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(followUp.contactId).toBe(contactId);
    expect(followUp.status).toBe("OPEN");
    expect(await prisma.followUp.count()).toBe(1);
  });

  it("retire le contact de la liste, de la recherche et des sélecteurs", async () => {
    await archiveContact(formData({ id: contactId }));

    expect((await listContactsPage(listParams())).items).toEqual([]);
    expect((await listContactsPage(listParams({ search: "Julien" }))).items).toEqual([]);
    expect(await searchContactOptions("Julien")).toEqual([]);
    expect(await listOrganizationOptions()).toEqual([]);
  });

  it("laisse la fiche accessible, pour pouvoir restaurer", async () => {
    await archiveContact(formData({ id: contactId }));

    const detail = await getContactDetail(contactId);
    expect(detail?.archived).toBe(true);
    expect(detail?.followUps).toHaveLength(1);

    await restoreContact(formData({ id: contactId }));
    expect((await listContactsPage(listParams())).items).toHaveLength(1);
  });
});

describe("recherche", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-search-ws");
    await signIn(user);

    await createContactRecord(user.workspaceId, JULIEN);
    await createContactRecord(user.workspaceId, {
      firstName: "Marie",
      lastName: "Dupont",
      email: "marie@acme.test",
      organizationName: "ACME",
    });
    // Un contact volontairement lacunaire : la recherche doit le tolérer.
    await createContactRecord(user.workspaceId, {
      firstName: "Sans",
      lastName: "Coordonnées",
      email: null,
      phone: null,
      jobTitle: null,
      organizationName: null,
    });
  });

  async function names(search: string): Promise<string[]> {
    const page = await listContactsPage(listParams({ search }));
    return page.items.map((item) => item.displayName);
  }

  it.each([
    ["prénom", "Julien"],
    ["nom", "Doussot"],
    ["prénom + nom", "Julien Doussot"],
    ["email", "julien@example.com"],
    ["téléphone", "06 12"],
    ["fonction", "Responsable"],
    ["organisation", "EASYLAB"],
  ])("retrouve par %s", async (_label, search) => {
    expect(await names(search)).toEqual(["Julien Doussot"]);
  });

  it("est insensible à la casse", async () => {
    expect(await names("jULIEN")).toEqual(["Julien Doussot"]);
    expect(await names("easylab")).toEqual(["Julien Doussot"]);
  });

  it("croise les mots : chacun doit correspondre à un champ", async () => {
    expect(await names("julien easylab")).toEqual(["Julien Doussot"]);
    expect(await names("julien acme")).toEqual([]);
  });

  it("ne casse pas sur un contact aux champs vides", async () => {
    expect(await names("Coordonnées")).toEqual(["Sans Coordonnées"]);
    expect(await names("example.com")).toEqual(["Julien Doussot"]);
  });

  it("ne traverse jamais la frontière du workspace", async () => {
    const other = await createWorkspaceWithUser("autre-ws");
    await createContactRecord(other.workspaceId, {
      firstName: "Julien",
      lastName: "Ailleurs",
    });

    expect(await names("Julien")).toEqual(["Julien Doussot"]);
  });
});

describe("filtres, tri et pagination", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-filter-ws");
    await signIn(user);
  });

  it("filtre par organisation, y compris « sans organisation »", async () => {
    await createContactRecord(user.workspaceId, {
      firstName: "Alice",
      organizationName: "ACME",
    });
    await createContactRecord(user.workspaceId, {
      firstName: "Bob",
      organizationName: "Globex",
    });
    await createContactRecord(user.workspaceId, {
      firstName: "Carla",
      organizationName: null,
    });

    const acme = await listContactsPage(listParams({ organization: "ACME" }));
    expect(acme.items.map((item) => item.displayName)).toEqual(["Alice Contact"]);

    const orphans = await listContactsPage(listParams({ organization: NO_ORGANIZATION }));
    expect(orphans.items.map((item) => item.displayName)).toEqual(["Carla Contact"]);

    expect(await listOrganizationOptions()).toEqual(["ACME", "Globex"]);
  });

  it("filtre par état des suivis", async () => {
    const withOpen = await createContactRecord(user.workspaceId, { firstName: "Ouvert" });
    const withClosed = await createContactRecord(user.workspaceId, { firstName: "Clos" });
    await createContactRecord(user.workspaceId, { firstName: "Vierge" });

    await prisma.followUp.create({
      data: {
        workspaceId: user.workspaceId,
        contactId: withOpen,
        title: "En cours",
        ballOwner: "THEM",
        dueAt: new Date(),
      },
    });
    await prisma.followUp.create({
      data: {
        workspaceId: user.workspaceId,
        contactId: withClosed,
        title: "Fini",
        status: "COMPLETED",
        completedAt: new Date(),
        ballOwner: "ME",
        dueAt: new Date(),
      },
    });

    const active = await listContactsPage(listParams({ followUp: "active" }));
    expect(active.items.map((item) => item.displayName)).toEqual(["Ouvert Contact"]);

    const none = await listContactsPage(listParams({ followUp: "none" }));
    expect(none.items.map((item) => item.displayName)).toEqual(["Vierge Contact"]);

    const done = await listContactsPage(listParams({ followUp: "done" }));
    expect(done.items.map((item) => item.displayName)).toEqual(["Clos Contact"]);
  });

  it("annonce le nombre de suivis actifs sans requête par ligne", async () => {
    const ids: string[] = [];
    for (const firstName of ["Un", "Deux", "Trois", "Quatre", "Cinq"]) {
      ids.push(await createContactRecord(user.workspaceId, { firstName }));
    }

    await prisma.followUp.createMany({
      data: [
        {
          workspaceId: user.workspaceId,
          contactId: ids[0],
          title: "a",
          ballOwner: "THEM",
          dueAt: new Date(),
        },
        {
          workspaceId: user.workspaceId,
          contactId: ids[0],
          title: "b",
          ballOwner: "THEM",
          dueAt: new Date(),
        },
        {
          workspaceId: user.workspaceId,
          contactId: ids[1],
          title: "c",
          ballOwner: "THEM",
          dueAt: new Date(),
        },
      ],
    });

    // Le compte se fait par agrégation groupée : une seule requête pour toute
    // la page, et jamais un `findMany` de suivis contact par contact.
    const groupBy = vi.spyOn(prisma.followUp, "groupBy");
    const findMany = vi.spyOn(prisma.followUp, "findMany");

    try {
      const page = await listContactsPage(listParams());
      const labels = Object.fromEntries(
        page.items.map((item) => [item.displayName, item.followUpLabel]),
      );

      expect(labels["Un Contact"]).toBe("2 suivis actifs");
      expect(labels["Deux Contact"]).toBe("1 suivi actif");
      expect(labels["Trois Contact"]).toBe("Aucun suivi");
      expect(groupBy).toHaveBeenCalledTimes(1);
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      groupBy.mockRestore();
      findMany.mockRestore();
    }
  });

  it("trie dans les quatre ordres proposés", async () => {
    const alice = await createContactRecord(user.workspaceId, { firstName: "Alice" });
    await createContactRecord(user.workspaceId, { firstName: "Bob" });
    await createContactRecord(user.workspaceId, { firstName: "Carla" });

    const order = async (sort: ContactListParams["sort"]) =>
      (await listContactsPage(listParams({ sort }))).items.map((item) => item.displayName);

    expect(await order("name-asc")).toEqual([
      "Alice Contact",
      "Bob Contact",
      "Carla Contact",
    ]);
    expect(await order("name-desc")).toEqual([
      "Carla Contact",
      "Bob Contact",
      "Alice Contact",
    ]);
    expect(await order("recent")).toEqual([
      "Carla Contact",
      "Bob Contact",
      "Alice Contact",
    ]);

    await prisma.contact.update({ where: { id: alice }, data: { jobTitle: "Touché" } });
    expect((await order("updated"))[0]).toBe("Alice Contact");
  });

  it("pagine côté serveur", async () => {
    const total = CONTACTS_PAGE_SIZE + 5;
    await prisma.contact.createMany({
      data: Array.from({ length: total }, (_, index) => ({
        workspaceId: user.workspaceId,
        firstName: `Contact${String(index).padStart(2, "0")}`,
        lastName: "Test",
      })),
    });

    const first = await listContactsPage(listParams());
    expect(first.items).toHaveLength(CONTACTS_PAGE_SIZE);
    expect(first.total).toBe(total);
    expect(first.pageCount).toBe(2);

    const second = await listContactsPage(listParams({ page: 2 }));
    expect(second.items).toHaveLength(5);

    // Aucune ligne ne doit apparaître sur les deux pages.
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(total);

    // Une page au-delà du dernier résultat renvoie une liste vide, pas une erreur.
    expect((await listContactsPage(listParams({ page: 99 }))).items).toEqual([]);
  });
});

describe("validation des entrées", () => {
  let user: TestUser;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-validation-ws");
    await signIn(user);
    contactId = await createContactRecord(user.workspaceId, JULIEN);
  });

  it.each([
    ["email invalide", { firstName: "Test", email: "pas-un-email" }],
    ["email sans domaine", { firstName: "Test", email: "test@" }],
    ["prénom trop long", { firstName: "x".repeat(81) }],
    ["nom trop long", { lastName: "x".repeat(81) }],
    ["organisation trop longue", { organizationName: "x".repeat(121) }],
    ["fonction trop longue", { firstName: "Test", jobTitle: "x".repeat(121) }],
    ["notes trop longues", { firstName: "Test", notes: "x".repeat(2001) }],
    ["téléphone alphabétique", { firstName: "Test", phone: "appelle-moi" }],
    ["téléphone sans assez de chiffres", { firstName: "Test", phone: "+3" }],
  ])("refuse : %s", async (_label, fields) => {
    const before = await prisma.contact.count();
    const result = await create(fields as Record<string, string>);

    expect(result.status).toBe("error");
    expect(await prisma.contact.count()).toBe(before);
  });

  it("accepte les formats de téléphone courants", async () => {
    for (const phone of [
      "06 12 34 56 78",
      "+33 6 12 34 56 78",
      "(01) 23-45-67-89",
      "0612345678",
    ]) {
      const result = await create({ firstName: "Tel", phone });
      expect(result.status, phone).toBe("success");
    }
  });

  it("refuse un identifiant qui n'est pas un UUID", async () => {
    const result = await updateContact(
      initialContactFormState,
      formData({ id: "42", firstName: "Intrus" }),
    );
    expect(result.status).toBe("error");

    await expect(archiveContact(formData({ id: "../../etc/passwd" }))).rejects.toThrow();
  });

  it("refuse un identifiant inconnu", async () => {
    const result = await updateContact(
      initialContactFormState,
      formData({ id: "11111111-2222-4333-8444-555555555555", firstName: "Fantôme" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe("Ce contact n'existe pas.");
  });

  it("nettoie les caractères que PostgreSQL refuse", async () => {
    await updateContact(
      initialContactFormState,
      formData({ id: contactId, firstName: "Juli\u0000en\u00a0", lastName: "Doussot" }),
    );

    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).firstName,
    ).toBe("Julien");
  });
});

describe("photos de contact", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-photo-ws");
    await signIn(user);
  });

  it("range l'image dans le magasin d'objets, jamais en base", async () => {
    const bytes = pngBytes();
    const result = await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Julien" },
        { name: "moi.png", type: "image/png", bytes },
      ),
    );

    expect(result.status).toBe("success");

    const contact = await prisma.contact.findFirstOrThrow({
      where: { firstName: "Julien" },
    });
    expect(contact.photoMimeType).toBe("image/png");
    // Une clé opaque : ni le nom du fichier envoyé, ni du base64.
    expect(contact.photoKey).toMatch(/^contacts\/[0-9a-f-]{36}\.png$/);
    expect(contact.photoKey).not.toContain("moi");
    expect(await objectStore.read(contact.photoKey!)).toEqual(bytes);
  });

  it("refuse un fichier qui n'est pas une image, quoi qu'il annonce", async () => {
    const result = await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Pirate" },
        {
          name: "photo.png",
          type: "image/png",
          bytes: new Uint8Array(Buffer.from("<svg onload=alert(1)>")),
        },
      ),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.photo).toBeDefined();
    expect(await prisma.contact.count()).toBe(0);
  });

  it("refuse une image trop lourde", async () => {
    const result = await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Lourd" },
        { name: "gros.png", type: "image/png", bytes: pngBytes(2 * 1024 * 1024 + 1) },
      ),
    );

    expect(result.status).toBe("error");
    expect(await prisma.contact.count()).toBe(0);
  });

  it("remplace la photo et efface l'ancienne", async () => {
    await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Julien" },
        { name: "a.png", type: "image/png", bytes: pngBytes() },
      ),
    );
    const before = await prisma.contact.findFirstOrThrow({
      where: { firstName: "Julien" },
    });

    await updateContact(
      initialContactFormState,
      formDataWithFile(
        { id: before.id, firstName: "Julien" },
        { name: "b.png", type: "image/png", bytes: pngBytes(96) },
      ),
    );

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.photoKey).not.toBe(before.photoKey);
    expect(await objectStore.read(before.photoKey!)).toBeNull();
    expect(await objectStore.read(after.photoKey!)).not.toBeNull();
  });

  it("retire la photo sur demande explicite", async () => {
    await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Julien" },
        { name: "a.png", type: "image/png", bytes: pngBytes() },
      ),
    );
    const before = await prisma.contact.findFirstOrThrow({
      where: { firstName: "Julien" },
    });

    await updateContact(
      initialContactFormState,
      formData({ id: before.id, firstName: "Julien", removePhoto: "1" }),
    );

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.photoKey).toBeNull();
    expect(after.photoMimeType).toBeNull();
    expect(await objectStore.read(before.photoKey!)).toBeNull();
  });

  it("rend proprement une panne d'écriture du magasin d'objets", async () => {
    const original = objectStore.put;
    // Volume non monté, monté en lecture seule, mauvais propriétaire, disque
    // plein : la panne est réelle en exploitation, et l'utilisateur ne doit ni
    // perdre son formulaire ni voir un chemin du système de fichiers.
    (objectStore as { put: typeof objectStore.put }).put = async () => {
      const error = new Error("EACCES: permission denied, open '/app/var/uploads/x'");
      (error as NodeJS.ErrnoException).code = "EACCES";
      throw error;
    };

    try {
      const result = await createContact(
        initialContactFormState,
        formDataWithFile(
          { firstName: "Disque" },
          { name: "a.png", type: "image/png", bytes: pngBytes() },
        ),
      );

      expect(result.status).toBe("error");
      expect(result.fieldErrors?.photo).toBeDefined();
      expect(JSON.stringify(result)).not.toContain("EACCES");
      expect(JSON.stringify(result)).not.toContain("/app/var");
      expect(await prisma.contact.count()).toBe(0);
    } finally {
      (objectStore as { put: typeof objectStore.put }).put = original;
    }
  });

  it("ne touche pas à la photo quand le formulaire n'en envoie pas", async () => {
    await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Julien" },
        { name: "a.png", type: "image/png", bytes: pngBytes() },
      ),
    );
    const before = await prisma.contact.findFirstOrThrow({
      where: { firstName: "Julien" },
    });

    await updateContact(
      initialContactFormState,
      formData({ id: before.id, firstName: "Julien", lastName: "Doussot" }),
    );

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.photoKey).toBe(before.photoKey);
  });
});

describe("recherche — jokers et caractères spéciaux", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-jokers-ws");
    await signIn(user);

    await createContactRecord(user.workspaceId, { firstName: "Alpha", lastName: "One" });
    await createContactRecord(user.workspaceId, { firstName: "Beta", lastName: "Two" });
    await createContactRecord(user.workspaceId, {
      firstName: "Litteral",
      lastName: "Pourcent",
      jobTitle: "Remise 50%",
      email: "john_doe@example.com",
    });
  });

  async function names(search: string): Promise<string[]> {
    const page = await listContactsPage(listParams({ search }));
    return page.items.map((item) => item.displayName);
  }

  /**
   * Prisma paramètre la requête, donc aucune injection n'est possible — mais il
   * ne neutralise pas `%` ni `_`, qui restent des jokers à l'intérieur du motif
   * `LIKE`. Sans échappement, « % » renvoyait tout le carnet et « john_doe »
   * ramenait aussi « johnXdoe ».
   */
  it("traite « % » comme un caractère, pas comme « tout »", async () => {
    expect(await names("%")).toEqual(["Litteral Pourcent"]);
    expect(await names("50%")).toEqual(["Litteral Pourcent"]);
  });

  it("traite « _ » comme un caractère, pas comme « n'importe lequel »", async () => {
    expect(await names("A_pha")).toEqual([]);
    expect(await names("john_doe")).toEqual(["Litteral Pourcent"]);
  });

  it("ne se laisse pas désarçonner par une tentative d'injection", async () => {
    for (const attempt of [
      "' OR 1=1 --",
      "'; DROP TABLE contacts; --",
      "\\",
      "%' --",
    ]) {
      await expect(names(attempt), attempt).resolves.toEqual([]);
    }
    // La table est toujours là, avec ses trois lignes.
    expect(await prisma.contact.count()).toBe(3);
  });
});

describe("photo — gestionnaire de route", () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceContactId: string;
  let bobContactId: string;

  async function get(id: string): Promise<Response> {
    const { GET } = await import("@/app/api/contacts/[id]/photo/route");
    return GET(new Request(`http://localhost/api/contacts/${id}/photo`), {
      params: Promise.resolve({ id }),
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("photo-route-a");
    bob = await createWorkspaceWithUser("photo-route-b");

    await signIn(alice);
    await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Alice" },
        { name: "a.png", type: "image/png", bytes: pngBytes() },
      ),
    );
    aliceContactId = (
      await prisma.contact.findFirstOrThrow({ where: { workspaceId: alice.workspaceId } })
    ).id;

    await signIn(bob);
    await createContact(
      initialContactFormState,
      formDataWithFile(
        { firstName: "Bob" },
        { name: "b.png", type: "image/png", bytes: pngBytes(96) },
      ),
    );
    bobContactId = (
      await prisma.contact.findFirstOrThrow({ where: { workspaceId: bob.workspaceId } })
    ).id;

    await signIn(alice);
  });

  it("sert la photo du workspace courant", async () => {
    const response = await get(aliceContactId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes());
  });

  it("refuse la photo d'un contact d'un autre workspace", async () => {
    const response = await get(bobContactId);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("répond comme pour un contact inexistant — rien à énumérer", async () => {
    const unknown = await get("11111111-2222-4333-8444-555555555555");
    const foreign = await get(bobContactId);

    expect(unknown.status).toBe(foreign.status);
    expect(unknown.status).toBe(404);
  });

  it("refuse un identifiant qui n'est pas un UUID", async () => {
    expect((await get("../../etc/passwd")).status).toBe(404);
    expect((await get("42")).status).toBe(404);
  });

  it("refuse un visiteur sans session", async () => {
    dropCookie();
    expect((await get(aliceContactId)).status).toBe(401);
  });

  it("ne rend pas 500 quand le fichier a disparu du magasin", async () => {
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: aliceContactId },
      select: { photoKey: true },
    });
    await objectStore.remove(contact.photoKey!);

    expect((await get(aliceContactId)).status).toBe(404);
  });
});

describe("accès sans session", () => {
  let user: TestUser;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-anon-ws");
    contactId = await createContactRecord(user.workspaceId, JULIEN);
    dropCookie();
  });

  it("refuse toute mutation", async () => {
    await expect(create({ firstName: "Intrus" })).rejects.toThrow(UnauthenticatedError);
    await expect(
      updateContact(initialContactFormState, formData({ id: contactId, firstName: "Intrus" })),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(archiveContact(formData({ id: contactId }))).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(restoreContact(formData({ id: contactId }))).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(findContacts("Julien")).rejects.toThrow(UnauthenticatedError);

    expect(await prisma.contact.count()).toBe(1);
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).firstName,
    ).toBe("Julien");
  });

  it("refuse toute lecture", async () => {
    await expect(listContactsPage(listParams())).rejects.toThrow(TestRedirect);
    await expect(getContactDetail(contactId)).rejects.toThrow(TestRedirect);
    await expect(listOrganizationOptions()).rejects.toThrow(TestRedirect);
  });
});

describe("isolation entre workspaces", () => {
  let alice: TestUser;
  let bob: TestUser;
  let bobContactId: string;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-contacts-ws");
    bob = await createWorkspaceWithUser("bob-contacts-ws");

    bobContactId = await createContactRecord(bob.workspaceId, {
      firstName: "Secret",
      lastName: "De Bob",
      email: "secret@bob.test",
      organizationName: "BOBCORP",
    });
    await createContactRecord(alice.workspaceId, { firstName: "Alice", lastName: "Amie" });

    await signIn(alice);
  });

  it("ne montre à Alice que ses propres contacts", async () => {
    const page = await listContactsPage(listParams());
    expect(page.items.map((item) => item.displayName)).toEqual(["Alice Amie"]);
    expect(page.total).toBe(1);

    expect(await listOrganizationOptions()).toEqual([]);
    expect(await findContacts("Secret")).toEqual([]);
  });

  it("rend introuvable la fiche d'un contact d'un autre workspace", async () => {
    expect(await getContactDetail(bobContactId)).toBeNull();
  });

  it("refuse la modification d'un contact d'un autre workspace", async () => {
    const result = await updateContact(
      initialContactFormState,
      formData({ id: bobContactId, firstName: "Volé" }),
    );

    expect(result.status).toBe("error");
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: bobContactId } })).firstName,
    ).toBe("Secret");
  });

  it("refuse l'archivage d'un contact d'un autre workspace", async () => {
    await expect(archiveContact(formData({ id: bobContactId }))).rejects.toThrow();

    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: bobContactId } })).archivedAt,
    ).toBeNull();
  });
});

describe("non-régression Follow-Up", () => {
  let user: TestUser;
  let contactId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("contacts-followup-ws");
    await signIn(user);
    contactId = await createContactRecord(user.workspaceId, JULIEN);
  });

  it("crée encore un suivi sans contact", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({ title: "Sans contact", dueDate: "2026-05-01", ballOwner: "THEM" }),
    );

    expect(result.status).toBe("success");
    const followUp = await prisma.followUp.findFirstOrThrow({
      where: { title: "Sans contact" },
    });
    expect(followUp.contactId).toBeNull();
  });

  it("crée un suivi rattaché à un contact existant", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Avec contact",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId,
      }),
    );

    expect(result.status).toBe("success");
    expect(
      (await prisma.followUp.findFirstOrThrow({ where: { title: "Avec contact" } }))
        .contactId,
    ).toBe(contactId);
  });

  it("crée encore un contact à la volée depuis le formulaire Follow-Up", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Création rapide",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId: "new",
        newContactFirstName: "Rapide",
        newContactOrganization: "ACME",
      }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.contact.findFirstOrThrow({
      where: { firstName: "Rapide" },
    });
    expect(created.organizationName).toBe("ACME");
    expect(created.archivedAt).toBeNull();
  });

  it("archive un contact sans supprimer ni détacher ses suivis", async () => {
    await createFollowUp(
      initialCreateState,
      formData({
        title: "À conserver",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId,
      }),
    );

    await archiveContact(formData({ id: contactId }));

    const followUp = await prisma.followUp.findFirstOrThrow({
      where: { title: "À conserver" },
    });
    expect(followUp.contactId).toBe(contactId);
    expect(await prisma.followUp.count()).toBe(1);

    // La fiche du contact archivé continue de montrer l'historique.
    expect((await getContactDetail(contactId))?.followUps).toHaveLength(1);
  });

  it("refuse un nouveau suivi sur un contact archivé", async () => {
    await archiveContact(formData({ id: contactId }));

    // Le sélecteur ne le propose plus, mais un formulaire resté ouvert dans un
    // onglet poste encore son UUID : c'est le serveur qui doit refuser.
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Sur archivé",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId,
      }),
    );

    expect(result.status).toBe("error");
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("marque « archivé » le contact d'un suivi historique, sans le masquer", async () => {
    await createFollowUp(
      initialCreateState,
      formData({
        title: "Historique",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId,
      }),
    );
    await archiveContact(formData({ id: contactId }));

    const board = await getFollowUpBoard("all");
    const view = board.items.find((item) => item.title === "Historique");

    expect(view?.contactName).toBe("Julien Doussot");
    expect(view?.contactArchived).toBe(true);
  });

  it("ne propose plus un contact archivé dans le sélecteur", async () => {
    expect(await findContacts("Julien")).toHaveLength(1);

    await archiveContact(formData({ id: contactId }));

    expect(await findContacts("Julien")).toEqual([]);
    expect(await findContacts("")).toEqual([]);
  });

  it("refuse un contact appartenant à un autre workspace", async () => {
    const other = await createWorkspaceWithUser("voisin-followup-ws");
    const foreign = await createContactRecord(other.workspaceId);

    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Vol",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        contactId: foreign,
      }),
    );

    expect(result.status).toBe("error");
    expect(await prisma.followUp.count()).toBe(0);
  });
});
