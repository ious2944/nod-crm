import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ENTITY_TYPES } from "@/lib/audit/types";
import { normalizeOrgName } from "@/lib/organizations/domain";
import { prisma } from "@/lib/prisma";

import { contactDisplayName } from "../view";

import { IMPORT_MAX_BYTES, tooLargeMessage } from "./limits";
import { parseOutlookCsv, type ImportCandidate, type ImportIssue } from "./parse";
import {
  FILLABLE_FIELDS,
  planImport,
  type DuplicateMode,
  type ExistingIdentity,
  type ExistingContact,
  type FileDuplicate,
  type ImportPlan,
} from "./plan";

/**
 * Import de contacts Outlook — couche serveur.
 *
 * Deux temps, et le second ne fait pas confiance au premier :
 *
 * 1. `previewImport` lit le fichier et la base, n'écrit rien ;
 * 2. `runImport` reçoit **à nouveau le fichier** et refait toute l'analyse
 *    avant d'écrire. Rien n'est conservé entre les deux (ni fichier, ni
 *    résultat d'aperçu côté serveur), et le navigateur ne peut pas injecter
 *    de contacts « déjà analysés ».
 *
 * Le `workspaceId` vient toujours de l'acteur, c'est-à-dire de la session.
 * Toute lecture et toute écriture le portent dans leur `WHERE`.
 *
 * Journalisation : ni le contenu du fichier ni aucune valeur de contact ne
 * part dans les logs ; en cas d'échec, seul le type d'erreur est écrit.
 */

/** Nombre de lignes écrites par requête, dans la transaction. */
export const IMPORT_BATCH_SIZE = 500;
/** Au-delà, l'aperçu tronque la liste (les compteurs restent exacts). */
const MAX_PREVIEW_ISSUES = 300;
const TRANSACTION_TIMEOUT_MS = 120_000;

export interface ImportActor {
  id: string;
  workspaceId: string;
}

export interface ImportPreview {
  encoding: string;
  rowCount: number;
  recognizedColumns: { header: string; label: string; fate: "import" | "notes" }[];
  ignoredColumns: string[];
  unknownColumns: string[];
  toCreate: number;
  fileDuplicates: FileDuplicate[];
  existingDuplicates: {
    line: number;
    email: string;
    contactName: string;
    archived: boolean;
    otherMatches: number;
    fillable: string[];
  }[];
  /** Lignes sans e-mail qui ressemblent à un contact existant : non importées sauf choix contraire. */
  probableDuplicates: {
    line: number;
    label: string;
    contactName: string;
    archived: boolean;
    reasons: string[];
  }[];
  issues: ImportIssue[];
  errorCount: number;
  warningCount: number;
}

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export type ImportOutcome =
  | { ok: true; created: number; updated: number; skipped: number; rejected: number }
  | { ok: false; error: string };

type Db = Prisma.TransactionClient | typeof prisma;

/** Contrôle du fichier reçu, **avant** d'en lire le contenu. */
export async function readUpload(
  file: FormDataEntryValue | null,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  if (!(file instanceof File)) return { ok: false, error: "Choisis un fichier CSV à importer." };
  if (file.size === 0) return { ok: false, error: "Le fichier est vide." };
  if (file.size > IMPORT_MAX_BYTES) {
    return { ok: false, error: tooLargeMessage(file.size) };
  }
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Contacts du workspace dont l'e-mail correspond à une clé — archivés compris. */
async function findExisting(db: Db, workspaceId: string, keys: string[]): Promise<ExistingContact[]> {
  if (keys.length === 0) return [];
  return db.$queryRaw<ExistingContact[]>`
    SELECT id,
           lower(regexp_replace(email, '\\s+', '', 'g')) AS "emailKey",
           first_name AS "firstName",
           last_name AS "lastName",
           email,
           phone,
           job_title AS "jobTitle",
           organization_name AS "organizationName",
           organization_id AS "organizationId",
           notes,
           archived_at IS NOT NULL AS archived,
           created_at AS "createdAt"
    FROM contacts
    WHERE workspace_id = ${workspaceId}::uuid
      AND lower(regexp_replace(email, '\\s+', '', 'g')) = ANY(${keys}::text[])`;
}

/**
 * Contacts du workspace (archivés compris) pour juger les doublons probables
 * des lignes sans e-mail. La normalisation (accents, préfixe +33) se fait en
 * TypeScript : on lit donc les quatre colonnes utiles de tout le workspace,
 * et seulement si le fichier contient au moins une ligne sans e-mail.
 */
async function findIdentities(db: Db, workspaceId: string): Promise<ExistingIdentity[]> {
  const rows = await db.contact.findMany({
    where: { workspaceId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      organizationName: true,
      phone: true,
      archivedAt: true,
      createdAt: true,
    },
  });
  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }));
}

const REASON_LABELS = { identity: "même prénom, nom et organisation", phone: "même téléphone" } as const;

async function analyse(
  db: Db,
  workspaceId: string,
  bytes: Uint8Array,
  includeLines: ReadonlySet<number> = new Set(),
): Promise<
  | { ok: false; error: string }
  | { ok: true; parsed: Extract<ReturnType<typeof parseOutlookCsv>, { ok: true }>; plan: ImportPlan }
> {
  const parsed = parseOutlookCsv(bytes);
  if (!parsed.ok) return parsed;
  const keys = [...new Set(parsed.candidates.flatMap((c) => (c.emailKey ? [c.emailKey] : [])))];
  const existing = await findExisting(db, workspaceId, keys);
  const identities = parsed.candidates.some((c) => !c.emailKey) ? await findIdentities(db, workspaceId) : [];
  return { ok: true, parsed, plan: planImport(parsed.candidates, existing, identities, includeLines) };
}

export async function previewImport(workspaceId: string, bytes: Uint8Array): Promise<PreviewResult> {
  const result = await analyse(prisma, workspaceId, bytes);
  if (!result.ok) return result;
  const { parsed, plan } = result;

  return {
    ok: true,
    preview: {
      encoding: parsed.encoding,
      rowCount: parsed.rowCount,
      recognizedColumns: parsed.header.recognized.flatMap(({ header, label, fate }) =>
        fate === "ignore" ? [] : [{ header, label, fate }],
      ),
      ignoredColumns: parsed.header.recognized.filter((c) => c.fate === "ignore").map((c) => c.header),
      unknownColumns: parsed.header.unknown,
      toCreate: plan.toCreate.length,
      fileDuplicates: plan.fileDuplicates,
      existingDuplicates: plan.existingDuplicates.map((d) => ({
        line: d.line,
        email: d.candidate.email!,
        contactName: d.contactName,
        archived: d.archived,
        otherMatches: d.otherMatches,
        fillable: d.fillable.map((field) => FILLABLE_FIELDS[field]),
      })),
      probableDuplicates: plan.probableDuplicates.map((d) => ({
        line: d.line,
        label: contactDisplayName(d.candidate),
        contactName: d.contactName,
        archived: d.archived,
        reasons: d.reasons.map((reason) => REASON_LABELS[reason]),
      })),
      issues: parsed.issues.slice(0, MAX_PREVIEW_ISSUES),
      errorCount: parsed.issues.filter((i) => i.level === "error").length,
      warningCount: parsed.issues.filter((i) => i.level === "warning").length,
    },
  };
}

/** Rattachement par nom normalisé, seulement s'il est sans ambiguïté. */
async function organizationResolver(db: Db, workspaceId: string) {
  const organizations = await db.organization.findMany({
    where: { workspaceId, archivedAt: null },
    select: { id: true, name: true },
  });
  const byName = new Map<string, string | null>();
  for (const org of organizations) {
    const key = normalizeOrgName(org.name);
    byName.set(key, byName.has(key) ? null : org.id);
  }
  return (name: string | null) => (name ? (byName.get(normalizeOrgName(name)) ?? null) : null);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const toRow = (workspaceId: string, c: ImportCandidate, organizationId: string | null) => ({
  workspaceId,
  firstName: c.firstName,
  lastName: c.lastName,
  email: c.email,
  phone: c.phone,
  jobTitle: c.jobTitle,
  organizationName: c.organizationName,
  organizationId,
  notes: c.notes,
});

/**
 * Complète les champs vides, par lot, en une requête.
 *
 * La règle « on n'écrase jamais » est **dans le SQL** : chaque colonne ne
 * prend la valeur importée que si elle est vide au moment de l'écriture, même
 * si la fiche a changé depuis l'aperçu.
 */
async function completeBatch(
  db: Prisma.TransactionClient,
  workspaceId: string,
  rows: { id: string; candidate: ImportCandidate; organizationId: string | null }[],
): Promise<string[]> {
  const values = Prisma.join(
    rows.map(
      ({ id, candidate: c, organizationId }) =>
        Prisma.sql`(${id}::uuid, ${c.firstName}::text, ${c.lastName}::text, ${c.phone}::text, ${c.jobTitle}::text, ${c.organizationName}::text, ${organizationId}::uuid, ${c.notes}::text)`,
    ),
  );
  const updated = await db.$queryRaw<{ id: string }[]>`
    UPDATE contacts AS c SET
      first_name = CASE WHEN btrim(c.first_name) = '' THEN v.first_name ELSE c.first_name END,
      last_name = CASE WHEN btrim(c.last_name) = '' THEN v.last_name ELSE c.last_name END,
      phone = COALESCE(NULLIF(btrim(c.phone), ''), v.phone),
      job_title = COALESCE(NULLIF(btrim(c.job_title), ''), v.job_title),
      organization_id = COALESCE(
        c.organization_id,
        CASE WHEN NULLIF(btrim(c.organization_name), '') IS NULL THEN v.organization_id END
      ),
      organization_name = COALESCE(NULLIF(btrim(c.organization_name), ''), v.organization_name),
      notes = COALESCE(NULLIF(btrim(c.notes), ''), v.notes),
      updated_at = now()
    FROM (VALUES ${values}) AS v(id, first_name, last_name, phone, job_title, organization_name, organization_id, notes)
    WHERE c.id = v.id AND c.workspace_id = ${workspaceId}::uuid
    RETURNING c.id`;
  return updated.map((row) => row.id);
}

export async function runImport(
  actor: ImportActor,
  bytes: Uint8Array,
  mode: DuplicateMode,
  /** Doublons probables que l'utilisateur a cochés pour les importer quand même. */
  includeLines: ReadonlySet<number> = new Set(),
): Promise<ImportOutcome> {
  const { workspaceId } = actor;

  const outcome = await prisma.$transaction(
    async (tx): Promise<ImportOutcome> => {
      // L'analyse est refaite dans la transaction : les doublons sont jugés
      // sur l'état de la base au moment de l'écriture, pas de l'aperçu.
      const result = await analyse(tx, workspaceId, bytes, includeLines);
      if (!result.ok) return result;
      const { parsed, plan } = result;
      const resolveOrg = await organizationResolver(tx, workspaceId);

      let created = 0;
      for (const batch of chunks(plan.toCreate, IMPORT_BATCH_SIZE)) {
        const { count } = await tx.contact.createMany({
          data: batch.map((c) => toRow(workspaceId, c, resolveOrg(c.organizationName))),
        });
        created += count;
      }

      let updated = 0;
      if (mode === "complete") {
        const toComplete = plan.existingDuplicates
          .filter((d) => d.fillable.length > 0)
          .map((d) => ({
            id: d.contactId,
            candidate: d.candidate,
            organizationId: resolveOrg(d.candidate.organizationName),
          }));
        for (const batch of chunks(toComplete, IMPORT_BATCH_SIZE)) {
          updated += (await completeBatch(tx, workspaceId, batch)).length;
        }
      }

      const errorCount = parsed.issues.filter((i) => i.level === "error").length;
      return {
        ok: true,
        created,
        updated,
        skipped:
          plan.fileDuplicates.length +
          plan.existingDuplicates.length +
          plan.probableDuplicates.length -
          updated,
        rejected: errorCount,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
  );

  // Une seule ligne d'audit pour l'import, une fois la transaction validée.
  if (outcome.ok && outcome.created + outcome.updated > 0) {
    await recordAudit({
      workspaceId,
      userId: actor.id,
      action: "CREATE",
      entityType: AUDIT_ENTITY_TYPES.CONTACT_IMPORT,
      entityId: null,
    });
  }

  return outcome;
}
