#!/usr/bin/env node
/**
 * Contrôle (et, sur demande, réconciliation) de l'historique des migrations
 * du module de gestion de travail V1.0.
 *
 *   node scripts/migration-check.mjs              # diagnostic (aucune écriture persistante)
 *   node scripts/migration-check.mjs --reconcile  # état C uniquement, après contrôle complet
 *
 * JavaScript simple avec `pg` : tourne tel quel dans l'image de production
 * (`docker compose run --rm app node scripts/migration-check.mjs`).
 *
 * La migration `20261013120000_work_management` a existé en deux versions :
 *   - version d'origine (fichier actuel, commit 81c4b0c), empreinte ORIGINAL ;
 *   - version révisée (commit c199fdd), empreinte REVISED : mêmes instructions
 *     de schéma, sans les deux requêtes de remplissage des responsables.
 *
 * États reconnus :
 *   A — module jamais appliqué              → `npm run db:deploy` suffit ;
 *   B — version d'origine appliquée         → `npm run db:deploy` suffit ;
 *   C — version révisée appliquée           → `--reconcile`, puis `db:deploy`.
 *
 * ── Contrôle de schéma ──
 * Le nom d'un objet ne prouve pas sa définition. Le schéma attendu est donc
 * **reconstruit** : les fichiers des migrations enregistrées comme appliquées
 * (y compris celles qui suivent 20261013120000) sont rejoués, dans l'ordre,
 * dans un schéma temporaire de la même base, puis les deux catalogues
 * PostgreSQL sont comparés élément par élément :
 *   - enums : nom et valeurs, dans l'ordre ;
 *   - colonnes : type exact (`format_type`), nullabilité, valeur par défaut,
 *     identité / colonne générée — ce qui couvre aussi les modifications de
 *     colonnes existantes faites par une migration (ex. `DROP NOT NULL`) ;
 *   - contraintes : clés primaires, uniques, clés étrangères (tables,
 *     colonnes, ON DELETE / ON UPDATE), vérifications (`pg_get_constraintdef`) ;
 *   - index : colonnes et ordre, unicité, méthode, prédicat (`pg_get_indexdef`).
 * Un objet manquant, en trop ou différent est une divergence, listée avec la
 * valeur attendue et la valeur trouvée. Tout se passe dans une transaction
 * annulée à la fin : le schéma temporaire n'est jamais conservé.
 *
 * ── Réconciliation ──
 * `--reconcile` ne réécrit l'empreinte enregistrée de 20261013120000 que si,
 * dans **une seule transaction** tenant le verrou consultatif de Prisma
 * Migrate (`pg_advisory_xact_lock(72707369)`, le même que `migrate deploy`) et
 * un verrou sur `_prisma_migrations` :
 *   1. l'historique est cohérent : aucune migration inachevée, aucune annulée
 *      sans nouvelle application, aucune enregistrée absente du dépôt, aucun
 *      trou dans l'ordre d'application ;
 *   2. la ligne de 20261013120000 porte exactement l'empreinte REVISED (état
 *      C) et aucune autre migration n'a d'empreinte divergente ;
 *   3. le fichier sur disque est bien la version d'origine ;
 *   4. le schéma réel est identique au schéma reconstruit.
 * Seule la colonne `checksum` de cette ligne est modifiée ; aucune donnée
 * métier n'est lue pour être écrite. Sinon rien n'est écrit et le script sort
 * en erreur (code 1) avec le diagnostic. Il ne réinitialise jamais la base.
 *
 * Droit nécessaire : CREATE sur la base (schéma temporaire).
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const V1 = "20261013120000_work_management";
const ORIGINAL = "7a410c8d1807791285ffc3052b7a0c83fb0a9b2e83f45341a3855b35650777c8";
const REVISED = "b7fae256791d133c42b47bdf20cc832e91c35c61cc64b36c76ccfe1a0f5dc792";
/** Clé du verrou consultatif de Prisma Migrate (moteur de schéma Prisma 7). */
const PRISMA_MIGRATE_LOCK = 72707369;

const MIGRATIONS = path.resolve(process.env.MIGRATIONS_DIR ?? "prisma/migrations");
const reconcile = process.argv.includes("--reconcile");

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const migrationSql = (name) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");

class Refusal extends Error {}

// ─── Historique ──────────────────────────────────────────────────────────────

/**
 * Analyse `_prisma_migrations` face aux fichiers du dépôt. Retourne les
 * migrations appliquées (dans l'ordre) et la liste des incohérences.
 */
function analyseHistory(files, rows) {
  const problems = [];
  const lines = [];
  const byName = new Map();
  for (const row of rows) byName.set(row.migration_name, [...(byName.get(row.migration_name) ?? []), row]);

  for (const [name, list] of byName) {
    if (!files.includes(name)) problems.push(`${name} : enregistrée dans _prisma_migrations mais absente du dépôt.`);
    if (list.some((r) => !r.finished_at && !r.rolled_back_at)) {
      problems.push(`${name} : migration inachevée (démarrée, ni terminée ni annulée) — résoudre avec \`prisma migrate resolve\` avant toute réconciliation.`);
    }
    const done = list.filter((r) => r.finished_at && !r.rolled_back_at);
    if (done.length > 1) problems.push(`${name} : appliquée ${done.length} fois.`);
    if (list.some((r) => r.rolled_back_at) && done.length === 0) {
      problems.push(`${name} : annulée sans nouvelle application.`);
    }
  }

  const applied = [];
  let gap = null;
  for (const name of files) {
    const row = (byName.get(name) ?? []).find((r) => r.finished_at && !r.rolled_back_at);
    const fileSum = sha256(path.join(MIGRATIONS, name, "migration.sql"));
    if (!row) {
      gap ??= name;
      lines.push(`  ·  ${name} — à appliquer`);
      continue;
    }
    if (gap) problems.push(`${name} : appliquée alors que ${gap}, antérieure, ne l'est pas (trou dans l'historique).`);
    applied.push({ name, checksum: row.checksum, finishedAt: row.finished_at, fileSum });
    lines.push(row.checksum === fileSum ? `  ✓  ${name}` : `  ≠  ${name} — empreinte enregistrée ${row.checksum.slice(0, 12)}…, fichier ${fileSum.slice(0, 12)}…`);
  }
  for (const name of byName.keys()) if (!files.includes(name)) lines.push(`  ?  ${name} — enregistrée mais absente du dépôt`);
  return { applied, problems, lines };
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

/**
 * Description normalisée d'un schéma, lue dans `pg_catalog` avec le schéma
 * seul dans `search_path` : les définitions rendues par PostgreSQL ne portent
 * alors pas le nom du schéma et se comparent telles quelles.
 */
async function introspect(client, schema) {
  await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
  const skip = "_prisma_migrations";
  const enums = await client.query(
    `SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 GROUP BY t.typname`,
    [schema],
  );
  const columns = await client.query(
    `SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
            pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attidentity AS identity, a.attgenerated AS generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> $2`,
    [schema, skip],
  );
  const constraints = await client.query(
    `SELECT cl.relname AS tbl, co.conname AS name, co.contype AS kind, pg_get_constraintdef(co.oid, true) AS def
       FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = co.connamespace
      WHERE n.nspname = $1 AND cl.relname <> $2`,
    [schema, skip],
  );
  const indexes = await client.query(
    `SELECT i.relname AS name, t.relname AS tbl, pg_get_indexdef(i.oid) AS def
       FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE n.nspname = $1 AND t.relname <> $2`,
    [schema, skip],
  );
  const qualified = new RegExp(`ON (?:ONLY )?(?:${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|"${schema}")\\.`, "g");
  return {
    enums: new Map(enums.rows.map((r) => [r.name, r.labels.join(", ")])),
    columns: new Map(
      columns.rows.map((r) => [
        `${r.tbl}.${r.col}`,
        { type: r.type, notnull: r.notnull, dflt: r.dflt ?? null, identity: r.identity || null, generated: r.generated || null },
      ]),
    ),
    constraints: new Map(constraints.rows.map((r) => [`${r.tbl}.${r.name}`, `${r.kind} ${r.def}`])),
    indexes: new Map(indexes.rows.map((r) => [r.name, r.def.replace(qualified, "ON ")])),
    tables: new Set(columns.rows.map((r) => r.tbl)),
  };
}

const COLUMN_FIELDS = { type: "type", notnull: "NOT NULL", dflt: "valeur par défaut", identity: "identité", generated: "colonne générée" };
const show = (v) => (v === null || v === undefined ? "∅" : typeof v === "boolean" ? (v ? "oui" : "non") : String(v));

/** Divergences entre le schéma attendu (reconstruit) et le schéma réel. */
function compare(expected, actual) {
  const diffs = [];
  for (const t of expected.tables) if (!actual.tables.has(t)) diffs.push(`table ${t} : absente`);
  for (const t of actual.tables) if (!expected.tables.has(t)) diffs.push(`table ${t} : en trop`);
  const simple = (label, exp, act) => {
    for (const [k, v] of exp) {
      if (!act.has(k)) diffs.push(`${label} ${k} : absent(e) — attendu « ${v} »`);
      else if (act.get(k) !== v) diffs.push(`${label} ${k} : attendu « ${v} », trouvé « ${act.get(k)} »`);
    }
    for (const [k, v] of act) if (!exp.has(k)) diffs.push(`${label} ${k} : en trop — « ${v} »`);
  };
  simple("enum", expected.enums, actual.enums);
  for (const [k, exp] of expected.columns) {
    const act = actual.columns.get(k);
    const [table] = k.split(".");
    if (!act) {
      if (actual.tables.has(table)) diffs.push(`colonne ${k} : absente`);
      continue;
    }
    for (const [field, label] of Object.entries(COLUMN_FIELDS)) {
      if (exp[field] !== act[field]) diffs.push(`colonne ${k} : ${label} attendu « ${show(exp[field])} », trouvé « ${show(act[field])} »`);
    }
  }
  for (const k of actual.columns.keys()) {
    if (!expected.columns.has(k) && expected.tables.has(k.split(".")[0])) diffs.push(`colonne ${k} : en trop`);
  }
  simple("contrainte", expected.constraints, actual.constraints);
  simple("index", expected.indexes, actual.indexes);
  return diffs;
}

/** Rejoue les migrations appliquées dans un schéma temporaire et compare. */
async function schemaDivergences(client, schema, applied) {
  const shadow = `_nod_check_${randomBytes(6).toString("hex")}`;
  await client.query(`CREATE SCHEMA ${pg.escapeIdentifier(shadow)}`);
  await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(shadow)}`);
  for (const { name } of applied) {
    await client.query("SAVEPOINT replay");
    try {
      await client.query(migrationSql(name));
      await client.query("RELEASE SAVEPOINT replay");
    } catch (error) {
      throw new Refusal(`impossible de rejouer ${name} pour reconstruire le schéma attendu : ${error.message}`);
    }
  }
  const expected = await introspect(client, shadow);
  const actual = await introspect(client, schema);
  await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
  return { diffs: compare(expected, actual), shadow };
}

// ─── Programme ───────────────────────────────────────────────────────────────

function connectionConfig(url) {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get("schema") ?? "public";
  parsed.search = "";
  return { connectionString: parsed.toString(), schema };
}

const STATE_TEXT = {
  A: "État A : le module n'a jamais été appliqué. `npm run db:deploy` suffit.",
  B: "État B : version d'origine de 20261013120000 appliquée. `npm run db:deploy` applique la réconciliation des responsables.",
  C: "État C : version révisée de 20261013120000 appliquée. Réconciliation de l'empreinte nécessaire (`--reconcile`), puis `npm run db:deploy`.",
  "?": "État inconnu : empreinte de 20261013120000 non reconnue. Ne rien modifier ; comparer le schéma à la main.",
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL est obligatoire.");
    process.exit(2);
  }
  const { connectionString, schema } = connectionConfig(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString });
  await client.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
    // Aucune migration Prisma ne peut tourner pendant le contrôle, et
    // `_prisma_migrations` ne peut pas changer entre la lecture et l'écriture.
    await client.query("SELECT pg_advisory_xact_lock($1)", [PRISMA_MIGRATE_LOCK]);
    const hasTable = (await client.query("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS ok")).rows[0].ok;
    if (hasTable) await client.query('LOCK TABLE "_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE');
    const rows = hasTable
      ? (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')).rows
      : [];

    const files = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const { applied, problems, lines } = analyseHistory(files, rows);
    const v1 = applied.find((m) => m.name === V1);
    const state = !v1 ? "A" : v1.checksum === ORIGINAL ? "B" : v1.checksum === REVISED ? "C" : "?";
    const divergent = applied.filter((m) => m.checksum !== m.fileSum);
    const otherDivergent = divergent.filter((m) => !(m.name === V1 && m.checksum === REVISED));

    console.log(`Schéma « ${schema} » — historique des migrations :`);
    console.log(lines.join("\n"));
    console.log("");
    console.log(STATE_TEXT[state]);
    if (v1) {
      const legacy = await client.query(
        `SELECT count(*)::int AS n FROM tasks t WHERE t.assignee_id IS NOT NULL AND t.created_at < $1::timestamptz AT TIME ZONE 'UTC'`,
        [v1.finishedAt],
      );
      console.log(`Tâches antérieures à la V1.0 ayant un responsable : ${legacy.rows[0].n} (traitées par 20261014091000).`);
    }

    for (const p of problems) console.log(`  ✗ historique : ${p}`);
    for (const m of otherDivergent) console.log(`  ✗ empreinte divergente non reconnue : ${m.name}`);

    let diffs = [];
    let shadow = null;
    if (problems.length === 0) {
      ({ diffs, shadow } = await schemaDivergences(client, schema, applied));
      if (diffs.length) {
        console.log(`Schéma : ${diffs.length} divergence(s) avec le schéma reconstruit à partir des migrations appliquées :`);
        for (const d of diffs) console.log(`  ✗ ${d}`);
      } else {
        console.log(`Schéma : conforme aux ${applied.length} migration(s) appliquée(s) (enums, colonnes, contraintes, index).`);
      }
    } else {
      console.log("Schéma : non comparé tant que l'historique est incohérent.");
    }

    const healthy = problems.length === 0 && otherDivergent.length === 0 && diffs.length === 0 && state !== "?";
    if (!reconcile) {
      await client.query("ROLLBACK");
      process.exitCode = healthy ? 0 : 1;
      return;
    }

    // ── Réconciliation : état C uniquement, tout étant conforme ──
    if (problems.length) throw new Refusal("historique incohérent (voir ci-dessus).");
    if (state !== "C") throw new Refusal(`état ${state} — seule une base en état C peut être réconciliée.`);
    if (otherDivergent.length) throw new Refusal(`autres empreintes divergentes (${otherDivergent.map((m) => m.name).join(", ")}).`);
    if (sha256(path.join(MIGRATIONS, V1, "migration.sql")) !== ORIGINAL) {
      throw new Refusal("le fichier de 20261013120000 n'est pas la version d'origine attendue.");
    }
    if (diffs.length) throw new Refusal(`${diffs.length} divergence(s) de schéma (voir ci-dessus).`);

    const { rowCount } = await client.query(
      'UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2 AND checksum = $3 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
      [ORIGINAL, V1, REVISED],
    );
    if (rowCount !== 1) throw new Refusal(`${rowCount} ligne(s) concernée(s), 1 attendue.`);
    // Le schéma temporaire disparaît avec la transaction ; on le supprime
    // explicitement avant de valider la seule écriture voulue.
    if (shadow) await client.query(`DROP SCHEMA ${pg.escapeIdentifier(shadow)} CASCADE`);
    await client.query("COMMIT");
    committed = true;
    console.log("Empreinte de 20261013120000 réconciliée (REVISED → ORIGINAL). Lancez maintenant `npm run db:deploy`.");
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const prefix = error instanceof Refusal ? "réconciliation refusée : " : "";
  console.error(`[migration-check] ${prefix}${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
