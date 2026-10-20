import { contactDisplayName } from "../view";
import type { ImportCandidate, ImportDetail } from "./parse";

/**
 * Doublons — fonction pure.
 *
 * Clé : l'e-mail principal en minuscules. Un contact sans e-mail n'est jamais
 * un doublon (le nom seul ne suffit pas à affirmer que c'est la même personne).
 *
 * - Dans le fichier : la première occurrence est gardée, les suivantes sont
 *   écartées, avec la liste de ce qu'elles apportaient et qui sera perdu.
 * - Avec la base : le contact existant (archivé compris) est retrouvé ; selon
 *   le choix de l'utilisateur, on l'ignore ou on complète ses champs vides.
 *   Une valeur déjà présente n'est jamais remplacée.
 */

export type DuplicateMode = "skip" | "complete";

export interface ExistingContact {
  id: string;
  emailKey: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  organizationId: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: Date;
}

export interface FileDuplicate {
  line: number;
  keptLine: number;
  email: string;
  /** Ce que la ligne écartée apportait et que la ligne gardée n'a pas. */
  lost: ImportDetail[];
}

/** Champs qu'un import peut compléter, avec leur libellé d'aperçu. */
export const FILLABLE_FIELDS = {
  firstName: "Prénom",
  lastName: "Nom",
  phone: "Téléphone",
  jobTitle: "Fonction",
  organizationName: "Entreprise",
  notes: "Notes",
} as const;

export type FillableField = keyof typeof FILLABLE_FIELDS;

export interface ExistingDuplicate {
  line: number;
  contactId: string;
  contactName: string;
  archived: boolean;
  /** Autres contacts existants avec la même adresse (non touchés). */
  otherMatches: number;
  /** Champs vides du contact existant que la ligne remplirait. */
  fillable: FillableField[];
  candidate: ImportCandidate;
}

export interface ImportPlan {
  toCreate: ImportCandidate[];
  fileDuplicates: FileDuplicate[];
  existingDuplicates: ExistingDuplicate[];
}

const isEmpty = (value: string | null) => value === null || value.trim() === "";

export function fillableFields(existing: ExistingContact, candidate: ImportCandidate): FillableField[] {
  return (Object.keys(FILLABLE_FIELDS) as FillableField[]).filter(
    (field) => isEmpty(existing[field]) && !isEmpty(candidate[field]),
  );
}

export function planImport(candidates: ImportCandidate[], existing: ExistingContact[]): ImportPlan {
  const existingByKey = new Map<string, ExistingContact[]>();
  for (const contact of existing) {
    const list = existingByKey.get(contact.emailKey) ?? [];
    list.push(contact);
    existingByKey.set(contact.emailKey, list);
  }
  // Le plus ancien d'abord : c'est lui qu'on complète s'il y en a plusieurs.
  for (const list of existingByKey.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  const seen = new Map<string, ImportCandidate>();
  const plan: ImportPlan = { toCreate: [], fileDuplicates: [], existingDuplicates: [] };

  for (const candidate of candidates) {
    const key = candidate.emailKey;
    if (key) {
      const kept = seen.get(key);
      if (kept) {
        const keptValues = new Set(kept.details.map((d) => `${d.label}\u0000${d.value}`));
        plan.fileDuplicates.push({
          line: candidate.line,
          keptLine: kept.line,
          email: candidate.email!,
          lost: candidate.details.filter(
            (d) => d.label !== "E-mail" && !keptValues.has(`${d.label}\u0000${d.value}`),
          ),
        });
        continue;
      }
      seen.set(key, candidate);

      const matches = existingByKey.get(key);
      if (matches?.length) {
        const [target] = matches;
        plan.existingDuplicates.push({
          line: candidate.line,
          contactId: target.id,
          contactName: contactDisplayName(target),
          archived: target.archived,
          otherMatches: matches.length - 1,
          fillable: fillableFields(target, candidate),
          candidate,
        });
        continue;
      }
    }
    plan.toCreate.push(candidate);
  }

  return plan;
}
