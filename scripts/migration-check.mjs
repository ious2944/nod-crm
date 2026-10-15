#!/usr/bin/env node
/**
 * Contrôle (et, sur demande, réconciliation) de l'historique des migrations
 * du module de gestion de travail V1.0.
 *
 *   node scripts/migration-check.mjs              # diagnostic (aucune écriture dans la base contrôlée)
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
 *   A — module jamais appliqué              → `npm run db:deploy` ;
 *   B — empreinte d'origine enregistrée (version d'origine appliquée, ou
 *       état C déjà réconcilié)             → `npm run db:deploy` ;
 *   C — version révisée appliquée           → `--reconcile`, puis `db:deploy`.
 *
 * ── Contrôle de schéma ──
 * Le nom d'un objet ne prouve pas sa définition. Le schéma attendu est donc
 * **reconstruit** : les fichiers des migrations enregistrées comme appliquées
 * sont rejoués, dans l'ordre, dans une **base de référence isolée** (vide),
 * puis les deux catalogues PostgreSQL sont comparés élément par élément :
 *   - enums : nom et valeurs, dans l'ordre ;
 *   - colonnes : type exact (`format_type`), nullabilité, valeur par défaut,
 *     identité / colonne générée ;
 *   - contraintes : clés primaires, uniques, clés étrangères (tables,
 *     colonnes, ON DELETE / ON UPDATE), vérifications (`pg_get_constraintdef`) ;
 *   - index : colonnes et ordre, unicité, méthode, prédicat (`pg_get_indexdef`).
 * Ne sont pas comparés : collations, vues, déclencheurs, fonctions, propriétés
 * des séquences, extensions, commentaires, droits et propriétaires.
 *
 * Base de référence — pourquoi une base à part : une migration qui consulte le
 * catalogue sans filtrer par schéma (garde de `20261014092000`) verrait, dans
 * la même base, les objets du schéma réel et reconstruirait un autre schéma.
 * Deux configurations :
 *   - par défaut, le script crée une base temporaire `nod_check_<aléa>` sur le
 *     même serveur (droit **CREATEDB** nécessaire), la marque d'un commentaire,
 *     et la supprime à la fin (y compris en cas d'erreur ; une base laissée par
 *     un arrêt brutal est supprimée au contrôle suivant de la même base) ;
 *   - ou `SHADOW_DATABASE_URL` : une base **vide** dédiée (droits CREATE et
 *     USAGE sur son schéma). Le rejeu s'y fait dans une transaction annulée :
 *     elle reste vide.
 *
 * ── Préalables aux migrations en attente ──
 * `20261014093000_project_trash_constraints` ajoute deux clés étrangères :
 * elle échoue si des lignes pointent vers un projet ou un utilisateur
 * disparus. Le script les liste avant le déploiement (ou après un échec), avec
 * la reprise documentée, sans rien modifier.
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
 * métier n'est lue pour être écrite. Il ne réinitialise jamais la base.
 *
 * ── Codes de sortie ──
 *   0 — conforme : rien ne bloque `npm run db:deploy` (il peut rester des
 *       migrations en attente, listées) ; ou réconciliation effectuée ;
 *   1 — ne pas déployer : historique incohérent, divergence de schéma,
 *       empreinte non reconnue, ou réconciliation refusée ;
 *   2 — contrôle impossible : `DATABASE_URL` absent, base injoignable, verrou
 *       tenu trop longtemps (`MIGRATION_CHECK_LOCK_TIMEOUT`, 60 s par défaut),
 *       base de référence impossible à créer ou non vide ;
 *   3 — action préalable requise avant `db:deploy` : état C à réconcilier
 *       (`--reconcile`), ou lignes orphelines bloquant 20261014093000.
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

const PROJECT_TRASH = "20261014092000_project_trash";
const PROJECT_TRASH_FK = "20261014093000_project_trash_constraints";
/** Clés étrangères que la garde de 20261014092000 a pu omettre et que 20261014093000 crée. */
const PROJECT_TRASH_KEYS = ["contrainte tasks.tasks_deleted_with_project_id_fkey : absent(e)", "contrainte projects.projects_deleted_by_id_fkey : absent(e)"];
const SHADOW_COMMENT = "nod migration-check (base de référence temporaire)";

const MIGRATIONS = path.resolve(process.env.MIGRATIONS_DIR ?? "prisma/migrations");
const reconcile = process.argv.includes("--reconcile");
const LOCK_TIMEOUT = process.env.MIGRATION_CHECK_LOCK_TIMEOUT ?? "60s";

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const migrationSql = (name) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");

/** Réconciliation refusée, ou contrôle concluant à ne pas déployer (code 1). */
class Refusal extends Error {}
/** Contrôle impossible : configuration, connexion, droits (code 2). */
class UsageError extends Error {}

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

/** Rejoue les migrations dans le schéma `public` d'une base de référence (transaction ouverte). */
async function replay(client, applied) {
  await client.query("SET LOCAL search_path TO public");
  for (const { name } of applied) {
    await client.query("SAVEPOINT replay");
    try {
      await client.query(migrationSql(name));
      await client.query("RELEASE SAVEPOINT replay");
    } catch (error) {
      throw new Refusal(`impossible de rejouer ${name} pour reconstruire le schéma attendu : ${error.message}`);
    }
  }
  return introspect(client, "public");
}

/** Supprime les bases de référence laissées par un arrêt brutal d'un contrôle de cette même base. */
async function dropLeftovers(admin, marker) {
  const { rows } = await admin.query(
    `SELECT d.datname FROM pg_database d JOIN pg_shdescription s ON s.objoid = d.oid AND s.classoid = 'pg_database'::regclass
      WHERE d.datname LIKE 'nod\\_check\\_%' AND s.description = $1
        AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`,
    [marker],
  );
  for (const { datname } of rows) await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(datname)}`);
}

/**
 * Schéma attendu, reconstruit dans une base isolée : `SHADOW_DATABASE_URL`
 * (vide), sinon une base temporaire créée puis supprimée.
 */
async function expectedSchema(realConnection, realDb, schema, applied) {
  const shadowUrl = process.env.SHADOW_DATABASE_URL;
  if (shadowUrl) {
    const client = new pg.Client({ connectionString: connectionConfig(shadowUrl).connectionString });
    try {
      await client.connect();
    } catch (error) {
      throw new UsageError(`SHADOW_DATABASE_URL injoignable : ${error.message}`);
    }
    try {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`,
      );
      const types = await client.query(
        `SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typtype = 'e' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
      );
      if (rows[0].n || types.rows[0].n) throw new UsageError("SHADOW_DATABASE_URL doit désigner une base vide (aucune table, aucun type).");
      await client.query("BEGIN");
      try {
        return await replay(client, applied);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    } finally {
      await client.end().catch(() => {});
    }
  }

  const admin = new pg.Client({ connectionString: realConnection });
  await admin.connect();
  const marker = `${SHADOW_COMMENT} : ${realDb}/${schema}`;
  const name = `nod_check_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await dropLeftovers(admin, marker);
    const { rows } = await admin.query(
      "SELECT pg_encoding_to_char(encoding) AS encoding, datcollate, datctype FROM pg_database WHERE datname = current_database()",
    );
    try {
      await admin.query(
        `CREATE DATABASE ${pg.escapeIdentifier(name)} TEMPLATE template0 ENCODING ${pg.escapeLiteral(rows[0].encoding)} LC_COLLATE ${pg.escapeLiteral(rows[0].datcollate)} LC_CTYPE ${pg.escapeLiteral(rows[0].datctype)}`,
      );
    } catch (error) {
      throw new UsageError(
        `base de référence impossible à créer (${error.message}). Accordez CREATEDB au rôle, ou fournissez SHADOW_DATABASE_URL (base vide dédiée).`,
      );
    }
    created = true;
    await admin.query(`COMMENT ON DATABASE ${pg.escapeIdentifier(name)} IS ${pg.escapeLiteral(marker)}`);
    const url = new URL(realConnection);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query("BEGIN");
      const result = await replay(client, applied);
      await client.query("ROLLBACK");
      return result;
    } finally {
      await client.end().catch(() => {});
    }
  } finally {
    if (created) await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

/** Lignes qui empêcheraient 20261014093000 d'ajouter ses clés étrangères. */
async function projectTrashOrphans(client) {
  const exists = async (table, column) =>
    (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, [table, column])).rowCount > 0;
  const result = [];
  if (await exists("tasks", "deleted_with_project_id")) {
    const { rows } = await client.query(
      `SELECT id, deleted_with_project_id AS ref FROM tasks t
        WHERE t.deleted_with_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.deleted_with_project_id)
        ORDER BY id`,
    );
    if (rows.length) {
      result.push({
        what: "tasks.deleted_with_project_id → projet inexistant",
        rows,
        fix: `UPDATE tasks t SET deleted_with_project_id = NULL WHERE t.deleted_with_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.deleted_with_project_id);`,
      });
    }
  }
  if (await exists("projects", "deleted_by_id")) {
    const { rows } = await client.query(
      `SELECT id, deleted_by_id AS ref FROM projects p
        WHERE p.deleted_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.deleted_by_id)
        ORDER BY id`,
    );
    if (rows.length) {
      result.push({
        what: "projects.deleted_by_id → utilisateur inexistant",
        rows,
        fix: `UPDATE projects p SET deleted_by_id = NULL WHERE p.deleted_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.deleted_by_id);`,
      });
    }
  }
  return result;
}

// ─── Programme ───────────────────────────────────────────────────────────────

function connectionConfig(url) {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get("schema") ?? "public";
  parsed.search = "";
  return { connectionString: parsed.toString(), schema };
}

const STATE_TEXT = {
  A: "État A : le module n'a jamais été appliqué.",
  B: "État B : l'empreinte enregistrée de 20261013120000 est celle de la version d'origine (version d'origine appliquée, ou état C déjà réconcilié).",
  C: "État C : version révisée de 20261013120000 appliquée. Réconciliation de l'empreinte nécessaire (`--reconcile`), puis `npm run db:deploy`.",
  "?": "État inconnu : empreinte de 20261013120000 non reconnue. Ne rien modifier ; comparer le schéma à la main.",
};

function printOrphans(orphans, failed) {
  console.log(
    failed
      ? `${PROJECT_TRASH_FK} a échoué : des lignes pointent vers des éléments disparus.`
      : `Préalable à ${PROJECT_TRASH_FK} (en attente) : des lignes pointent vers des éléments disparus ; le déploiement échouerait.`,
  );
  for (const o of orphans) {
    console.log(`  ✗ ${o.what} : ${o.rows.length} ligne(s)`);
    for (const r of o.rows.slice(0, 20)) console.log(`      ${r.id} → ${r.ref}`);
    if (o.rows.length > 20) console.log(`      … et ${o.rows.length - 20} autre(s)`);
  }
  console.log("  Reprise (aucune suppression, aucun reset ; à valider par une personne) :");
  console.log("    1. Vérifier les lignes ci-dessus ; la valeur pointe vers un élément qui n'existe plus.");
  console.log("    2. La remettre à NULL — c'est ce que la clé étrangère (ON DELETE SET NULL) aurait fait :");
  for (const o of orphans) console.log(`         ${o.fix}`);
  if (failed) console.log(`    3. \`npx prisma migrate resolve --rolled-back ${PROJECT_TRASH_FK}\`, puis \`npm run db:deploy\`.`);
  else console.log("    3. `npm run db:deploy`.");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new UsageError("DATABASE_URL est obligatoire.");
  const { connectionString, schema } = connectionConfig(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    throw new UsageError(`base injoignable : ${error.message}`);
  }
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
    await client.query(`SET LOCAL lock_timeout = ${pg.escapeLiteral(LOCK_TIMEOUT)}`);
    // Aucune migration Prisma ne peut tourner pendant le contrôle, et
    // `_prisma_migrations` ne peut pas changer entre la lecture et l'écriture.
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [PRISMA_MIGRATE_LOCK]);
    } catch (error) {
      if (error.code === "55P03") throw new UsageError(`une migration Prisma est en cours (verrou tenu plus de ${LOCK_TIMEOUT}). Réessayez à la fin du déploiement.`);
      throw error;
    }
    const realDb = (await client.query("SELECT current_database() AS db")).rows[0].db;
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
    const pending = files.filter((f) => !applied.some((m) => m.name === f));

    console.log(`Schéma « ${schema} » — historique des migrations :`);
    console.log(lines.join("\n"));
    console.log("");
    console.log(STATE_TEXT[state]);
    console.log(pending.length ? `Migrations en attente : ${pending.length} — \`npm run db:deploy\` les appliquera.` : "Aucune migration en attente.");
    if (v1) {
      const legacy = await client.query(
        `SELECT count(*)::int AS n FROM tasks t WHERE t.assignee_id IS NOT NULL AND t.created_at < $1::timestamptz AT TIME ZONE 'UTC'`,
        [v1.finishedAt],
      );
      const hasNotes = (await client.query("SELECT to_regclass('task_migration_notes') IS NOT NULL AS ok")).rows[0].ok;
      const review = hasNotes
        ? (await client.query(`SELECT count(DISTINCT task_id)::int AS n FROM task_migration_notes WHERE reason IN ('ASSIGNEE_INFERRED_KEPT', 'ASSIGNEE_ORIGIN_UNKNOWN', 'CREATOR_INFERRED_KEPT', 'CREATOR_ORIGIN_UNKNOWN')`)).rows[0].n
        : 0;
      console.log(
        `Tâches antérieures à la V1.0 ayant aujourd'hui un responsable : ${legacy.rows[0].n} (affectations faites en V1.0 comprises). Tâches signalées pour vérification (valeur conservée) : ${review}.`,
      );
    }

    for (const p of problems) console.log(`  ✗ historique : ${p}`);
    for (const m of otherDivergent) console.log(`  ✗ empreinte divergente non reconnue : ${m.name}`);

    // Préalable de 20261014093000 : en attente, ou en échec.
    const fkRows = rows.filter((r) => r.migration_name === PROJECT_TRASH_FK);
    const fkFailed = fkRows.some((r) => !r.finished_at && !r.rolled_back_at);
    const fkPending = !applied.some((m) => m.name === PROJECT_TRASH_FK);
    const orphans = fkPending ? await projectTrashOrphans(client) : [];
    if (orphans.length) printOrphans(orphans, fkFailed);

    let diffs = [];
    let expectedOnly = [];
    if (problems.length === 0) {
      const expected = await expectedSchema(connectionString, realDb, schema, applied);
      const actual = await introspect(client, schema);
      await client.query(`SET LOCAL search_path TO ${pg.escapeIdentifier(schema)}`);
      diffs = compare(expected, actual);
      // Clés que la garde de 20261014092000 a pu omettre : 20261014093000 (en
      // attente) les crée. Divergence connue, non bloquante.
      if (applied.some((m) => m.name === PROJECT_TRASH) && fkPending) {
        expectedOnly = diffs.filter((d) => PROJECT_TRASH_KEYS.some((k) => d.startsWith(k)));
        diffs = diffs.filter((d) => !expectedOnly.includes(d));
      }
      if (diffs.length) {
        console.log(`Schéma : ${diffs.length} divergence(s) avec le schéma reconstruit à partir des migrations appliquées :`);
        for (const d of diffs) console.log(`  ✗ ${d}`);
      } else {
        console.log(`Schéma : conforme aux ${applied.length} migration(s) appliquée(s) (enums, colonnes, contraintes, index).`);
      }
      for (const d of expectedOnly) console.log(`  · ${d} — créée par ${PROJECT_TRASH_FK} (en attente)`);
    } else {
      console.log("Schéma : non comparé tant que l'historique est incohérent.");
    }

    const blocking = problems.length > 0 || otherDivergent.length > 0 || diffs.length > 0 || state === "?";
    if (!reconcile) {
      await client.query("ROLLBACK");
      process.exitCode = blocking ? 1 : state === "C" || orphans.length ? 3 : 0;
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
    await client.query("COMMIT");
    committed = true;
    console.log("Empreinte de 20261013120000 réconciliée (REVISED → ORIGINAL).");
    console.log(orphans.length ? "Corrigez d'abord les lignes orphelines ci-dessus, puis lancez `npm run db:deploy`." : "Lancez maintenant `npm run db:deploy`.");
    process.exitCode = orphans.length ? 3 : 0;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Refusal) {
    console.error(`[migration-check] ${reconcile ? "réconciliation refusée" : "ne pas déployer"} : ${message}`);
    process.exit(1);
  }
  console.error(`[migration-check] contrôle impossible : ${message}`);
  process.exit(2);
});
