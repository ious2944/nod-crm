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
 * - Ligne **sans e-mail** : « doublon probable » si un contact du workspace
 *   (archivé compris) a le même prénom + nom + organisation (normalisés) ou
 *   le même téléphone. Ignorée par défaut ; l'utilisateur peut la cocher pour
 *   l'importer quand même (`includeLines`).
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

/** Ce qu'il faut d'un contact existant pour juger un doublon probable. */
export interface ExistingIdentity {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  organizationName: string | null;
  phone: string | null;
  archived: boolean;
  createdAt: Date;
}

export type ProbableReason = "identity" | "phone";

export interface ProbableDuplicate {
  line: number;
  contactId: string;
  contactName: string;
  archived: boolean;
  reasons: ProbableReason[];
  candidate: ImportCandidate;
}

export interface ImportPlan {
  toCreate: ImportCandidate[];
  fileDuplicates: FileDuplicate[];
  existingDuplicates: ExistingDuplicate[];
  /** Lignes sans e-mail ressemblant à un contact existant, non importées. */
  probableDuplicates: ProbableDuplicate[];
}

/** Casse, accents et espaces neutralisés. */
function normalizeText(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

/** Prénom + nom + organisation normalisés ; `null` si les trois sont vides. */
export function identityKey(contact: {
  firstName: string;
  lastName: string;
  organizationName: string | null;
}): string | null {
  const parts = [contact.firstName, contact.lastName, contact.organizationName].map(normalizeText);
  return parts.some(Boolean) ? parts.join("\u0000") : null;
}

/**
 * Téléphone réduit à ses chiffres, `+33` / `0033` ramenés au `0` national.
 * Moins de 8 chiffres : trop court pour affirmer quoi que ce soit.
 */
export function phoneKey(phone: string | null): string | null {
  if (!phone) return null;
  // « +33 (0)6 … » : le (0) facultatif des numéros internationaux.
  let digits = phone.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (digits.startsWith("0033")) digits = `0${digits.slice(4)}`;
  else if (phone.trim().startsWith("+33")) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 ? digits : null;
}

function indexBy<T>(items: T[], key: (item: T) => string | null): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (k && !map.has(k)) map.set(k, item);
  }
  return map;
}

const isEmpty = (value: string | null) => value === null || value.trim() === "";

export function fillableFields(existing: ExistingContact, candidate: ImportCandidate): FillableField[] {
  return (Object.keys(FILLABLE_FIELDS) as FillableField[]).filter(
    (field) => isEmpty(existing[field]) && !isEmpty(candidate[field]),
  );
}

export function planImport(
  candidates: ImportCandidate[],
  existing: ExistingContact[],
  identities: ExistingIdentity[] = [],
  includeLines: ReadonlySet<number> = new Set(),
): ImportPlan {
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

  const byAge = [...identities].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const byIdentity = indexBy(byAge, identityKey);
  const byPhone = indexBy(byAge, (contact) => phoneKey(contact.phone));

  const seen = new Map<string, ImportCandidate>();
  const plan: ImportPlan = { toCreate: [], fileDuplicates: [], existingDuplicates: [], probableDuplicates: [] };

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
    } else if (!includeLines.has(candidate.line)) {
      const identityKeyValue = identityKey(candidate);
      const phoneKeyValue = phoneKey(candidate.phone);
      const byName = identityKeyValue ? byIdentity.get(identityKeyValue) : undefined;
      const byTel = phoneKeyValue ? byPhone.get(phoneKeyValue) : undefined;
      const target = byName ?? byTel;
      if (target) {
        plan.probableDuplicates.push({
          line: candidate.line,
          contactId: target.id,
          contactName: contactDisplayName(target),
          archived: target.archived,
          reasons: [...(byName ? ["identity" as const] : []), ...(byTel ? ["phone" as const] : [])],
          candidate,
        });
        continue;
      }
    }
    plan.toCreate.push(candidate);
  }

  return plan;
}
