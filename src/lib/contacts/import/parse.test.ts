import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decodeCsvBytes } from "./decode";
import { mapOutlookHeader, OUTLOOK_COLUMNS } from "./outlook-columns";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "./limits";
import { parseOutlookCsv, parseOutlookDate } from "./parse";
import { planImport, type ExistingContact } from "./plan";

const FIXTURE = path.resolve(__dirname, "../../../../tests/fixtures/outlook/contacts-outlook-fixture.csv");
const fixtureBytes = () => new Uint8Array(readFileSync(FIXTURE));

const ENGLISH_HEADERS = OUTLOOK_COLUMNS.map((c) => c.english);

/** Construit une ligne de 61 cellules à partir de quelques valeurs nommées. */
function row(values: Partial<Record<string, string>>, headers: readonly string[] = ENGLISH_HEADERS): string[] {
  return headers.map((_, index) => values[OUTLOOK_COLUMNS[index].key] ?? "");
}

function csv(rows: string[][], separator = ","): string {
  return rows
    .map((cells) =>
      cells
        .map((cell) => (/[",;\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(separator),
    )
    .join("\r\n");
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function windows1252(text: string): Uint8Array {
  const special: Record<string, number> = { "€": 0x80, "’": 0x92, "œ": 0x9c };
  return Uint8Array.from([...text].map((ch) => special[ch] ?? ch.charCodeAt(0)));
}

function utf16le(text: string, bom: boolean): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let offset = 0;
  if (bom) {
    out.set([0xff, 0xfe]);
    offset = 2;
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[offset + i * 2] = code & 0xff;
    out[offset + i * 2 + 1] = code >> 8;
  }
  return out;
}

function parseOk(bytes: Uint8Array) {
  const parsed = parseOutlookCsv(bytes);
  if (!parsed.ok) throw new Error(`échec inattendu : ${parsed.error}`);
  return parsed;
}

describe("fichier de référence Outlook", () => {
  it("n'a pas été réenregistré : BOM UTF-8, CRLF uniquement, 61 colonnes", () => {
    const bytes = fixtureBytes();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.match(/\r\n/g)?.length).toBe(text.match(/\n/g)?.length);
    expect(text.match(/\r/g)?.length).toBe(text.match(/\n/g)?.length);
    expect(text.slice(3).split("\r\n", 1)[0].split(",")).toHaveLength(61);
  });

  it("reconnaît les 61 en-têtes anglais", () => {
    const parsed = parseOk(fixtureBytes());
    expect(parsed.encoding).toBe("utf-8");
    expect(parsed.header.language).toBe("en");
    expect(parsed.header.recognized).toHaveLength(61);
    expect(parsed.header.unknown).toEqual([]);
  });

  it("lit les 4 contacts comme attendu", () => {
    const parsed = parseOk(fixtureBytes());
    expect(parsed.rowCount).toBe(4);
    expect(parsed.issues).toEqual([]);
    const [c1, c2, c3, c4] = parsed.candidates;

    expect(c1).toMatchObject({
      line: 2,
      firstName: "Jean",
      lastName: "Dupont",
      email: "jean.dupont@exemple.fr",
      emailKey: "jean.dupont@exemple.fr",
      phone: "+33 6 12 34 56 78",
      organizationName: "Exemple SARL",
      jobTitle: null,
      notes: null,
    });

    expect(c2).toMatchObject({
      firstName: "Hélène",
      lastName: "Lefèvre-Çaron",
      // Stocké tel quel, comparé en minuscules.
      email: "Helene.Lefevre@Exemple.com",
      emailKey: "helene.lefevre@exemple.com",
      phone: "04 68 00 00 00",
      jobTitle: "Directrice générale",
      organizationName: "Société Générale d’Études, Conseil & Co",
    });
    expect(c2.notes).toBe(
      [
        "— Import Outlook —",
        "E-mail 2 : helene.perso@exemple.org",
        "Adresse professionnelle : 12 rue de l’Église, 11100 Narbonne, France",
      ].join("\n"),
    );

    expect(c3).toMatchObject({ firstName: "Marc", lastName: "Martin", emailKey: "jean.dupont@exemple.fr" });
    expect(c3.notes).toBe(
      [
        "Rencontré au salon, rappeler en janvier.",
        "Intéressé par : audit, formation",
        "",
        "— Import Outlook —",
        "Date de naissance : 14/05/1980",
      ].join("\n"),
    );

    // Contact sans nom ni e-mail : aucun nom fabriqué.
    expect(c4).toMatchObject({
      firstName: "",
      lastName: "",
      email: null,
      emailKey: null,
      phone: "01 23 45 67 89",
      organizationName: "Contact sans nom ni e-mail",
      notes: null,
    });
  });

  it("garde la première occurrence du doublon et liste ce qui est perdu", () => {
    const parsed = parseOk(fixtureBytes());
    const plan = planImport(parsed.candidates, []);
    expect(plan.toCreate.map((c) => c.line)).toEqual([2, 3, 5]);
    expect(plan.existingDuplicates).toEqual([]);
    expect(plan.fileDuplicates).toEqual([
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
  });
});

describe("doublons avec la base", () => {
  const existing = (overrides: Partial<ExistingContact>): ExistingContact => ({
    id: "00000000-0000-4000-8000-000000000001",
    emailKey: "jean.dupont@exemple.fr",
    firstName: "Jean",
    lastName: "",
    email: "Jean.Dupont@exemple.fr",
    phone: null,
    jobTitle: "Gérant",
    organizationName: null,
    organizationId: null,
    notes: "",
    archived: false,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  });

  it("propose de compléter uniquement les champs vides", () => {
    const parsed = parseOk(fixtureBytes());
    const plan = planImport(parsed.candidates, [existing({})]);
    expect(plan.toCreate.map((c) => c.line)).toEqual([3, 5]);
    expect(plan.existingDuplicates).toHaveLength(1);
    expect(plan.existingDuplicates[0]).toMatchObject({
      line: 2,
      archived: false,
      otherMatches: 0,
      fillable: ["lastName", "phone", "organizationName"],
    });
  });

  it("compte un contact archivé et choisit le plus ancien s'il y en a plusieurs", () => {
    const parsed = parseOk(fixtureBytes());
    const plan = planImport(parsed.candidates, [
      existing({ id: "00000000-0000-4000-8000-000000000002", createdAt: new Date("2026-03-01") }),
      existing({ archived: true, createdAt: new Date("2025-06-01") }),
    ]);
    expect(plan.existingDuplicates[0]).toMatchObject({
      contactId: "00000000-0000-4000-8000-000000000001",
      archived: true,
      otherMatches: 1,
    });
  });
});

describe("variantes de format", () => {
  const sample = [
    ENGLISH_HEADERS.slice(),
    row({ firstName: "Zoé", lastName: "Œuvray", email1: "zoe@exemple.fr", company: "Café, Thé & Co", notes: "Ligne 1\r\nLigne 2" }),
  ];

  it("lit un fichier UTF-8 sans BOM", () => {
    const parsed = parseOk(utf8(csv(sample)));
    expect(parsed.encoding).toBe("utf-8");
    expect(parsed.candidates[0]).toMatchObject({ firstName: "Zoé", organizationName: "Café, Thé & Co" });
  });

  it("lit un fichier séparé par des points-virgules", () => {
    const parsed = parseOk(utf8(csv(sample, ";")));
    expect(parsed.candidates[0]).toMatchObject({ lastName: "Œuvray", organizationName: "Café, Thé & Co" });
    expect(parsed.candidates[0].notes).toBe("Ligne 1\nLigne 2");
  });

  it("lit un fichier Windows-1252 (Outlook classique)", () => {
    const text = csv([
      ["Prénom", "Nom", "Adresse de messagerie", "Société", "Notes"],
      ["Hélène", "D’Arc", "helene@exemple.fr", "Tarif 10 €", "œuvre"],
    ]);
    const parsed = parseOk(windows1252(text));
    expect(parsed.encoding).toBe("windows-1252");
    expect(parsed.candidates[0]).toMatchObject({
      firstName: "Hélène",
      lastName: "D’Arc",
      organizationName: "Tarif 10 €",
      notes: "œuvre",
    });
  });

  it("lit un fichier UTF-16LE, avec ou sans BOM", () => {
    for (const bom of [true, false]) {
      const parsed = parseOk(utf16le(csv(sample), bom));
      expect(parsed.encoding).toBe("utf-16le");
      expect(parsed.candidates[0].firstName).toBe("Zoé");
    }
  });

  it("reconnaît les en-têtes français, quelles que soient la casse et les espaces", () => {
    const text = csv([
      [" PRÉNOM ", "nom", "Adresse de  messagerie", "Adresse de messagerie 2", "Tél. mobile", "Société", "Fonction", "Anniversaire", "Rue (domicile)", "Conjoint(e)", "Catégories"],
      ["Luc", "Bernard", "luc@exemple.fr", "luc.perso@exemple.fr", "06 00 00 00 01", "ACME", "DAF", "14/05/1980", "1 rue privée", "Anne", "VIP"],
    ]);
    const parsed = parseOk(windows1252(text));
    expect(parsed.header.language).toBe("fr");
    expect(parsed.header.unknown).toEqual(["Catégories"]);
    expect(parsed.candidates[0]).toMatchObject({
      firstName: "Luc",
      lastName: "Bernard",
      email: "luc@exemple.fr",
      phone: "06 00 00 00 01",
      organizationName: "ACME",
      jobTitle: "DAF",
    });
    // J/M/AAAA en français ; adresse personnelle et conjoint jamais repris.
    expect(parsed.candidates[0].notes).toBe(
      ["— Import Outlook —", "E-mail 2 : luc.perso@exemple.fr", "Date de naissance : 14/05/1980"].join("\n"),
    );
  });

  it("lit M/J/AAAA avec des en-têtes anglais", () => {
    const parsed = parseOk(utf8(csv([ENGLISH_HEADERS.slice(), row({ lastName: "A", birthday: "5/14/1980" })])));
    expect(parsed.candidates[0].notes).toContain("Date de naissance : 14/05/1980");
  });

  it("ignore les lignes vides", () => {
    const text = csv(sample) + "\r\n\r\n,,,\r\n" + csv([row({ lastName: "Second" })]) + "\r\n\r\n";
    const parsed = parseOk(utf8(text));
    expect(parsed.rowCount).toBe(2);
    expect(parsed.candidates.map((c) => c.lastName)).toEqual(["Œuvray", "Second"]);
  });

  it("écarte les données personnelles non nécessaires (minimisation RGPD)", () => {
    const parsed = parseOk(
      utf8(
        csv([
          ENGLISH_HEADERS.slice(),
          row({
            lastName: "Durand",
            homeStreet: "3 allée privée",
            homeCity: "Lyon",
            homePostalCode: "69000",
            homeCountry: "France",
            spouse: "Claire",
            schools: "Lycée",
            hobby: "Voile",
            anniversary: "2010-06-12",
            givenYomi: "x",
            pager: "123",
            telex: "456",
          }),
        ]),
      ),
    );
    expect(parsed.candidates[0].notes).toBeNull();
    expect(parsed.issues).toEqual([]);
  });
});

describe("sort de chacune des 61 colonnes", () => {
  it("chaque valeur importée ou notée se retrouve, aucune valeur ignorée ne passe", () => {
    const values = Object.fromEntries(
      OUTLOOK_COLUMNS.map((c, i) => {
        if (c.key.startsWith("email")) return [c.key, `v${i}@exemple.fr`];
        if (/phone|fax/i.test(c.key) || c.key === "pager" || c.key === "telex" || c.key === "callback") {
          return [c.key, `01 00 00 00 ${String(i).padStart(2, "0")}`];
        }
        if (c.key === "birthday" || c.key === "anniversary") return [c.key, "1980-05-14"];
        return [c.key, `[valeur${i}]`];
      }),
    );
    const parsed = parseOk(utf8(csv([ENGLISH_HEADERS.slice(), row(values)])));
    expect(parsed.issues).toEqual([]);
    const c = parsed.candidates[0];
    const stored = [c.firstName, c.lastName, c.email, c.phone, c.jobTitle, c.organizationName, c.notes].join("\n");

    for (const column of OUTLOOK_COLUMNS) {
      const value = values[column.key];
      const expected = column.key === "birthday" ? "14/05/1980" : value;
      if (column.key === "anniversary") {
        expect(stored, column.english).not.toContain("1980-05-14");
      } else if (column.fate === "ignore") {
        expect(stored, column.english).not.toContain(value);
      } else {
        expect(stored, column.english).toContain(expected);
      }
    }
  });
});

describe("anomalies de ligne : signalées sans bloquer", () => {
  it("un e-mail invalide est signalé, le suivant devient principal", () => {
    const parsed = parseOk(
      utf8(csv([ENGLISH_HEADERS.slice(), row({ lastName: "X", email1: "pas-un-email", email2: " Bon@Exemple.fr " })])),
    );
    expect(parsed.candidates[0]).toMatchObject({ email: "Bon@Exemple.fr", emailKey: "bon@exemple.fr" });
    expect(parsed.candidates[0].notes).toContain("E-mail (invalide) : pas-un-email");
    expect(parsed.issues).toEqual([expect.objectContaining({ line: 2, level: "warning" })]);
  });

  it("une date illisible est ignorée avec un avertissement ; 0/0/00 sans avertissement", () => {
    const parsed = parseOk(
      utf8(
        csv([
          ENGLISH_HEADERS.slice(),
          row({ lastName: "A", birthday: "31/31/1980" }),
          row({ lastName: "B", birthday: "0/0/00" }),
        ]),
      ),
    );
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates.every((c) => c.notes === null)).toBe(true);
    expect(parsed.issues).toEqual([expect.objectContaining({ line: 2, level: "warning" })]);
  });

  it("rejette une ligne sans aucun élément d'identification", () => {
    const parsed = parseOk(
      utf8(csv([ENGLISH_HEADERS.slice(), row({ mobilePhone: "06 00 00 00 00" }), row({ lastName: "Ok" })])),
    );
    expect(parsed.candidates.map((c) => c.lastName)).toEqual(["Ok"]);
    expect(parsed.issues).toEqual([expect.objectContaining({ line: 2, level: "error" })]);
  });

  it("tronque des notes trop longues avec un avertissement", () => {
    const parsed = parseOk(utf8(csv([ENGLISH_HEADERS.slice(), row({ lastName: "A", notes: "x".repeat(2500) })])));
    expect(parsed.candidates[0].notes).toHaveLength(2000);
    expect(parsed.issues[0].level).toBe("warning");
  });
});

describe("fichiers refusés", () => {
  it("fichier vide", () => {
    expect(parseOutlookCsv(new Uint8Array())).toEqual({ ok: false, error: "Le fichier est vide." });
    expect(parseOutlookCsv(utf8("\r\n\r\n"))).toEqual({ ok: false, error: "Le fichier est vide." });
  });

  it("en-têtes seuls", () => {
    const parsed = parseOutlookCsv(utf8(csv([ENGLISH_HEADERS.slice()]) + "\r\n"));
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining("que l'en-tête") });
  });

  it("en-tête non reconnu", () => {
    const parsed = parseOutlookCsv(utf8("foo,bar\r\n1,2"));
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining("En-tête non reconnu") });
  });

  it("fichier trop gros", () => {
    const parsed = parseOutlookCsv(new Uint8Array(IMPORT_MAX_BYTES + 1));
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining("2,5 Mo maximum") });
  });

  it("trop de lignes", () => {
    const lines = ["Last Name", ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `N${i}`)];
    const parsed = parseOutlookCsv(utf8(lines.join("\r\n")));
    expect(parsed).toEqual({ ok: false, error: expect.stringMatching(/5\s000 maximum/) });
  });
});

describe("briques", () => {
  it("parseOutlookDate", () => {
    expect(parseOutlookDate("1980-05-14", "MDY")).toEqual({ kind: "date", iso: "1980-05-14" });
    expect(parseOutlookDate("5/14/1980", "MDY")).toEqual({ kind: "date", iso: "1980-05-14" });
    expect(parseOutlookDate("14/5/1980", "DMY")).toEqual({ kind: "date", iso: "1980-05-14" });
    expect(parseOutlookDate("14/5/1980", "MDY")).toEqual({ kind: "invalid" });
    expect(parseOutlookDate("2/30/1980", "MDY")).toEqual({ kind: "invalid" });
    expect(parseOutlookDate("0/0/00", "MDY")).toEqual({ kind: "empty" });
    expect(parseOutlookDate("1/1/4501", "MDY")).toEqual({ kind: "empty" });
    expect(parseOutlookDate("demain", "MDY")).toEqual({ kind: "invalid" });
  });

  it("décode le BOM UTF-8 sans le laisser dans le texte", () => {
    const decoded = decodeCsvBytes(fixtureBytes());
    expect(decoded).toMatchObject({ encoding: "utf-8", hadBom: true });
    expect(decoded.text.startsWith("First Name")).toBe(true);
  });

  it("garde la première colonne en cas d'en-tête en double", () => {
    const mapping = mapOutlookHeader(["Last Name", "Nom"]);
    expect(mapping.indexes.lastName).toBe(0);
    expect(mapping.unknown).toEqual(["Nom"]);
  });
});
