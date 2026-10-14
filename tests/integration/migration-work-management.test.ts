import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Chemins de mise à niveau V1.0, sur des schémas PostgreSQL **jetables** de la
 * base de test (jamais la base de développement ni de production).
 *
 * Trois états de départ, mêmes données historiques :
 *   A — module jamais appliqué : version d'origine de 20261013120000, puis les
 *       migrations suivantes (c'est le chemin d'une base `main`) ;
 *   B — version d'origine appliquée, puis utilisation de la V1.0 (réaffectation,
 *       modification, commentaire, nouvelles tâches) avant les correctifs ;
 *   C — version révisée (c199fdd) appliquée, puis utilisation.
 *
 * Chaque migration est enregistrée dans `_prisma_migrations` comme le fait
 * Prisma (empreinte SHA-256 du fichier), ce qui permet aussi d'exercer
 * `scripts/migration-check.mjs`.
 */

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const V1 = "20261013120000_work_management";
const HARDENING = "20261014090000_work_management_hardening";
const RECONCILE = "20261014091000_work_management_legacy_reconcile";
const PROJECT_TRASH = "20261014092000_project_trash";
const PROJECT_TRASH_FK = "20261014093000_project_trash_constraints";
const REVISED_V1 = readFileSync(path.join(process.cwd(), "tests/fixtures/migrations/20261013120000_work_management.revised-c199fdd.sql"), "utf8");
const sql = (dir: string) => readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const dirs = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const stamp = Date.now().toString(36);
const url = process.env.TEST_DATABASE_URL!.replace(/\?.*$/, "");

const ids = {
  w1: "10000000-0000-4000-8000-000000000001",
  w2: "10000000-0000-4000-8000-000000000002",
  w3: "10000000-0000-4000-8000-000000000003",
  alice: "20000000-0000-4000-8000-000000000001",
  bob: "20000000-0000-4000-8000-000000000002",
  carol: "20000000-0000-4000-8000-000000000003", // désactivée
  dave: "20000000-0000-4000-8000-000000000004", // supprimé ensuite
  eve: "20000000-0000-4000-8000-000000000005", // seule dans W2
  frank: "20000000-0000-4000-8000-000000000006", // seul dans W3, aucun audit
  contact: "30000000-0000-4000-8000-000000000001",
  followUp: "40000000-0000-4000-8000-000000000001",
  t1: "50000000-0000-4000-8000-000000000001", // créée par Alice, modifiée par Bob
  t2: "50000000-0000-4000-8000-000000000002", // créée par Carol (désactivée), terminée
  t3: "50000000-0000-4000-8000-000000000003", // aucun audit
  t4: "50000000-0000-4000-8000-000000000004", // créée par Dave, supprimé depuis
  t5: "50000000-0000-4000-8000-000000000005", // audit forgé : auteur d'un autre espace
  t6: "50000000-0000-4000-8000-000000000006", // W2, espace à utilisateur unique
  t7: "50000000-0000-4000-8000-000000000007", // créée par la V1.0
  t8: "50000000-0000-4000-8000-000000000008", // W3, sans audit, sans échéance
  t9: "50000000-0000-4000-8000-000000000009", // créée par Alice ; réaffectée à Bob en V1.0
  t10: "50000000-0000-4000-8000-00000000000a", // créée par Alice ; statut changé en V1.0
  t11: "50000000-0000-4000-8000-00000000000b", // W3, sans audit ; commentée en V1.0
  t12: "50000000-0000-4000-8000-00000000000c", // sous-tâche V1.0 copiée sans historique
};
const LEGACY = ["t1", "t2", "t3", "t4", "t5", "t6", "t8", "t9", "t10", "t11"] as const;

type Row = Record<string, unknown>;

async function openSchema(name: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`CREATE SCHEMA "${name}"`);
  await client.query(`SET search_path TO "${name}"`);
  await client.query(`CREATE TABLE "_prisma_migrations" (
    id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
  const apply = async (migration: string, text = sql(migration)) => {
    await client.query(text);
    await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`, [randomUUID(), sha(text), migration]);
  };
  return { client, apply, name };
}

async function seedLegacy(client: Client) {
  const at = "'2026-01-01'";
  await client.query(`
    INSERT INTO workspaces (id, slug, name, updated_at) VALUES
      ('${ids.w1}', 'w1', 'Espace 1', now()), ('${ids.w2}', 'w2', 'Espace 2', now()), ('${ids.w3}', 'w3', 'Espace 3', now());
    INSERT INTO users (id, workspace_id, email, password_hash, is_active, updated_at) VALUES
      ('${ids.alice}', '${ids.w1}', 'alice@w1.test', 'x', true, now()),
      ('${ids.bob}',   '${ids.w1}', 'bob@w1.test',   'x', true, now()),
      ('${ids.carol}', '${ids.w1}', 'carol@w1.test', 'x', false, now()),
      ('${ids.dave}',  '${ids.w1}', 'dave@w1.test',  'x', true, now()),
      ('${ids.eve}',   '${ids.w2}', 'eve@w2.test',   'x', true, now()),
      ('${ids.frank}', '${ids.w3}', 'frank@w3.test', 'x', true, now());
    INSERT INTO contacts (id, workspace_id, first_name, last_name, updated_at) VALUES ('${ids.contact}', '${ids.w1}', 'Camille', 'Martin', now());
    INSERT INTO follow_ups (id, workspace_id, contact_id, title, due_at, updated_at) VALUES ('${ids.followUp}', '${ids.w1}', '${ids.contact}', 'Relance', now(), now());
    INSERT INTO tasks (id, workspace_id, contact_id, follow_up_id, title, notes, due_at, completed_at, created_at, updated_at) VALUES
      ('${ids.t1}', '${ids.w1}', '${ids.contact}', '${ids.followUp}', 'T1', 'Notes 1', '2026-09-01', NULL, ${at}, now()),
      ('${ids.t2}', '${ids.w1}', NULL, NULL, 'T2', NULL, '2026-08-01', '2026-08-02', ${at}, now()),
      ('${ids.t3}', '${ids.w1}', NULL, NULL, 'T3', NULL, '2026-10-01', NULL, ${at}, now()),
      ('${ids.t4}', '${ids.w1}', NULL, NULL, 'T4', NULL, '2026-10-02', '2026-10-03', ${at}, now()),
      ('${ids.t5}', '${ids.w1}', NULL, NULL, 'T5', NULL, '2026-10-04', NULL, ${at}, now()),
      ('${ids.t6}', '${ids.w2}', NULL, NULL, 'T6', NULL, '2026-10-05', NULL, ${at}, now()),
      ('${ids.t8}', '${ids.w3}', NULL, NULL, 'T8', NULL, '2026-10-06', NULL, ${at}, now()),
      ('${ids.t9}', '${ids.w1}', NULL, NULL, 'T9', NULL, '2026-10-07', NULL, ${at}, now()),
      ('${ids.t10}', '${ids.w1}', NULL, NULL, 'T10', NULL, '2026-10-08', NULL, ${at}, now()),
      ('${ids.t11}', '${ids.w3}', NULL, NULL, 'T11', NULL, '2026-10-09', NULL, ${at}, now());
    INSERT INTO audit_logs (id, workspace_id, user_id, action, entity_type, entity_id, created_at) VALUES
      (gen_random_uuid(), '${ids.w1}', '${ids.alice}', 'CREATE', 'Task', '${ids.t1}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w1}', '${ids.bob}',   'UPDATE', 'Task', '${ids.t1}', '2026-01-02'),
      (gen_random_uuid(), '${ids.w1}', '${ids.carol}', 'CREATE', 'Task', '${ids.t2}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w1}', '${ids.dave}',  'CREATE', 'Task', '${ids.t4}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w1}', '${ids.eve}',   'CREATE', 'Task', '${ids.t5}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w2}', '${ids.eve}',   'CREATE', 'Task', '${ids.t6}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w1}', '${ids.alice}', 'CREATE', 'Task', '${ids.t9}', '2026-01-01'),
      (gen_random_uuid(), '${ids.w1}', '${ids.alice}', 'CREATE', 'Task', '${ids.t10}', '2026-01-01');
    -- Dave quitte l'espace : son identifiant disparaît du journal (SET NULL).
    DELETE FROM users WHERE id = '${ids.dave}';
  `);
}

/** Utilisation de la V1.0 entre la première migration et les correctifs. */
async function useV1(client: Client) {
  await client.query(`
    UPDATE tasks SET assignee_id = '${ids.bob}' WHERE id = '${ids.t9}';
    INSERT INTO task_activities (id, workspace_id, task_id, actor_id, kind, field, old_value, new_value)
      VALUES (gen_random_uuid(), '${ids.w1}', '${ids.t9}', '${ids.alice}', 'field', 'Responsable', 'alice', 'bob');
    UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = '${ids.t10}';
    INSERT INTO task_activities (id, workspace_id, task_id, actor_id, kind, field, old_value, new_value)
      VALUES (gen_random_uuid(), '${ids.w1}', '${ids.t10}', '${ids.alice}', 'field', 'Statut', 'À faire', 'En cours');
    INSERT INTO comments (id, workspace_id, task_id, author_id, body)
      VALUES (gen_random_uuid(), '${ids.w3}', '${ids.t11}', '${ids.frank}', 'Je m''en occupe.');
    INSERT INTO tasks (id, workspace_id, title, due_at, assignee_id, created_by_id, updated_at)
      VALUES ('${ids.t7}', '${ids.w1}', 'T7', NULL, '${ids.bob}', '${ids.alice}', now());
    INSERT INTO task_activities (id, workspace_id, task_id, kind) VALUES (gen_random_uuid(), '${ids.w1}', '${ids.t7}', 'created');
    INSERT INTO tasks (id, workspace_id, title, parent_id, updated_at) VALUES ('${ids.t12}', '${ids.w1}', 'T12', '${ids.t7}', now());
  `);
}

const preserved = async (client: Client): Promise<Row[]> =>
  (
    await client.query(
      `SELECT id, workspace_id, title, notes, due_at, completed_at, contact_id, follow_up_id, is_demo, created_at
       FROM tasks WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [LEGACY.map((k) => ids[k])],
    )
  ).rows;
const people = async (client: Client) =>
  Object.fromEntries(
    (await client.query(`SELECT id, assignee_id, created_by_id FROM tasks`)).rows.map((r) => [r.id, { assignee: r.assignee_id, creator: r.created_by_id }]),
  ) as Record<string, { assignee: string | null; creator: string | null }>;
const notes = async (client: Client, id: string) =>
  (await client.query(`SELECT reason, detail FROM task_migration_notes WHERE task_id = $1 ORDER BY reason`, [id])).rows.map((r) => (r.detail ? `${r.reason}:${r.detail}` : r.reason));
const fullState = async (client: Client) => ({
  tasks: (await client.query(`SELECT * FROM tasks ORDER BY id`)).rows,
  notes: (await client.query(`SELECT task_id, reason, detail FROM task_migration_notes ORDER BY task_id, reason`)).rows,
  counts: (await client.query(`SELECT (SELECT count(*) FROM audit_logs) a, (SELECT count(*) FROM comments) c, (SELECT count(*) FROM task_activities) t`)).rows[0],
});

function check(schema: string, ...args: string[]) {
  try {
    return { code: 0, out: execFileSync("node", ["scripts/migration-check.mjs", ...args], { env: { ...process.env, DATABASE_URL: `${url}?schema=${schema}` }, encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

const opened: { client: Client; name: string }[] = [];
afterAll(async () => {
  for (const { client, name } of opened) {
    await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    await client.end();
  }
});

describe("versions de la première migration", () => {
  it("la version révisée ne diffère de l'origine que par le remplissage : schéma identique", () => {
    // Tout ce qui précède le remplissage de données, sans les commentaires.
    const ddl = (text: string) =>
      text
        .slice(0, text.indexOf('UPDATE "tasks" SET "status"'))
        .replace(/--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
    expect(sha(sql(V1))).toBe("7a410c8d1807791285ffc3052b7a0c83fb0a9b2e83f45341a3855b35650777c8");
    expect(sha(REVISED_V1)).toBe("b7fae256791d133c42b47bdf20cc832e91c35c61cc64b36c76ccfe1a0f5dc792");
    expect(ddl(REVISED_V1)).toBe(ddl(sql(V1)));
    expect(ddl(sql(V1)).length).toBeGreaterThan(10_000);
  });
});

describe.each(["A", "B", "C"] as const)("mise à niveau depuis l'état %s", (state) => {
  let db: Awaited<ReturnType<typeof openSchema>>;
  let before: Row[];

  beforeAll(async () => {
    db = await openSchema(`mig_${state.toLowerCase()}_${stamp}`);
    opened.push(db);
    for (const dir of dirs.filter((d) => d < V1)) await db.apply(dir);
    await seedLegacy(db.client);
    before = await preserved(db.client);

    await db.apply(V1, state === "C" ? REVISED_V1 : sql(V1));
    if (state === "B") await useV1(db.client);
    if (state !== "A") expect(check(db.name).out).toContain(`État ${state}`);
    await db.apply(HARDENING);
    if (state === "C") await useV1(db.client);
    await db.apply(RECONCILE);
    await db.apply(PROJECT_TRASH);
    await db.apply(PROJECT_TRASH_FK);
  });

  it("conserve toutes les lignes et leurs valeurs (volumes, liens CRM, dates, journal)", async () => {
    expect(await preserved(db.client)).toEqual(before);
    const counts = (await fullState(db.client)).counts;
    expect(Number(counts.a)).toBe(8);
    expect((await db.client.query(`SELECT status FROM tasks WHERE id = $1`, [ids.t2])).rows[0].status).toBe("DONE");
    expect((await db.client.query(`SELECT contact_id, follow_up_id FROM tasks WHERE id = $1`, [ids.t1])).rows[0]).toEqual({ contact_id: ids.contact, follow_up_id: ids.followUp });
  });

  it("ne laisse aucun responsable déduit sur une tâche historique non utilisée", async () => {
    const p = await people(db.client);
    for (const k of ["t1", "t2", "t3", "t4", "t5", "t6", "t8"] as const) expect(p[ids[k]].assignee, k).toBeNull();
    expect(p[ids.t1].creator).toBe(ids.alice);
    expect(p[ids.t2].creator).toBe(ids.carol);
    expect(p[ids.t6].creator).toBe(ids.eve);
    for (const k of ["t3", "t4", "t5", "t8"] as const) expect(p[ids[k]].creator, k).toBeNull();
    for (const k of ["t1", "t3", "t8"] as const) expect(await notes(db.client, ids[k]), k).toContain("ASSIGNEE_UNKNOWN");
  });

  if (state === "A") {
    it("état A : l'ancien remplissage est annulé et tracé", async () => {
      expect(await notes(db.client, ids.t1)).toEqual(["ASSIGNEE_INFERRED_REVERTED:" + ids.alice, "ASSIGNEE_UNKNOWN"]);
      expect(await notes(db.client, ids.t8)).toEqual([
        "ASSIGNEE_INFERRED_REVERTED:" + ids.frank,
        "ASSIGNEE_UNKNOWN",
        "CREATOR_INFERRED_REVERTED:" + ids.frank,
        "CREATOR_UNKNOWN",
      ]);
      const p = await people(db.client);
      expect([p[ids.t9].assignee, p[ids.t10].assignee, p[ids.t11].assignee]).toEqual([null, null, null]);
    });
  }

  if (state === "B") {
    it("état B : les affectations faites ou confirmées en V1.0 sont conservées, les cas ambigus signalés", async () => {
      const p = await people(db.client);
      expect(p[ids.t9].assignee).toBe(ids.bob); // réaffectation explicite : intacte
      expect(await notes(db.client, ids.t9)).toEqual([]);
      expect(p[ids.t10].assignee).toBe(ids.alice); // tâche utilisée : conservée, signalée
      expect(await notes(db.client, ids.t10)).toEqual(["ASSIGNEE_INFERRED_KEPT:" + ids.alice]);
      expect(p[ids.t11]).toEqual({ assignee: ids.frank, creator: ids.frank });
      expect(await notes(db.client, ids.t11)).toEqual(["ASSIGNEE_INFERRED_KEPT:" + ids.frank, "CREATOR_INFERRED_KEPT:" + ids.frank]);
      expect(p[ids.t1].assignee).toBeNull(); // jamais utilisée : retirée
      expect(await notes(db.client, ids.t1)).toEqual(["ASSIGNEE_INFERRED_REVERTED:" + ids.alice, "ASSIGNEE_UNKNOWN"]);
    });
  }

  if (state === "C") {
    it("état C : rien n'avait été déduit, les affectations V1.0 restent", async () => {
      const p = await people(db.client);
      expect(p[ids.t9].assignee).toBe(ids.bob);
      expect(p[ids.t10].assignee).toBeNull();
      const inferred = await db.client.query(`SELECT count(*)::int n FROM task_migration_notes WHERE reason LIKE '%INFERRED%'`);
      expect(inferred.rows[0].n).toBe(0);
    });
  }

  if (state !== "A") {
    it("les tâches créées par la V1.0 ne sont ni modifiées ni signalées", async () => {
      const p = await people(db.client);
      expect(p[ids.t7]).toEqual({ assignee: ids.bob, creator: ids.alice });
      expect(await notes(db.client, ids.t7)).toEqual([]);
      expect(await notes(db.client, ids.t12)).toEqual([]); // sous-tâche sans historique
    });
  }

  it("une seconde exécution ne crée aucun doublon et ne modifie rien", async () => {
    const first = await fullState(db.client);
    await db.client.query(sql(RECONCILE));
    await db.client.query(sql(PROJECT_TRASH));
    await db.client.query(sql(PROJECT_TRASH_FK));
    expect(await fullState(db.client)).toEqual(first);
  });

  if (state === "C") {
    /**
     * Le nom d'un objet ne prouve pas sa définition : chaque altération garde
     * le bon nom mais change la définition. La réconciliation doit refuser,
     * nommer précisément la divergence, et ne rien écrire.
     */
    const ALTERATIONS: { what: string; breakSql: string; fixSql: string; expect: string }[] = [
      {
        what: "type de colonne",
        breakSql: `ALTER TABLE projects ALTER COLUMN color TYPE varchar(64)`,
        fixSql: `ALTER TABLE projects ALTER COLUMN color TYPE text`,
        expect: "colonne projects.color : type attendu « text », trouvé « character varying(64) »",
      },
      {
        what: "nullabilité",
        breakSql: `ALTER TABLE projects ALTER COLUMN color DROP NOT NULL`,
        fixSql: `ALTER TABLE projects ALTER COLUMN color SET NOT NULL`,
        expect: "colonne projects.color : NOT NULL attendu « oui », trouvé « non »",
      },
      {
        what: "nullabilité modifiée par la migration (DROP NOT NULL de due_at)",
        breakSql: `UPDATE tasks SET due_at = now() WHERE due_at IS NULL; ALTER TABLE tasks ALTER COLUMN due_at SET NOT NULL`,
        fixSql: `ALTER TABLE tasks ALTER COLUMN due_at DROP NOT NULL; UPDATE tasks SET due_at = NULL WHERE id IN ('${ids.t7}')`,
        expect: "colonne tasks.due_at : NOT NULL attendu « non », trouvé « oui »",
      },
      {
        what: "valeur par défaut",
        breakSql: `ALTER TABLE projects ALTER COLUMN color SET DEFAULT 'red'`,
        fixSql: `ALTER TABLE projects ALTER COLUMN color SET DEFAULT 'indigo'`,
        expect: "colonne projects.color : valeur par défaut attendu « 'indigo'::text », trouvé « 'red'::text »",
      },
      {
        what: "valeurs d'enum",
        breakSql: `ALTER TYPE "TaskStatus" RENAME VALUE 'WAITING' TO 'BLOCKED'`,
        fixSql: `ALTER TYPE "TaskStatus" RENAME VALUE 'BLOCKED' TO 'WAITING'`,
        expect: "enum TaskStatus : attendu « TODO, IN_PROGRESS, WAITING, DONE », trouvé « TODO, IN_PROGRESS, BLOCKED, DONE »",
      },
      {
        what: "colonnes et ordre d'un index",
        breakSql: `DROP INDEX task_projects_project_id_section_id_position_idx; CREATE INDEX task_projects_project_id_section_id_position_idx ON task_projects (position, project_id)`,
        fixSql: `DROP INDEX task_projects_project_id_section_id_position_idx; CREATE INDEX task_projects_project_id_section_id_position_idx ON task_projects (project_id, section_id, position)`,
        expect: "index task_projects_project_id_section_id_position_idx : attendu",
      },
      {
        what: "prédicat d'un index",
        breakSql: `DROP INDEX tasks_workspace_id_deleted_at_idx; CREATE INDEX tasks_workspace_id_deleted_at_idx ON tasks (workspace_id, deleted_at) WHERE deleted_at IS NULL`,
        fixSql: `DROP INDEX tasks_workspace_id_deleted_at_idx; CREATE INDEX tasks_workspace_id_deleted_at_idx ON tasks (workspace_id, deleted_at)`,
        expect: "WHERE (deleted_at IS NULL)",
      },
      {
        what: "unicité d'un index",
        breakSql: `DROP INDEX task_reminders_reminder_key_key; CREATE INDEX task_reminders_reminder_key_key ON task_reminders (reminder_key)`,
        fixSql: `DROP INDEX task_reminders_reminder_key_key; CREATE UNIQUE INDEX task_reminders_reminder_key_key ON task_reminders (reminder_key)`,
        expect: "index task_reminders_reminder_key_key : attendu « CREATE UNIQUE INDEX",
      },
      {
        what: "action ON DELETE d'une clé étrangère",
        breakSql: `ALTER TABLE task_projects DROP CONSTRAINT task_projects_task_id_fkey; ALTER TABLE task_projects ADD CONSTRAINT task_projects_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE`,
        fixSql: `ALTER TABLE task_projects DROP CONSTRAINT task_projects_task_id_fkey; ALTER TABLE task_projects ADD CONSTRAINT task_projects_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE`,
        expect: "contrainte task_projects.task_projects_task_id_fkey : attendu « f FOREIGN KEY (task_id) REFERENCES tasks(id) ON UPDATE CASCADE ON DELETE CASCADE », trouvé « f FOREIGN KEY (task_id) REFERENCES tasks(id) ON UPDATE CASCADE ON DELETE RESTRICT »",
      },
      {
        what: "table référencée par une clé étrangère",
        breakSql: `ALTER TABLE tasks DROP CONSTRAINT tasks_deleted_by_id_fkey; ALTER TABLE tasks ADD CONSTRAINT tasks_deleted_by_id_fkey FOREIGN KEY (deleted_by_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`,
        fixSql: `ALTER TABLE tasks DROP CONSTRAINT tasks_deleted_by_id_fkey; ALTER TABLE tasks ADD CONSTRAINT tasks_deleted_by_id_fkey FOREIGN KEY (deleted_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,
        expect: "contrainte tasks.tasks_deleted_by_id_fkey : attendu",
      },
      {
        what: "clé primaire",
        breakSql: `ALTER TABLE task_migration_notes DROP CONSTRAINT task_migration_notes_pkey; ALTER TABLE task_migration_notes ADD CONSTRAINT task_migration_notes_pkey PRIMARY KEY (task_id, reason, workspace_id)`,
        fixSql: `ALTER TABLE task_migration_notes DROP CONSTRAINT task_migration_notes_pkey; ALTER TABLE task_migration_notes ADD CONSTRAINT task_migration_notes_pkey PRIMARY KEY (task_id, reason)`,
        expect: "contrainte task_migration_notes.task_migration_notes_pkey : attendu « p PRIMARY KEY (task_id, reason) », trouvé « p PRIMARY KEY (task_id, reason, workspace_id) »",
      },
    ];
    const business = async () =>
      (await db.client.query(`SELECT md5(coalesce((SELECT string_agg(t::text, '' ORDER BY id) FROM tasks t), '') || coalesce((SELECT string_agg(n::text, '' ORDER BY task_id, reason) FROM task_migration_notes n), '')) AS h`)).rows[0].h;
    const recorded = async () => (await db.client.query(`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1`, [V1])).rows[0].checksum;

    it("le schéma réel est conforme au schéma reconstruit (aucune divergence)", () => {
      const diagnostic = check(db.name);
      expect(diagnostic.code, diagnostic.out).toBe(0);
      expect(diagnostic.out).toContain("Schéma : conforme aux");
    });

    it.each(ALTERATIONS)("refuse un nom correct mais une définition fausse : $what", async ({ breakSql, fixSql, expect: message }) => {
      // Données métier figées avant l'altération (l'altération elle-même peut en
      // modifier, comme le cas de due_at ; la réconciliation, jamais).
      await db.client.query(breakSql);
      const dataBefore = await business();
      const refused = check(db.name, "--reconcile");
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain("réconciliation refusée");
      expect(refused.out).toContain(message);
      expect(await recorded()).toBe(sha(REVISED_V1)); // empreinte inchangée
      expect(await business()).toBe(dataBefore); // aucune donnée métier modifiée
      const temp = await db.client.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE '\_nod\_check\_%'`);
      expect(temp.rows[0].n).toBe(0); // schéma temporaire jamais conservé
      await db.client.query(fixSql);
      expect(check(db.name).code).toBe(0);
    });

    it("refuse une migration inachevée ou une incohérence d'historique", async () => {
      await db.client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, 'x', $2, now())`, [randomUUID(), PROJECT_TRASH_FK]);
      const unfinished = check(db.name, "--reconcile");
      expect(unfinished.code).toBe(1);
      expect(unfinished.out).toContain(`${PROJECT_TRASH_FK} : migration inachevée`);
      expect(await recorded()).toBe(sha(REVISED_V1));
      await db.client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`, [PROJECT_TRASH_FK]);

      await db.client.query(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, 'y', now(), '20991231000000_absente', 1)`, [randomUUID()]);
      const unknown = check(db.name, "--reconcile");
      expect(unknown.code).toBe(1);
      expect(unknown.out).toContain("20991231000000_absente : enregistrée dans _prisma_migrations mais absente du dépôt");
      expect(await recorded()).toBe(sha(REVISED_V1));
      await db.client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20991231000000_absente'`);

      await db.client.query(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = $1`, [HARDENING]);
      const gap = check(db.name, "--reconcile");
      expect(gap.code).toBe(1);
      expect(gap.out).toContain(`${HARDENING} : annulée sans nouvelle application`);
      expect(gap.out).toContain("trou dans l'historique");
      expect(await recorded()).toBe(sha(REVISED_V1));
      await db.client.query(`UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE migration_name = $1`, [HARDENING]);
    });

    it("la réconciliation attend une migration Prisma en cours (même verrou consultatif)", async () => {
      const other = new Client({ connectionString: url });
      await other.connect();
      await other.query("SELECT pg_advisory_lock(72707369)"); // comme `prisma migrate deploy`
      const pending = new Promise<{ code: number; out: string; finishedAt: number }>((resolve) => {
        execFile("node", ["scripts/migration-check.mjs"], { env: { ...process.env, DATABASE_URL: `${url}?schema=${db.name}` } }, (error, stdout, stderr) =>
          resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}`, finishedAt: Date.now() }),
        );
      });
      // Le contrôle est bloqué tant que le verrou est tenu.
      await new Promise((r) => setTimeout(r, 3000));
      const unlockedAt = Date.now();
      await other.query("SELECT pg_advisory_unlock(72707369)");
      await other.end();
      const result = await pending;
      expect(result.code, result.out).toBe(0);
      expect(result.finishedAt).toBeGreaterThanOrEqual(unlockedAt);
    });
  }

  it("le contrôle d'historique reconnaît l'état et ne réconcilie que l'état C", async () => {
    const diagnostic = check(db.name);
    if (state === "C") {
      expect(diagnostic.out).toContain("État C");
      expect(diagnostic.out).toContain(`≠  ${V1}`);
      // Un objet manquant (renommé) bloque aussi la réconciliation, sans rien écrire.
      await db.client.query(`ALTER INDEX "task_projects_project_id_section_id_position_idx" RENAME TO "renamed_idx"`);
      const missing = check(db.name, "--reconcile");
      expect(missing.code).toBe(1);
      expect(missing.out).toContain("index task_projects_project_id_section_id_position_idx : absent(e)");
      expect(missing.out).toContain("index renamed_idx : en trop");
      expect((await db.client.query(`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1`, [V1])).rows[0].checksum).toBe(sha(REVISED_V1));
      await db.client.query(`ALTER INDEX "renamed_idx" RENAME TO "task_projects_project_id_section_id_position_idx"`);
      const done = check(db.name, "--reconcile");
      expect(done.code, done.out).toBe(0);
      const after = check(db.name);
      expect(after.code).toBe(0);
      expect(after.out).toContain("État B");
      expect(after.out).not.toContain("≠");
    } else {
      expect(diagnostic.code, diagnostic.out).toBe(0);
      expect(diagnostic.out).toContain(state === "A" ? "État B" : "État B"); // version d'origine enregistrée
      expect(check(db.name, "--reconcile").code).toBe(1); // refus : rien à réconcilier
    }
  });
});

describe("contrôle d'une base jamais migrée", () => {
  it("l'état A est reconnu avant toute migration V1.0", async () => {
    const db = await openSchema(`mig_empty_${stamp}`);
    opened.push(db);
    for (const dir of dirs.filter((d) => d < V1)) await db.apply(dir);
    const out = check(db.name);
    expect(out.out).toContain("État A");
    expect(out.out).toContain(`·  ${V1} — à appliquer`);
  });
});
