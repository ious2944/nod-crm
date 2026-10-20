import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";
import { parseCsv } from "@/lib/tasks/csv";

import { CONTACT_LIMITS, isPlausiblePhone } from "../schemas";
import { decodeCsvBytes, type CsvEncoding } from "./decode";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, tooLargeMessage } from "./limits";
import {
  columnLabel,
  mapOutlookHeader,
  PRINCIPAL_EMAIL_ORDER,
  PRINCIPAL_PHONE_ORDER,
  type HeaderMapping,
  type OutlookColumnKey,
} from "./outlook-columns";

/**
 * Lecture d'un export Outlook — fonctions pures, sans base ni session.
 *
 * Le fichier est décodé (`decode.ts`), découpé par le parseur CSV commun
 * (`lib/tasks/csv.ts` : guillemets, retours à la ligne dans un champ, `,` ou
 * `;` détecté), puis chaque ligne devient un *candidat* : les champs que le
 * contact sait porter, et des notes pour tout le reste.
 *
 * Une anomalie de ligne (e-mail invalide, date illisible, champ trop long) est
 * un **avertissement** : la ligne est importée sans la valeur fautive. Seule
 * une ligne impossible à identifier est une **erreur** et n'est pas importée.
 */

export interface ImportIssue {
  /** Numéro d'enregistrement, en-tête = 1, lignes vides non comptées. */
  line: number;
  level: "error" | "warning";
  message: string;
}

export interface ImportDetail {
  label: string;
  value: string;
}

export interface ImportCandidate {
  line: number;
  firstName: string;
  lastName: string;
  email: string | null;
  /** E-mail principal en minuscules : la clé de doublon. */
  emailKey: string | null;
  phone: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  notes: string | null;
  /** Ce que la ligne apporte, pour l'aperçu et le signalement des doublons. */
  details: ImportDetail[];
}

export type ParsedImport =
  | { ok: false; error: string }
  | {
      ok: true;
      encoding: CsvEncoding;
      rowCount: number;
      header: HeaderMapping;
      candidates: ImportCandidate[];
      issues: ImportIssue[];
    };

const NOTES_HEADING = "— Import Outlook —";

const oneLine = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ");

export type OutlookDate =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "date"; iso: string };

/**
 * Date d'anniversaire Outlook : `AAAA-MM-JJ`, ou `M/J/AAAA` (export anglais)
 * / `J/M/AAAA` (Outlook classique en français). `0/0/00` est la valeur
 * qu'Outlook écrit pour « pas de date » (comme `1/1/4501`) : on la traite
 * comme vide, sans avertissement.
 */
export function parseOutlookDate(raw: string, order: "MDY" | "DMY"): OutlookDate {
  const text = raw.trim();
  if (!text || /^[0/.\-\s:]+$/.test(text)) return { kind: "empty" };

  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T][\d:.]+Z?)?$/.exec(text);
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: [\d:]+(?: ?[AP]M)?)?$/i.exec(text);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slash) {
    const [a, b] = [Number(slash[1]), Number(slash[2])];
    y = Number(slash[3]);
    [m, d] = order === "MDY" ? [a, b] : [b, a];
  } else {
    return { kind: "invalid" };
  }

  // 4501 : autre « pas de date » d'Outlook (1/1/4501).
  if (y === 4501) return { kind: "empty" };
  if (y < 1900 || y > 2100) return { kind: "invalid" };
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { kind: "invalid" };
  }
  return { kind: "date", iso: date.toISOString().slice(0, 10) };
}

function isoToFrench(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const emailSchema = z.email();

/** Espaces retirés (y compris au milieu, fréquents après un copier-coller). */
export function cleanEmail(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function isValidEmail(value: string): boolean {
  return value.length <= CONTACT_LIMITS.email && emailSchema.safeParse(value).success;
}

/** Les champs d'adresse, regroupés en un bloc lisible par adresse. */
const ADDRESS_BLOCKS = [
  {
    label: "Adresse professionnelle",
    street: "businessStreet",
    city: "businessCity",
    state: "businessState",
    postalCode: "businessPostalCode",
    country: "businessCountry",
  },
  {
    label: "Autre adresse",
    street: "otherStreet",
    city: "otherCity",
    state: "otherState",
    postalCode: "otherPostalCode",
    country: "otherCountry",
  },
] as const;

/**
 * Colonnes « notes » simples, dans l'ordre de l'export. Les autres colonnes
 * « notes » sont traitées à part : e-mails 2 et 3, adresses, date de naissance.
 */
const SIMPLE_NOTE_KEYS: OutlookColumnKey[] = [
  "title",
  "suffix",
  "nickname",
  "carPhone",
  "businessFax",
  "homeFax",
  "otherFax",
  "imAddress",
  "department",
  "officeLocation",
  "managerName",
  "assistantName",
  "assistantPhone",
  "personalWebPage",
  "location",
  "webPage",
];

function bounded(
  value: string,
  max: number,
  label: string,
  line: number,
  issues: ImportIssue[],
): string {
  if (value.length <= max) return value;
  issues.push({ line, level: "warning", message: `${label} tronqué à ${max} caractères.` });
  return value.slice(0, max);
}

function buildCandidate(
  row: readonly string[],
  line: number,
  header: HeaderMapping,
  issues: ImportIssue[],
): ImportCandidate | null {
  const get = (key: OutlookColumnKey): string => {
    const index = header.indexes[key];
    return index === undefined ? "" : sanitizeText(row[index] ?? "");
  };
  const details: ImportDetail[] = [];
  const noteLines: ImportDetail[] = [];

  // Identité.
  const firstName = bounded(
    oneLine([get("firstName"), get("middleName")].filter(Boolean).join(" ")),
    CONTACT_LIMITS.firstName,
    "Prénom",
    line,
    issues,
  );
  const lastName = bounded(oneLine(get("lastName")), CONTACT_LIMITS.lastName, "Nom", line, issues);
  if (firstName) details.push({ label: "Prénom", value: firstName });
  if (lastName) details.push({ label: "Nom", value: lastName });

  // E-mails : le premier valide devient principal, les autres vont en notes.
  let email: string | null = null;
  for (const key of PRINCIPAL_EMAIL_ORDER) {
    const value = cleanEmail(get(key));
    if (!value) continue;
    const label = columnLabel(key);
    if (!isValidEmail(value)) {
      issues.push({ line, level: "warning", message: `${label} invalide (« ${value.slice(0, 80)} ») : gardé dans les notes.` });
      noteLines.push({ label: `${label} (invalide)`, value });
    } else if (!email) {
      email = value;
    } else {
      noteLines.push({ label, value });
    }
  }
  if (email) details.push({ label: "E-mail", value: email });

  // Téléphones : le premier numéro plausible, dans l'ordre de préférence.
  let phone: string | null = null;
  for (const key of PRINCIPAL_PHONE_ORDER) {
    const value = oneLine(get(key));
    if (!value) continue;
    const label = columnLabel(key);
    if (!phone && value.length <= CONTACT_LIMITS.phone && isPlausiblePhone(value)) {
      phone = value;
      details.push({ label, value });
    } else {
      if (!isPlausiblePhone(value)) {
        issues.push({ line, level: "warning", message: `${label} non reconnu comme numéro : gardé dans les notes.` });
      }
      noteLines.push({ label, value });
    }
  }

  const jobTitle =
    bounded(oneLine(get("jobTitle")), CONTACT_LIMITS.jobTitle, "Fonction", line, issues) || null;
  if (jobTitle) details.push({ label: "Fonction", value: jobTitle });
  const organizationName =
    bounded(oneLine(get("company")), CONTACT_LIMITS.organizationName, "Entreprise", line, issues) || null;
  if (organizationName) details.push({ label: "Entreprise", value: organizationName });

  if (!firstName && !lastName && !email && !organizationName) {
    issues.push({
      line,
      level: "error",
      message: "Ni prénom, ni nom, ni e-mail valide, ni entreprise : ligne non importée.",
    });
    return null;
  }

  // Le reste, en notes.
  for (const key of SIMPLE_NOTE_KEYS) {
    const value = oneLine(get(key));
    if (value) noteLines.push({ label: columnLabel(key), value });
  }
  for (const block of ADDRESS_BLOCKS) {
    const cityLine = [get(block.postalCode), get(block.city)].filter(Boolean).join(" ");
    const parts = [get(block.street), cityLine, get(block.state), get(block.country)]
      .map((part) => oneLine(part).replace(/ {2,}/g, " "))
      .filter(Boolean);
    if (parts.length) noteLines.push({ label: block.label, value: parts.join(", ") });
  }
  const birthdayRaw = get("birthday");
  const birthday = parseOutlookDate(birthdayRaw, header.language === "fr" ? "DMY" : "MDY");
  if (birthday.kind === "date") {
    noteLines.push({ label: columnLabel("birthday"), value: isoToFrench(birthday.iso) });
  } else if (birthday.kind === "invalid") {
    issues.push({
      line,
      level: "warning",
      message: `Date de naissance illisible (« ${oneLine(birthdayRaw).slice(0, 40)} ») : ignorée.`,
    });
  }

  const outlookNotes = get("notes").replace(/\r\n?/g, "\n");
  if (outlookNotes) details.push({ label: "Notes", value: outlookNotes });
  details.push(...noteLines);

  let notes = outlookNotes;
  if (noteLines.length) {
    const block = [NOTES_HEADING, ...noteLines.map(({ label, value }) => `${label} : ${value}`)].join("\n");
    notes = notes ? `${notes}\n\n${block}` : block;
  }
  if (notes.length > CONTACT_LIMITS.notes) {
    issues.push({
      line,
      level: "warning",
      message: `Notes tronquées à ${CONTACT_LIMITS.notes} caractères.`,
    });
    notes = `${notes.slice(0, CONTACT_LIMITS.notes - 1)}…`;
  }

  return {
    line,
    firstName,
    lastName,
    email,
    emailKey: email ? email.toLowerCase() : null,
    phone,
    jobTitle,
    organizationName,
    notes: notes || null,
    details,
  };
}

/** Octets → candidats. Ne lève pas : un fichier inexploitable rend `ok: false`. */
export function parseOutlookCsv(bytes: Uint8Array): ParsedImport {
  if (bytes.length === 0) return { ok: false, error: "Le fichier est vide." };
  if (bytes.length > IMPORT_MAX_BYTES) {
    return { ok: false, error: tooLargeMessage(bytes.length) };
  }

  const { text, encoding } = decodeCsvBytes(bytes);
  const rows = parseCsv(text);
  if (rows.length === 0) return { ok: false, error: "Le fichier est vide." };

  const header = mapOutlookHeader(rows[0]);
  const identifying: OutlookColumnKey[] = ["firstName", "lastName", "email1", "company"];
  if (!identifying.some((key) => header.indexes[key] !== undefined)) {
    return {
      ok: false,
      error:
        "En-tête non reconnu : il faut au moins une colonne First Name, Last Name, E-mail Address ou Company (ou Prénom, Nom, Adresse de messagerie, Société).",
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    return { ok: false, error: "Le fichier ne contient que l'en-tête : aucun contact à importer." };
  }
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `Le fichier contient ${dataRows.length.toLocaleString("fr-FR")} lignes : ${IMPORT_MAX_ROWS.toLocaleString("fr-FR")} maximum par import. Découpe l'export en plusieurs fichiers.`,
    };
  }

  const issues: ImportIssue[] = [];
  const candidates: ImportCandidate[] = [];
  const width = rows[0].length;
  dataRows.forEach((row, index) => {
    const line = index + 2;
    if (row.length !== width) {
      issues.push({
        line,
        level: "warning",
        message: `${row.length} colonnes au lieu de ${width} : vérifie les guillemets de cette ligne.`,
      });
    }
    const candidate = buildCandidate(row, line, header, issues);
    if (candidate) candidates.push(candidate);
  });

  return { ok: true, encoding, rowCount: dataRows.length, header, candidates, issues };
}
