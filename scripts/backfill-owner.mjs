#!/usr/bin/env node
/**
 * Permissions V1, lot A — étape 2/3 : attribution des données existantes.
 *
 *   node scripts/backfill-owner.mjs --workspace <uuid> --owner <email> [--dry-run]
 *                                   [--e2e-user <email> ...]
 *
 * Donne au propriétaire de migration (l'utilisateur actuel de l'espace) tout
 * ce qui n'a pas encore de propriétaire, pour que la règle « privé par
 * défaut » ne change rien à ce qu'il voit :
 *
 *   - fiches CRM et RGPD sans `owner_id` → lui ;
 *   - étiquettes et champs sans `created_by_id` → lui ;
 *   - modèles de tâche dont l'auteur est absent ou inactif → lui (ils
 *     deviennent personnels) ;
 *   - règles d'automatisation d'espace dont l'auteur est absent ou inactif →
 *     lui, **désactivées** : elles ne s'exécutaient pas (une règle tourne avec
 *     les droits de son auteur, et il n'en a plus), elles ne doivent pas se
 *     mettre à tourner ;
 *   - projets → `PRIVATE`, `owner_id` renseigné (`owner_id`, sinon
 *     `created_by_id`, sinon lui). Sur un projet `WORKSPACE` dont il n'est ni
 *     propriétaire ni membre, il devient membre `EDITOR` : exactement le droit
 *     qu'il y avait (lire et modifier le contenu, pas administrer) ;
 *   - tâches libres (sans projet) qu'il voyait parce qu'elles étaient
 *     partagées dans l'espace : créateur absent → lui ; créateur présent
 *     (autre compte) → il en devient collaborateur, ce qui lui garde lecture,
 *     modification et gestion (identiques pour une tâche libre).
 *
 * Garde-fous :
 *   - refus si l'espace compte un autre utilisateur ACTIF que le propriétaire,
 *     hors comptes de test e2e désignés un par un avec `--e2e-user` ; un
 *     compte e2e doit appartenir à l'espace et avoir une adresse en `.test`
 *     (domaine réservé, RFC 2606 — convention de `scripts/create-e2e-user.ts`
 *     et des tests), sinon il est refusé ;
 *   - idempotent : chaque mise à jour ne vise que ce qui reste à faire ; une
 *     seconde exécution n'écrit rien ;
 *   - `--dry-run` : exécute tout dans la transaction, affiche les comptes par
 *     table, puis annule (ROLLBACK) — les chiffres sont ceux d'une vraie
 *     exécution ;
 *   - une seule transaction, verrou consultatif par espace, garde-fou revérifié
 *     sous verrou.
 *
 * Ce qui ne peut pas être préservé et n'est donc que compté (section
 * « accès perdus ») : une tâche qu'il ne voyait qu'en tant qu'abonné, ou que
 * responsable / créateur dans un projet privé dont il n'est pas membre.
 *
 * Écrit en JavaScript simple avec `pg`, comme `admin.mjs` : il tourne tel quel
 * dans l'image de production (`docker compose exec app node scripts/…`).
 */
import process from "node:process";
import { pathToFileURL } from "node:url";

import pg from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E2E_DOMAIN = /\.test$/i;

const OWNED_TABLES = [
  "organizations",
  "contacts",
  "follow_ups",
  "opportunities",
  "privacy_treatments",
  "privacy_processors",
  "privacy_requests",
  "privacy_incidents",
];

export class BackfillRefusal extends Error {}

export function parseArgs(argv) {
  const options = { e2eUsers: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new BackfillRefusal(`${arg} attend une valeur.`);
      i += 1;
      return next;
    };
    if (arg === "--workspace") options.workspace = value();
    else if (arg === "--owner") options.owner = value().toLowerCase();
    else if (arg === "--e2e-user") options.e2eUsers.push(value().toLowerCase());
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new BackfillRefusal(`Option inconnue : ${arg}`);
  }
  if (!options.workspace || !UUID.test(options.workspace)) throw new BackfillRefusal("--workspace <uuid> est obligatoire.");
  if (!options.owner) throw new BackfillRefusal("--owner <email> est obligatoire.");
  return options;
}

/** Vérifie l'espace, le propriétaire et l'absence d'autre utilisateur actif. Renvoie l'id du propriétaire. */
async function checkGuards(client, { workspace, owner, e2eUsers }) {
  const ws = await client.query("SELECT id, slug FROM workspaces WHERE id = $1", [workspace]);
  if (ws.rowCount === 0) throw new BackfillRefusal("Espace introuvable.");

  const users = await client.query(
    "SELECT id, lower(email) AS email, is_active FROM users WHERE workspace_id = $1 ORDER BY email",
    [workspace],
  );
  const me = users.rows.find((u) => u.email === owner);
  if (!me) throw new BackfillRefusal(`Le propriétaire ${owner} n'appartient pas à cet espace.`);
  if (!me.is_active) throw new BackfillRefusal(`Le propriétaire ${owner} est désactivé.`);

  for (const email of e2eUsers) {
    if (!E2E_DOMAIN.test(email)) {
      throw new BackfillRefusal(`--e2e-user ${email} : un compte e2e doit avoir une adresse en « .test ».`);
    }
    if (!users.rows.some((u) => u.email === email)) {
      throw new BackfillRefusal(`--e2e-user ${email} n'appartient pas à cet espace.`);
    }
  }

  const others = users.rows.filter((u) => u.is_active && u.email !== owner && !e2eUsers.includes(u.email));
  if (others.length > 0) {
    throw new BackfillRefusal(
      "Refus : l'espace compte d'autres utilisateurs actifs. Les données de chacun ne peuvent pas être " +
        "attribuées à un seul propriétaire sans décision explicite. Désactivez-les (admin.mjs disable-user) " +
        "ou désignez les comptes de test avec --e2e-user.\n" +
        others.map((u) => `  - ${u.email}`).join("\n"),
    );
  }
  const excluded = users.rows
    .filter((u) => e2eUsers.includes(u.email))
    .map((u) => ({ email: u.email, isActive: u.is_active }));
  const inactive = users.rows.filter((u) => !u.is_active).map((u) => u.email);
  return { ownerId: me.id, slug: ws.rows[0].slug, excluded, inactive };
}

async function count(client, sql, params) {
  return Number((await client.query(sql, params)).rows[0].n);
}

/**
 * Exécute le backfill sur une connexion ouverte. Renvoie le rapport
 * `{ section: { ligne: nombre } }`. Toujours dans une transaction ; annulée
 * si `dryRun`.
 */
export async function backfill(client, options) {
  const report = { "Attribution": {}, "Projets": {}, "Tâches libres": {}, "Accès perdus (non préservables)": {} };
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('backfill-owner:' || $1))", [options.workspace]);
    // Revérifié sous verrou : rien ne doit changer entre le contrôle et l'écriture.
    const { ownerId, slug, excluded, inactive } = await checkGuards(client, options);
    const w = options.workspace;
    const attribution = report["Attribution"];

    for (const table of OWNED_TABLES) {
      const r = await client.query(`UPDATE ${table} SET owner_id = $2 WHERE workspace_id = $1 AND owner_id IS NULL`, [w, ownerId]);
      attribution[table] = r.rowCount;
    }
    for (const table of ["tags", "custom_fields"]) {
      const r = await client.query(`UPDATE ${table} SET created_by_id = $2 WHERE workspace_id = $1 AND created_by_id IS NULL`, [w, ownerId]);
      attribution[`${table} (créateur)`] = r.rowCount;
    }
    const inactiveAuthor = `(created_by_id IS NULL OR created_by_id NOT IN (SELECT id FROM users WHERE workspace_id = $1 AND is_active))`;
    attribution["task_templates (auteur absent ou inactif)"] = (
      await client.query(`UPDATE task_templates SET created_by_id = $2 WHERE workspace_id = $1 AND created_by_id IS DISTINCT FROM $2 AND ${inactiveAuthor}`, [w, ownerId])
    ).rowCount;
    attribution["automation_rules d'espace (auteur absent ou inactif → désactivées)"] = (
      await client.query(
        `UPDATE automation_rules SET created_by_id = $2, is_enabled = false, updated_at = now()
         WHERE workspace_id = $1 AND project_id IS NULL AND created_by_id IS DISTINCT FROM $2 AND ${inactiveAuthor}`,
        [w, ownerId],
      )
    ).rowCount;

    // Projets. L'adhésion se calcule AVANT le passage en PRIVATE.
    const projects = report["Projets"];
    projects["membre EDITOR ajouté (projet WORKSPACE non possédé)"] = (
      await client.query(
        `INSERT INTO project_members (project_id, user_id, workspace_id, role)
         SELECT p.id, $2, p.workspace_id, 'EDITOR' FROM projects p
         WHERE p.workspace_id = $1 AND p.visibility = 'WORKSPACE'
           AND COALESCE(p.owner_id, p.created_by_id) IS DISTINCT FROM $2
           AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)`,
        [w, ownerId],
      )
    ).rowCount;
    projects["owner_id renseigné"] = (
      await client.query(`UPDATE projects SET owner_id = COALESCE(created_by_id, $2) WHERE workspace_id = $1 AND owner_id IS NULL`, [w, ownerId])
    ).rowCount;
    projects["WORKSPACE → PRIVATE"] = (
      await client.query(`UPDATE projects SET visibility = 'PRIVATE' WHERE workspace_id = $1 AND visibility = 'WORKSPACE'`, [w])
    ).rowCount;

    // Tâches libres (racines sans aucun projet) : jusqu'ici partagées dans l'espace.
    const free = `t.workspace_id = $1 AND t.parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id)`;
    const linked = `(t.assignee_id = $2 OR t.created_by_id = $2 OR EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id = t.id AND f.user_id = $2 AND f.kind = 'COLLABORATOR'))`;
    const tasks = report["Tâches libres"];
    tasks["créateur absent → propriétaire"] = (
      await client.query(`UPDATE tasks t SET created_by_id = $2 WHERE ${free} AND t.created_by_id IS NULL`, [w, ownerId])
    ).rowCount;
    tasks["d'un autre compte → collaborateur"] = (
      await client.query(
        `INSERT INTO task_followers (task_id, user_id, kind)
         SELECT t.id, $2, 'COLLABORATOR' FROM tasks t WHERE ${free} AND NOT ${linked}
         ON CONFLICT (task_id, user_id) DO UPDATE SET kind = 'COLLABORATOR'`,
        [w, ownerId],
      )
    ).rowCount;

    // Ce qui ne se préserve pas sans donner plus de droits qu'avant : seulement compté.
    const lost = report["Accès perdus (non préservables)"];
    const unreadableProject = `EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM task_projects tp JOIN projects p ON p.id = tp.project_id
        WHERE tp.task_id = r.id AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)))`;
    lost["tâches de projet non lisible (responsable, créateur ou suiveur seulement)"] = await count(
      client,
      `SELECT count(*) AS n FROM tasks r WHERE r.workspace_id = $1 AND r.parent_id IS NULL AND r.deleted_at IS NULL
         AND (r.assignee_id = $2 OR r.created_by_id = $2 OR EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id = r.id AND f.user_id = $2))
         AND ${unreadableProject}`,
      [w, ownerId],
    );

    report.meta = { workspace: `${slug} (${w})`, owner: options.owner, dryRun: options.dryRun, excluded, inactive };
    await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export function formatReport(report) {
  const lines = [
    `Espace       : ${report.meta.workspace}`,
    `Propriétaire : ${report.meta.owner}`,
    `Mode         : ${report.meta.dryRun ? "DRY-RUN — rien n'a été enregistré (ROLLBACK)" : "exécution — transaction validée (COMMIT)"}`,
    "",
    "Comptes exclus du garde-fou (--e2e-user) — à vérifier avant toute exécution réelle",
    ...(report.meta.excluded.length
      ? report.meta.excluded.map((u) => `  ${u.email.padEnd(40)}  isActive=${u.isActive}`)
      : ["  (aucun)"]),
    "",
    "Comptes désactivés de l'espace (ignorés par le garde-fou)",
    ...(report.meta.inactive.length ? report.meta.inactive.map((email) => `  ${email}`) : ["  (aucun)"]),
  ];
  for (const [section, rows] of Object.entries(report)) {
    if (section === "meta") continue;
    lines.push("", section);
    const width = Math.max(...Object.keys(rows).map((k) => k.length));
    for (const [label, n] of Object.entries(rows)) lines.push(`  ${label.padEnd(width)}  ${String(n).padStart(6)}`);
  }
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("Usage : node scripts/backfill-owner.mjs --workspace <uuid> --owner <email> [--dry-run] [--e2e-user <email> ...]");
    process.exitCode = 2;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent de l'environnement.");
    process.exitCode = 2;
    return;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    console.log(formatReport(await backfill(client, options)));
  } catch (error) {
    console.error(error instanceof BackfillRefusal ? error.message : `Échec, rien n'a été modifié : ${error.message}`);
    process.exitCode = error instanceof BackfillRefusal ? 3 : 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
