#!/usr/bin/env node
/**
 * Contrôle (et, sur demande, réconciliation) de l'historique des migrations
 * du module de gestion de travail V1.0.
 *
 *   node scripts/migration-check.mjs              # lecture seule : diagnostic
 *   node scripts/migration-check.mjs --reconcile  # état C uniquement, après contrôle
 *
 * JavaScript simple avec `pg` : tourne tel quel dans l'image de production
 * (`docker compose run --rm app node scripts/migration-check.mjs`).
 *
 * La migration `20261013120000_work_management` a existé en deux versions sur
 * la branche de développement :
 *   - version d'origine (fichier actuel), empreinte ORIGINAL ;
 *   - version révisée (commit c199fdd), empreinte REVISED : mêmes instructions
 *     de schéma, seules les deux requêtes de remplissage des responsables /
 *     créateurs en avaient été retirées.
 *
 * États reconnus :
 *   A — module jamais appliqué              → `npm run db:deploy` suffit ;
 *   B — version d'origine appliquée         → `npm run db:deploy` suffit ;
 *   C — version révisée appliquée           → `--reconcile`, puis `db:deploy`.
 *
 * `--reconcile` ne réécrit l'empreinte enregistrée de la migration que si
 * TOUTES ces conditions sont vérifiées, dans une transaction :
 *   1. la ligne `_prisma_migrations` porte exactement l'empreinte REVISED, est
 *      terminée et non annulée (état C, rien d'autre) ;
 *   2. chaque objet de schéma créé par la migration (types, tables, colonnes,
 *      index, contraintes) existe dans la base ;
 *   3. aucune autre migration n'a d'empreinte divergente.
 * Sinon, rien n'est écrit et le script sort en erreur. Il n'efface jamais de
 * donnée et ne réinitialise jamais la base.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const V1 = "20261013120000_work_management";
const ORIGINAL = "7a410c8d1807791285ffc3052b7a0c83fb0a9b2e83f45341a3855b35650777c8";
const REVISED = "b7fae256791d133c42b47bdf20cc832e91c35c61cc64b36c76ccfe1a0f5dc792";

const MIGRATIONS = path.resolve(process.env.MIGRATIONS_DIR ?? "prisma/migrations");
const reconcile = process.argv.includes("--reconcile");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Objets de schéma créés par un fichier de migration (analyse des instructions DDL). */
function schemaObjects(sql) {
  const objects = [];
  for (const m of sql.matchAll(/CREATE TYPE "([^"]+)"/g)) objects.push({ kind: "type", name: m[1] });
  for (const m of sql.matchAll(/CREATE TABLE "([^"]+)"/g)) objects.push({ kind: "table", name: m[1] });
  for (const m of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)) objects.push({ kind: "index", name: m[1] });
  for (const m of sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)) objects.push({ kind: "constraint", name: m[1] });
  for (const m of sql.matchAll(/ALTER TABLE "([^"]+)"([^;]*);/g)) {
    for (const c of m[2].matchAll(/ADD COLUMN\s+"([^"]+)"/g)) objects.push({ kind: "column", table: m[1], name: c[1] });
  }
  return objects;
}

async function missingObjects(client, objects) {
  const missing = [];
  for (const o of objects) {
    let ok;
    if (o.kind === "type") {
      ok = (await client.query("SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = $1 AND n.nspname = current_schema()", [o.name])).rowCount > 0;
    } else if (o.kind === "table" || o.kind === "index") {
      ok = (await client.query("SELECT to_regclass(quote_ident(current_schema()) || '.' || quote_ident($1)) IS NOT NULL AS ok", [o.name])).rows[0].ok;
    } else if (o.kind === "constraint") {
      ok = (await client.query("SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = $1 AND n.nspname = current_schema()", [o.name])).rowCount > 0;
    } else {
      ok = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2", [o.table, o.name])).rowCount > 0;
    }
    if (!ok) missing.push(o.kind === "column" ? `colonne ${o.table}.${o.name}` : `${o.kind} ${o.name}`);
  }
  return missing;
}

function connectionConfig(url) {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get("schema") ?? "public";
  parsed.search = "";
  return { connectionString: parsed.toString(), schema };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL est obligatoire.");
    process.exit(2);
  }
  const { connectionString, schema } = connectionConfig(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(`SET search_path TO ${pg.escapeIdentifier(schema)}`);
  try {
    const files = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const hasTable = (await client.query("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS ok")).rows[0].ok;
    const rows = hasTable
      ? (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')).rows
      : [];
    const applied = new Map(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => [r.migration_name, r]));

    const report = [];
    const divergent = [];
    for (const name of files) {
      const fileSum = sha256(path.join(MIGRATIONS, name, "migration.sql"));
      const row = applied.get(name);
      if (!row) report.push(`  ·  ${name} — à appliquer`);
      else if (row.checksum === fileSum) report.push(`  ✓  ${name}`);
      else {
        divergent.push({ name, recorded: row.checksum, fileSum });
        report.push(`  ≠  ${name} — empreinte enregistrée ${row.checksum.slice(0, 12)}…, fichier ${fileSum.slice(0, 12)}…`);
      }
    }
    for (const r of rows) if (!files.includes(r.migration_name)) report.push(`  ?  ${r.migration_name} — enregistrée mais absente du dépôt`);
    for (const r of rows) if (!r.finished_at || r.rolled_back_at) report.push(`  !  ${r.migration_name} — inachevée ou annulée`);

    const v1Row = applied.get(V1);
    const state = !v1Row ? "A" : v1Row.checksum === ORIGINAL ? "B" : v1Row.checksum === REVISED ? "C" : "?";
    const legacyAssigned = v1Row
      ? (await client.query(`SELECT count(*)::int AS n FROM tasks t WHERE t.assignee_id IS NOT NULL AND t.created_at < $1::timestamptz AT TIME ZONE 'UTC'`, [v1Row.finished_at])).rows[0].n
      : 0;

    console.log(`Schéma « ${schema} » — historique des migrations :`);
    console.log(report.join("\n"));
    console.log("");
    console.log(
      {
        A: "État A : le module n'a jamais été appliqué. `npm run db:deploy` suffit.",
        B: "État B : version d'origine de 20261013120000 appliquée. `npm run db:deploy` applique la réconciliation des responsables.",
        C: "État C : version révisée de 20261013120000 appliquée. Réconciliation de l'empreinte nécessaire (`--reconcile`), puis `npm run db:deploy`.",
        "?": "État inconnu : empreinte de 20261013120000 non reconnue. Ne rien modifier ; comparer le schéma à la main.",
      }[state],
    );
    if (v1Row) console.log(`Tâches antérieures à la V1.0 ayant un responsable : ${legacyAssigned} (traitées par 20261014091000).`);

    if (!reconcile) {
      process.exitCode = state === "?" || divergent.some((d) => d.name !== V1) ? 1 : 0;
      return;
    }

    // ── Réconciliation (état C uniquement) ──
    if (state !== "C") throw new Error(`réconciliation refusée : état ${state}, seule une base en état C peut être réconciliée.`);
    const others = divergent.filter((d) => d.name !== V1);
    if (others.length) throw new Error(`réconciliation refusée : autres empreintes divergentes (${others.map((d) => d.name).join(", ")}).`);
    const v1File = path.join(MIGRATIONS, V1, "migration.sql");
    if (sha256(v1File) !== ORIGINAL) throw new Error("réconciliation refusée : le fichier de 20261013120000 n'est pas la version d'origine attendue.");
    const missing = await missingObjects(client, schemaObjects(readFileSync(v1File, "utf8")));
    if (missing.length) throw new Error(`réconciliation refusée : objets de schéma absents — ${missing.join(", ")}.`);

    await client.query("BEGIN");
    const { rowCount } = await client.query(
      'UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2 AND checksum = $3 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
      [ORIGINAL, V1, REVISED],
    );
    if (rowCount !== 1) {
      await client.query("ROLLBACK");
      throw new Error(`réconciliation refusée : ${rowCount} ligne(s) concernée(s), 1 attendue.`);
    }
    await client.query("COMMIT");
    console.log("Empreinte de 20261013120000 réconciliée (REVISED → ORIGINAL). Lancez maintenant `npm run db:deploy`.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[migration-check] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
