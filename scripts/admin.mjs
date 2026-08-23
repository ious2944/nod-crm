#!/usr/bin/env node
/**
 * CLI d'administration NOD CRM.
 *
 * Volontairement écrit en JavaScript simple, avec `pg` et `@node-rs/argon2`
 * uniquement : il tourne tel quel dans l'image de production, sans `tsx` ni
 * étape de compilation.
 *
 *   node scripts/admin.mjs create-workspace [--slug acme] [--name "Acme Corp"]
 *   node scripts/admin.mjs create-user      [--email you@example.com] [--workspace acme]
 *   node scripts/admin.mjs list-workspaces
 *   node scripts/admin.mjs list-users
 *   node scripts/admin.mjs disable-user     --email you@example.com
 *   node scripts/admin.mjs reset-password   --email you@example.com
 *
 * Le mot de passe est TOUJOURS saisi de manière interactive : il n'est jamais
 * accepté en argument (l'historique du shell et `ps` le rendraient visible),
 * jamais affiché, jamais journalisé.
 */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import process from "node:process";

import { hash } from "@node-rs/argon2";
import pg from "pg";

const ARGON2_OPTIONS = {
  // `Algorithm` de @node-rs/argon2 est un const enum ambiant : il n'existe pas
  // à l'exécution. On passe donc directement la valeur d'Argon2id (2), comme
  // dans src/lib/auth/password.ts.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    options[key] = next && !next.startsWith("--") ? (i += 1, next) : "true";
  }
  return options;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Saisie masquée : rien n'apparaît à l'écran, pas même des astérisques. */
function askSecret(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "La saisie du mot de passe exige un terminal interactif. " +
            "Lancez la commande avec `docker compose exec -it` (pas `-T`).",
        ),
      );
      return;
    }

    process.stdout.write(question);
    // readline avec terminal:true n'appelle pas input.resume() (contrairement
    // au mode non-terminal). Si ask() a précédemment fermé son interface
    // (→ rl.close() → input.pause()), stdin reste suspendu et le prompt ne
    // reçoit jamais de données. On le reprend explicitement avant de créer
    // l'interface.
    process.stdin.resume();
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    rl._writeToOutput = () => {};

    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function describePasswordProblem(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password.length > 256) return "Le mot de passe ne peut pas dépasser 256 caractères.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(password)).length;
  if (classes < 3) {
    return "Le mot de passe doit mélanger au moins trois types de caractères.";
  }
  return null;
}

async function promptNewPassword() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const password = await askSecret("Mot de passe (saisie masquée) : ");
    const problem = describePasswordProblem(password);
    if (problem) {
      console.error(`  ✗ ${problem}`);
      continue;
    }
    const confirmation = await askSecret("Confirmation                 : ");
    if (password !== confirmation) {
      console.error("  ✗ Les deux saisies diffèrent.");
      continue;
    }
    return password;
  }
  throw new Error("Trop de tentatives infructueuses.");
}

function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est absent de l'environnement.");
  }
  return new pg.Client({ connectionString });
}

async function createWorkspace(client, options) {
  const slug = (options.slug || (await ask("Slug du workspace (ex. acme) : "))).trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    throw new Error("Slug invalide : minuscules, chiffres et tirets uniquement.");
  }
  const name = (options.name || (await ask("Nom affiché : "))).trim();
  if (!name) throw new Error("Le nom est obligatoire.");

  const { rows } = await client.query(
    `INSERT INTO workspaces (id, slug, name, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [randomUUID(), slug, name],
  );

  if (rows.length === 0) {
    console.log(`Le workspace « ${slug} » existe déjà — rien à faire.`);
    return;
  }
  console.log(`Workspace « ${slug} » créé.`);
}

async function createUser(client, options) {
  const email = (options.email || (await ask("Adresse email : "))).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    throw new Error("Adresse email invalide.");
  }

  const slug = (options.workspace || (await ask("Slug du workspace : "))).trim();
  const workspace = await client.query("SELECT id, name FROM workspaces WHERE slug = $1", [slug]);
  if (workspace.rows.length === 0) {
    throw new Error(
      `Workspace « ${slug} » introuvable. Créez-le d'abord : npm run workspace:create`,
    );
  }

  const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    throw new Error(`Un compte existe déjà pour ${email}.`);
  }

  const displayName = options.name || (await ask("Nom affiché (facultatif) : "));
  const password = await promptNewPassword();
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  await client.query(
    `INSERT INTO users (id, workspace_id, email, password_hash, display_name, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, now(), now())`,
    [randomUUID(), workspace.rows[0].id, email, passwordHash, displayName || null],
  );

  console.log(`Utilisateur ${email} créé dans « ${workspace.rows[0].name} ».`);
}

async function resetPassword(client, options) {
  const email = (options.email || (await ask("Adresse email : "))).trim().toLowerCase();
  const user = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  if (user.rows.length === 0) throw new Error(`Aucun compte pour ${email}.`);

  const password = await promptNewPassword();
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
    passwordHash,
    user.rows[0].id,
  ]);
  // Un changement de mot de passe invalide toutes les sessions ouvertes.
  const { rowCount } = await client.query("DELETE FROM sessions WHERE user_id = $1", [
    user.rows[0].id,
  ]);

  console.log(`Mot de passe remplacé pour ${email}. ${rowCount} session(s) révoquée(s).`);
}

async function disableUser(client, options) {
  const email = (options.email || (await ask("Adresse email : "))).trim().toLowerCase();
  const { rows } = await client.query(
    "UPDATE users SET is_active = false, updated_at = now() WHERE email = $1 RETURNING id",
    [email],
  );
  if (rows.length === 0) throw new Error(`Aucun compte pour ${email}.`);

  const { rowCount } = await client.query("DELETE FROM sessions WHERE user_id = $1", [rows[0].id]);
  console.log(`Compte ${email} désactivé. ${rowCount} session(s) révoquée(s).`);
}

/**
 * Indispensable avant de créer le premier compte sur une base existante :
 * l'utilisateur doit être rattaché au workspace qui contient déjà les données,
 * sinon l'isolation les lui masque et la base paraît vide.
 */
async function listWorkspaces(client) {
  const { rows } = await client.query(
    `SELECT w.slug, w.name,
            (SELECT count(*) FROM follow_ups f WHERE f.workspace_id = w.id) AS follow_ups,
            (SELECT count(*) FROM contacts c  WHERE c.workspace_id = w.id) AS contacts,
            (SELECT count(*) FROM users u     WHERE u.workspace_id = w.id) AS users
     FROM workspaces w ORDER BY w.slug`,
  );
  if (rows.length === 0) {
    console.log("Aucun workspace. Créez-en un : npm run workspace:create");
    return;
  }
  console.log("slug\tnom\tsuivis\tcontacts\tutilisateurs");
  for (const row of rows) {
    console.log(`${row.slug}\t${row.name}\t${row.follow_ups}\t${row.contacts}\t${row.users}`);
  }
}

async function listUsers(client) {
  const { rows } = await client.query(
    `SELECT u.email, u.display_name, u.is_active, u.last_login_at, w.slug
     FROM users u JOIN workspaces w ON w.id = u.workspace_id
     ORDER BY u.email`,
  );
  if (rows.length === 0) {
    console.log("Aucun utilisateur.");
    return;
  }
  for (const row of rows) {
    const state = row.is_active ? "actif" : "désactivé";
    const last = row.last_login_at ? row.last_login_at.toISOString() : "jamais";
    console.log(`${row.email}\t${row.slug}\t${state}\tdernière connexion : ${last}`);
  }
}

const COMMANDS = {
  "create-workspace": createWorkspace,
  "create-user": createUser,
  "reset-password": resetPassword,
  "disable-user": disableUser,
  "list-workspaces": listWorkspaces,
  "list-users": listUsers,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];

  if (!handler) {
    console.error(`Commandes disponibles : ${Object.keys(COMMANDS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const client = connect();
  await client.connect();
  try {
    await handler(client, parseArgs(rest));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // On n'affiche que le message : une stack trace pourrait contenir la
  // chaîne de connexion complète.
  console.error(`Erreur : ${error.message}`);
  process.exitCode = 1;
});
