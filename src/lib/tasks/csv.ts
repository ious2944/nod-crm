/**
 * Import / export CSV — fonctions pures.
 *
 * Séparateur `;` à l'export (Excel en français l'attend), détection
 * automatique `;` / `,` / tabulation à l'import. Guillemets RFC 4180.
 *
 * Protection contre l'injection de formules : toute cellule exportée qui
 * commence par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée
 * d'une apostrophe — un tableur ne l'exécutera pas.
 */

export function escapeCell(value: string, separator = ";"): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (text.includes(separator) || /["\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: readonly (readonly string[])[], separator = ";"): string {
  // BOM : Excel détecte ainsi l'UTF-8 et affiche correctement les accents.
  return "﻿" + rows.map((row) => row.map((cell) => escapeCell(cell, separator)).join(separator)).join("\r\n");
}

function detectSeparator(firstLine: string): string {
  const counts = [";", ",", "\t"].map((sep) => ({ sep, n: firstLine.split(sep).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].sep : ";";
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const separator = detectSeparator(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Colonnes reconnues à l'import (insensibles à la casse et aux accents). */
export const CSV_COLUMNS = {
  title: ["nom", "titre", "tache", "name", "title", "task"],
  description: ["description", "notes", "note"],
  assignee: ["responsable", "assignee", "affecte a", "email responsable"],
  dueDate: ["echeance", "date d'echeance", "due date", "due"],
  startDate: ["debut", "date de debut", "start date", "start"],
  status: ["statut", "status", "etat"],
  priority: ["priorite", "priority"],
  section: ["section", "colonne"],
  tags: ["tags", "etiquettes"],
  estimate: ["estimation", "temps estime", "estimation (min)", "estimate"],
} as const;

export type CsvColumnKey = keyof typeof CSV_COLUMNS;

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function mapHeader(header: readonly string[]): Partial<Record<CsvColumnKey, number>> {
  const mapping: Partial<Record<CsvColumnKey, number>> = {};
  header.forEach((raw, index) => {
    const name = norm(raw);
    for (const [key, aliases] of Object.entries(CSV_COLUMNS) as [CsvColumnKey, readonly string[]][]) {
      if (mapping[key] === undefined && aliases.includes(name)) mapping[key] = index;
    }
  });
  return mapping;
}

/** Date française `JJ/MM/AAAA` ou ISO `AAAA-MM-JJ` → clé ISO, sinon `null`. */
export function parseCsvDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  const fr = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (fr) [y, m, d] = [Number(fr[3]), Number(fr[2]), Number(fr[1])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const STATUS_ALIASES: Record<string, "TODO" | "IN_PROGRESS" | "WAITING" | "DONE"> = {
  "a faire": "TODO",
  todo: "TODO",
  "en cours": "IN_PROGRESS",
  "in progress": "IN_PROGRESS",
  "en attente": "WAITING",
  waiting: "WAITING",
  termine: "DONE",
  terminee: "DONE",
  done: "DONE",
  fait: "DONE",
};

const PRIORITY_ALIASES: Record<string, "LOW" | "NORMAL" | "HIGH" | "URGENT"> = {
  basse: "LOW",
  low: "LOW",
  normale: "NORMAL",
  normal: "NORMAL",
  haute: "HIGH",
  high: "HIGH",
  urgente: "URGENT",
  urgent: "URGENT",
};

export function parseCsvStatus(value: string) {
  return STATUS_ALIASES[norm(value)] ?? null;
}

export function parseCsvPriority(value: string) {
  return PRIORITY_ALIASES[norm(value)] ?? null;
}

/** Estimation : `90`, `1h30`, `1,5 h`, `45 min` → minutes. */
export function parseCsvMinutes(value: string): number | null {
  const text = norm(value).replace(",", ".");
  if (!text) return null;
  const hm = /^(\d+(?:\.\d+)?)\s*h\s*(\d+)?\s*(?:min)?$/.exec(text);
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  const min = /^(\d+)\s*(?:min|m)?$/.exec(text);
  if (min) return Number(min[1]);
  return null;
}
