import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

// Script JavaScript de production, importé tel quel (aucune copie de sa logique).
import { backfill, BackfillRefusal, formatReport, parseArgs } from "../../scripts/backfill-owner.mjs";

import { addUserToWorkspace, createWorkspaceWithUser, resetDatabase, type TestUser } from "./fixtures";

/**
 * Lot A, étape 2 : `scripts/backfill-owner.mjs`.
 *
 * La base de test est au schéma final (`owner_id` NOT NULL). Chaque test
 * remet d'abord les colonnes dans l'état « après la migration 1, avant le
 * backfill » (nullable), y écrit des données héritées, puis rejoue la
 * migration 2 telle qu'elle est livrée : elle doit refuser tant que tout n'est
 * pas attribué, et passer ensuite.
 */

const OWNED = ["organizations", "contacts", "follow_ups", "opportunities", "privacy_treatments", "privacy_processors", "privacy_requests", "privacy_incidents"];
const MIGRATION_2 = readFileSync(
  path.resolve(__dirname, "../../prisma/migrations/20261021100000_permissions_owner_required/migration.sql"),
  "utf8",
);

let client: pg.Client;
let alice: TestUser;

async function legacyState(): Promise<void> {
  for (const table of OWNED) await client.query(`ALTER TABLE ${table} ALTER COLUMN owner_id DROP NOT NULL`);
  await client.query(`ALTER TABLE projects ALTER COLUMN visibility SET DEFAULT 'WORKSPACE'`);
}

/** Données « écrites par l'ancien code » : sans propriétaire, projet ouvert à l'espace, tâche libre sans créateur. */
async function legacyRows(workspaceId: string, label: string): Promise<void> {
  await client.query(`INSERT INTO organizations (id, workspace_id, name, updated_at) VALUES (gen_random_uuid(), $1, $2, now())`, [workspaceId, `Org ${label}`]);
  await client.query(`INSERT INTO contacts (id, workspace_id, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, 'Camille', $2, now())`, [workspaceId, label]);
  await client.query(`INSERT INTO follow_ups (id, workspace_id, title, due_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now(), now())`, [workspaceId, `Suivi ${label}`]);
  await client.query(`INSERT INTO privacy_treatments (id, workspace_id, name, purpose, updated_at) VALUES (gen_random_uuid(), $1, $2, 'x', now())`, [workspaceId, `Traitement ${label}`]);
  await client.query(`INSERT INTO projects (id, workspace_id, name, visibility, updated_at) VALUES (gen_random_uuid(), $1, $2, 'WORKSPACE', now())`, [workspaceId, `Projet ${label}`]);
  await client.query(`INSERT INTO tasks (id, workspace_id, title, updated_at) VALUES (gen_random_uuid(), $1, $2, now())`, [workspaceId, `Tâche libre ${label}`]);
  await client.query(`INSERT INTO tags (id, workspace_id, name) VALUES (gen_random_uuid(), $1, $2)`, [workspaceId, `tag-${label}`]);
}

async function missingOwners(): Promise<number> {
  let n = 0;
  for (const table of OWNED) n += Number((await client.query(`SELECT count(*) FROM ${table} WHERE owner_id IS NULL`)).rows[0].count);
  return n + Number((await client.query(`SELECT count(*) FROM projects WHERE visibility = 'WORKSPACE'`)).rows[0].count);
}

const run = (extra: Partial<{ dryRun: boolean; e2eUsers: string[]; owner: string }> = {}) =>
  backfill(client, { workspace: alice.workspaceId, owner: alice.email, e2eUsers: [], dryRun: false, ...extra });

describe("backfill du lot A", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
  });
  afterAll(async () => client.end());

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("backfill-ws");
    await legacyState();
    await legacyRows(alice.workspaceId, "héritée");
  });

  afterEach(async () => {
    // Remet le schéma final quoi qu'il arrive (la base de test est partagée).
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DELETE FROM workspaces`);
    await client.query(MIGRATION_2);
  });

  it("dry-run : annonce les comptes par table et n'écrit rien", async () => {
    const report = await run({ dryRun: true });
    expect(report["Attribution"]).toMatchObject({ organizations: 1, contacts: 1, follow_ups: 1, privacy_treatments: 1, "tags (créateur)": 1 });
    expect(report["Projets"]).toMatchObject({ "owner_id renseigné": 1, "WORKSPACE → PRIVATE": 1 });
    expect(report["Tâches libres"]).toMatchObject({ "créateur absent → propriétaire": 1 });
    expect(formatReport(report)).toContain("DRY-RUN — rien n'a été enregistré (ROLLBACK)");
    expect(await missingOwners()).toBe(5);
    expect((await client.query(`SELECT created_by_id FROM tasks`)).rows).toEqual([{ created_by_id: null }]);
  });

  it("exécution puis relance : tout est attribué une fois, la seconde exécution n'écrit rien", async () => {
    await run();
    expect(await missingOwners()).toBe(0);
    expect((await client.query(`SELECT DISTINCT owner_id FROM contacts`)).rows).toEqual([{ owner_id: alice.userId }]);
    expect((await client.query(`SELECT owner_id, visibility FROM projects`)).rows).toEqual([{ owner_id: alice.userId, visibility: "PRIVATE" }]);

    const again = await run();
    const written = Object.entries(again)
      .filter(([section]) => section !== "meta" && section !== "Accès perdus (non préservables)")
      .flatMap(([, rows]) => Object.values(rows as Record<string, number>));
    expect(written.every((n) => n === 0)).toBe(true);
  });

  it("créations faites entre les deux déploiements : la migration 2 refuse, la relance du backfill les rattrape", async () => {
    await run();
    // L'ancien code tourne encore : il crée des fiches sans propriétaire et un projet « espace ».
    await legacyRows(alice.workspaceId, "entre-temps");
    await expect(client.query(MIGRATION_2)).rejects.toThrow(/backfill incomplet, migration refusée sans modification\..*contacts=1/);
    // Rien n'a été modifié par le refus.
    expect((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'owner_id'`)).rows).toEqual([{ is_nullable: "YES" }]);

    const caught = await run();
    expect(caught["Attribution"]).toMatchObject({ organizations: 1, contacts: 1, follow_ups: 1, privacy_treatments: 1 });
    expect(caught["Projets"]).toMatchObject({ "WORKSPACE → PRIVATE": 1 });
    expect(await missingOwners()).toBe(0);
    await client.query(MIGRATION_2);
    expect((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'owner_id'`)).rows).toEqual([{ is_nullable: "NO" }]);
  });

  it("tâche libre d'une autre personne, sans responsable, qu'elle suivait seulement : elle en devient collaboratrice", async () => {
    // Régression trouvée par l'instantané : `assignee_id = …` vaut NULL sans responsable.
    const ex = await addUserToWorkspace(alice.workspaceId, "Ancienne");
    await prisma.user.update({ where: { id: ex.userId }, data: { isActive: false } });
    const task = (
      await client.query(`INSERT INTO tasks (id, workspace_id, title, created_by_id, updated_at) VALUES (gen_random_uuid(), $1, 'Suivie', $2, now()) RETURNING id`, [alice.workspaceId, ex.userId])
    ).rows[0].id as string;
    await client.query(`INSERT INTO task_followers (task_id, user_id, kind) VALUES ($1, $2, 'FOLLOWER')`, [task, alice.userId]);
    await run();
    expect((await client.query(`SELECT kind FROM task_followers WHERE task_id = $1 AND user_id = $2`, [task, alice.userId])).rows).toEqual([{ kind: "COLLABORATOR" }]);
  });

  it("refuse si l'espace compte un autre utilisateur actif, sans rien écrire", async () => {
    const bob = await addUserToWorkspace(alice.workspaceId, "Bob");
    await expect(run()).rejects.toThrow(BackfillRefusal);
    await expect(run()).rejects.toThrow(bob.email.toLowerCase());
    expect(await missingOwners()).toBe(5);
    // Désactivé, il ne bloque plus.
    await prisma.user.update({ where: { id: bob.userId }, data: { isActive: false } });
    await run();
    expect(await missingOwners()).toBe(0);
  });

  it("comptes e2e : désignés un par un, domaine .test obligatoire, listés avec leur statut dans le rapport", async () => {
    const e2e = await addUserToWorkspace(alice.workspaceId, "e2e"); // adresse en « @member.test »
    await expect(run()).rejects.toThrow(e2e.email.toLowerCase());
    const report = await run({ dryRun: true, e2eUsers: [e2e.email] });
    expect(report.meta.excluded).toEqual([{ email: e2e.email.toLowerCase(), isActive: true }]);
    expect(formatReport(report)).toContain(e2e.email.toLowerCase());
    expect(formatReport(report)).toMatch(/Comptes exclus du garde-fou.*\n\s+\S+\s+isActive=true/);

    const real = await addUserToWorkspace(alice.workspaceId, "Reelle");
    await prisma.user.update({ where: { id: real.userId }, data: { email: "reelle@acme.fr" } });
    await expect(run({ e2eUsers: [e2e.email, "reelle@acme.fr"] })).rejects.toThrow(/adresse en « \.test »/);
    await expect(run({ e2eUsers: [e2e.email, "absent@ailleurs.test"] })).rejects.toThrow(/n'appartient pas à cet espace/);
  });

  it("refuse un propriétaire inconnu ou désactivé, et des arguments incomplets", async () => {
    await expect(run({ owner: "personne@acme.fr" })).rejects.toThrow(/n'appartient pas à cet espace/);
    await prisma.user.update({ where: { id: alice.userId }, data: { isActive: false } });
    await expect(run()).rejects.toThrow(/désactivé/);
    expect(() => parseArgs(["--owner", "a@b.fr"])).toThrow(/--workspace/);
    expect(() => parseArgs(["--workspace", alice.workspaceId])).toThrow(/--owner/);
    expect(parseArgs(["--workspace", alice.workspaceId, "--owner", "A@B.FR", "--dry-run", "--e2e-user", "X@Y.TEST"])).toEqual({
      workspace: alice.workspaceId,
      owner: "a@b.fr",
      dryRun: true,
      e2eUsers: ["x@y.test"],
    });
  });
});
