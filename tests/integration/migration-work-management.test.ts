import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration V1.0 sur une base représentative.
 *
 * Le test crée un schéma PostgreSQL **jetable** dans la base de test (jamais la
 * base de développement ni de production), y applique les migrations
 * antérieures à la V1.0, insère des données historiques variées, puis applique
 * les migrations V1.0 et compare avant / après :
 *
 * - plusieurs utilisateurs, un utilisateur désactivé, un utilisateur supprimé ;
 * - des tâches avec et sans journal d'audit, un auteur d'audit d'un autre
 *   espace, une modification par une autre personne que le créateur ;
 * - des tâches terminées ; un espace à utilisateur unique ;
 * - une tâche « V1.0 » créée entre les deux migrations, sans échéance.
 */

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const V1 = "20261013120000_work_management";
const V1_HARDENING = "20261014090000_work_management_hardening";
const schema = `mig_${Date.now().toString(36)}`;
let client: Client;

const ids = {
  w1: "10000000-0000-4000-8000-000000000001",
  w2: "10000000-0000-4000-8000-000000000002",
  alice: "20000000-0000-4000-8000-000000000001",
  bob: "20000000-0000-4000-8000-000000000002",
  carol: "20000000-0000-4000-8000-000000000003", // désactivée
  dave: "20000000-0000-4000-8000-000000000004", // supprimé ensuite
  eve: "20000000-0000-4000-8000-000000000005", // seule dans W2
  contact: "30000000-0000-4000-8000-000000000001",
  followUp: "40000000-0000-4000-8000-000000000001",
  t1: "50000000-0000-4000-8000-000000000001", // créée par Alice, modifiée par Bob
  t2: "50000000-0000-4000-8000-000000000002", // créée par Carol (désactivée), terminée
  t3: "50000000-0000-4000-8000-000000000003", // aucun audit
  t4: "50000000-0000-4000-8000-000000000004", // créée par Dave, supprimé depuis
  t5: "50000000-0000-4000-8000-000000000005", // audit forgé : auteur d'un autre espace
  t6: "50000000-0000-4000-8000-000000000006", // W2, espace à utilisateur unique
  t7: "50000000-0000-4000-8000-000000000007", // créée par la V1.0, sans échéance
};

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function apply(dir: string) {
  await client.query(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8"));
}

type Row = Record<string, unknown>;
const snapshot = async (): Promise<Row[]> =>
  (
    await client.query(
      `SELECT id, workspace_id, title, notes, due_at, completed_at, contact_id, follow_up_id, is_demo, created_at
       FROM tasks ORDER BY id`,
    )
  ).rows;

describe("migration V1.0 — reprise des tâches existantes", () => {
  let before: Row[];

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    client = new Client({ connectionString: url.replace(/\?.*$/, "") });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    for (const dir of migrationDirs().filter((d) => d < V1)) await apply(dir);

    const now = "now()";
    await client.query(`
      INSERT INTO workspaces (id, slug, name, updated_at) VALUES
        ('${ids.w1}', 'w1', 'Espace 1', ${now}), ('${ids.w2}', 'w2', 'Espace 2', ${now});
      INSERT INTO users (id, workspace_id, email, password_hash, is_active, updated_at) VALUES
        ('${ids.alice}', '${ids.w1}', 'alice@w1.test', 'x', true, ${now}),
        ('${ids.bob}',   '${ids.w1}', 'bob@w1.test',   'x', true, ${now}),
        ('${ids.carol}', '${ids.w1}', 'carol@w1.test', 'x', false, ${now}),
        ('${ids.dave}',  '${ids.w1}', 'dave@w1.test',  'x', true, ${now}),
        ('${ids.eve}',   '${ids.w2}', 'eve@w2.test',   'x', true, ${now});
      INSERT INTO contacts (id, workspace_id, first_name, last_name, updated_at) VALUES
        ('${ids.contact}', '${ids.w1}', 'Camille', 'Martin', ${now});
      INSERT INTO follow_ups (id, workspace_id, contact_id, title, due_at, updated_at) VALUES
        ('${ids.followUp}', '${ids.w1}', '${ids.contact}', 'Relance', ${now}, ${now});
      INSERT INTO tasks (id, workspace_id, contact_id, follow_up_id, title, notes, due_at, completed_at, updated_at) VALUES
        ('${ids.t1}', '${ids.w1}', '${ids.contact}', '${ids.followUp}', 'T1', 'Notes 1', '2026-09-01', NULL, ${now}),
        ('${ids.t2}', '${ids.w1}', NULL, NULL, 'T2', NULL, '2026-08-01', '2026-08-02', ${now}),
        ('${ids.t3}', '${ids.w1}', NULL, NULL, 'T3', NULL, '2026-10-01', NULL, ${now}),
        ('${ids.t4}', '${ids.w1}', NULL, NULL, 'T4', NULL, '2026-10-02', '2026-10-03', ${now}),
        ('${ids.t5}', '${ids.w1}', NULL, NULL, 'T5', NULL, '2026-10-04', NULL, ${now}),
        ('${ids.t6}', '${ids.w2}', NULL, NULL, 'T6', NULL, '2026-10-05', NULL, ${now});
      INSERT INTO audit_logs (id, workspace_id, user_id, action, entity_type, entity_id, created_at) VALUES
        (gen_random_uuid(), '${ids.w1}', '${ids.alice}', 'CREATE', 'Task', '${ids.t1}', '2026-01-01'),
        (gen_random_uuid(), '${ids.w1}', '${ids.bob}',   'UPDATE', 'Task', '${ids.t1}', '2026-01-02'),
        (gen_random_uuid(), '${ids.w1}', '${ids.carol}', 'CREATE', 'Task', '${ids.t2}', '2026-01-01'),
        (gen_random_uuid(), '${ids.w1}', '${ids.dave}',  'CREATE', 'Task', '${ids.t4}', '2026-01-01'),
        (gen_random_uuid(), '${ids.w1}', '${ids.eve}',   'CREATE', 'Task', '${ids.t5}', '2026-01-01'),
        (gen_random_uuid(), '${ids.w2}', '${ids.eve}',   'CREATE', 'Task', '${ids.t6}', '2026-01-01');
      -- Dave quitte l'espace : son identifiant disparaît du journal (SET NULL).
      DELETE FROM users WHERE id = '${ids.dave}';
    `);
    before = await snapshot();

    await apply(V1);
    // Tâche créée par la V1.0 entre les deux migrations : historisée, sans échéance.
    await client.query(`
      INSERT INTO tasks (id, workspace_id, title, due_at, updated_at) VALUES ('${ids.t7}', '${ids.w1}', 'T7', NULL, now());
      INSERT INTO task_activities (id, workspace_id, task_id, kind) VALUES (gen_random_uuid(), '${ids.w1}', '${ids.t7}', 'created');
    `);
    await apply(V1_HARDENING);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  const task = async (id: string) => (await client.query(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
  const notes = async (id: string) =>
    (await client.query(`SELECT reason FROM task_migration_notes WHERE task_id = $1 ORDER BY reason`, [id])).rows.map((r) => r.reason);

  it("conserve toutes les lignes et leurs valeurs (volumes, liens CRM, dates)", async () => {
    const after = (await snapshot()).filter((r) => r.id !== ids.t7);
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
    expect((await client.query(`SELECT count(*)::int AS n FROM audit_logs`)).rows[0].n).toBe(6);
    expect((await task(ids.t1)).contact_id).toBe(ids.contact);
    expect((await task(ids.t1)).follow_up_id).toBe(ids.followUp);
  });

  it("dérive le statut de la date d'achèvement", async () => {
    expect((await task(ids.t2)).status).toBe("DONE");
    expect((await task(ids.t4)).status).toBe("DONE");
    expect((await task(ids.t1)).status).toBe("TODO");
  });

  it("reprend le créateur depuis l'audit CREATE uniquement, même désactivé", async () => {
    expect((await task(ids.t1)).created_by_id).toBe(ids.alice); // pas Bob, auteur d'une modification
    expect((await task(ids.t2)).created_by_id).toBe(ids.carol); // désactivée : fait historique
    expect((await task(ids.t6)).created_by_id).toBe(ids.eve);
  });

  it("ne déduit aucun créateur d'une donnée absente ou incohérente", async () => {
    expect((await task(ids.t3)).created_by_id).toBeNull(); // aucun audit
    expect((await task(ids.t4)).created_by_id).toBeNull(); // auteur supprimé
    expect((await task(ids.t5)).created_by_id).toBeNull(); // auteur d'un autre espace
  });

  it("n'affecte aucune tâche historique, même dans un espace à utilisateur unique", async () => {
    const assigned = await client.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id IS NOT NULL`);
    expect(assigned.rows[0].n).toBe(0);
    expect((await task(ids.t6)).assignee_id).toBeNull();
  });

  it("signale chaque information manquante", async () => {
    expect(await notes(ids.t1)).toEqual(["ASSIGNEE_UNKNOWN"]);
    expect(await notes(ids.t3)).toEqual(["ASSIGNEE_UNKNOWN", "CREATOR_UNKNOWN"]);
    expect(await notes(ids.t4)).toEqual(["ASSIGNEE_UNKNOWN", "CREATOR_UNKNOWN"]);
    expect(await notes(ids.t5)).toEqual(["ASSIGNEE_UNKNOWN", "CREATOR_UNKNOWN"]);
    const total = await client.query(`SELECT reason, count(*)::int AS n FROM task_migration_notes GROUP BY reason ORDER BY reason`);
    expect(total.rows).toEqual([
      { reason: "ASSIGNEE_UNKNOWN", n: 6 },
      { reason: "CREATOR_UNKNOWN", n: 3 },
    ]);
  });

  it("laisse intactes les tâches créées par la V1.0 (sans échéance comprise)", async () => {
    const t7 = await task(ids.t7);
    expect(t7.due_at).toBeNull();
    expect(t7.created_by_id).toBeNull();
    expect(await notes(ids.t7)).toEqual([]);
  });

  it("crée les nouvelles colonnes vides, sans rien supprimer", async () => {
    const t1 = await task(ids.t1);
    expect(t1.deleted_at).toBeNull();
    expect(t1.last_active_status).toBeNull();
    expect(t1.version).toBe(1);
  });
});
