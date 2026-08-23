# Database

PostgreSQL 16, accessed through Prisma 7 with the `@prisma/adapter-pg` driver
adapter.

## Schema

Six tables. Everything business-related hangs off a workspace.

```
workspaces ──┬── users ──── sessions
             ├── contacts ──┐
             └── follow_ups ┘   (contact_id, nullable)

login_attempts                  (standalone, rate limiting)
```

| Table | Holds |
| --- | --- |
| `workspaces` | slug (unique), name |
| `users` | email (unique), Argon2id hash, display name, active flag, last login, `workspace_id` |
| `sessions` | token **HMAC** (unique), absolute expiry, idle expiry, last used, revoked, user agent, IP **hash** |
| `login_attempts` | scope (`email:…` or `ip:<fingerprint>`), success flag, timestamp |
| `contacts` | first name, last name, optional email and organisation, `is_demo`, `workspace_id` |
| `follow_ups` | title, description, status, ball owner, due date, nudge count, last nudge, completed at, `is_demo`, `workspace_id`, optional `contact_id` |

Everything is a UUID primary key, `snake_case` in the database, `camelCase` in
the Prisma client, with `created_at` / `updated_at` on the business tables.

### What is deliberately not stored

- **No plaintext session token.** Only `HMAC-SHA256(token, AUTH_SECRET)`. A
  database dump alone cannot be turned into a valid cookie.
- **No plaintext IP address**, anywhere. `sessions.ip_hash` and the
  `login_attempts` scope both hold fingerprints. The trade-off is that you
  cannot ban an address from application data — that is the reverse proxy's
  job, and it sees the real ones.
- **No password**, obviously, and no password history.

### Indexes

Each one earns its place:

| Index | Why |
| --- | --- |
| `contacts (workspace_id, first_name, last_name)` | matches `listContacts`'s sort exactly, so PostgreSQL walks the index instead of sorting in memory |
| `follow_ups (workspace_id, status, due_at)` | the board's only query: open items of one workspace, sorted by due date |
| `follow_ups (contact_id)` | resolves the contact relation |
| `sessions (user_id)`, `sessions (expires_at)` | session lookup and expiry sweeps |
| `login_attempts (scope, created_at)` | the rate-limit counter, which runs on every login attempt |
| `users (workspace_id)` | membership lookups |

### Deletion behaviour

| Relation | On delete |
| --- | --- |
| `workspace` → `users`, `contacts`, `follow_ups` | `CASCADE` — deleting a workspace removes everything in it |
| `user` → `sessions` | `CASCADE` — deleting a user logs them out everywhere |
| `contact` → `follow_ups` | `SET NULL` — deleting a contact keeps the follow-up, unlinked |

That last one is deliberate. A follow-up records something you were waiting
for; losing it because a contact was tidied away would be data loss disguised
as cleanup.

## Migrations

Versioned SQL under `prisma/migrations/`, applied in order.

```bash
npm run db:migrate      # development: creates and applies a migration
npm run db:deploy       # production:  applies pending migrations only
```

In the Docker stack this is automatic: a `migrate` service runs
`prisma migrate deploy` and the application waits for it to succeed. A failed
migration means the new application never starts, which is the correct outcome.

`migrate dev` is never run against production. It can reset the database.

### Writing a migration

- **Additive by default.** Adding a nullable column or a table is safe.
- **Dropping or renaming a column is a breaking change.** People run this in
  production. Discuss it in an issue first, ship it in two steps (add and
  backfill, then remove in a later release), and say so loudly in the
  changelog.
- **Backfill in the migration**, not in application code that "will run once".
- Test the rollback path, or state clearly that there is none.

### Current migrations

| Migration | Effect |
| --- | --- |
| `20260822061131_init` | workspaces, contacts, follow_ups |
| `20260822110939_add_auth_users_sessions` | users, sessions, login_attempts |
| `20260822122616_align_contacts_index` | contacts index aligned with the query's sort |

All three are additive. None destroys data.

## Demo data

```bash
npm run db:seed
```

Four fictional contacts (Alice Martin / Acme Corp, Bob Dupont / Example
Company…) and seven follow-ups, every row flagged `is_demo` and badged in the
interface. Re-running deletes the previous demo rows and recreates them; real
rows are never touched.

The seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1`
is set, and it creates no user account. Accounts only ever come from the admin
CLI.

## Volume and pagination

`getFollowUpBoard` loads **every** open follow-up in the workspace, without
pagination. That is a known limit, not an oversight:

| Open follow-ups | Effect |
| --- | --- |
| < 200 | imperceptible |
| 200 – 1,000 | heavier page, still comfortable |
| 1,000 – 2,000 | noticeably slower first render |
| > 2,000 | pagination needed |

The completed list is already capped at 100 rows. The
`(workspace_id, status, due_at)` index already covers the ordering, so adding
`take`/`skip` when it matters is mechanical.

For a "who owes me what" tool, passing a few hundred open items usually means
follow-ups are not being closed rather than that the tool is too small.

## Collation

The database is initialised with `--locale=C`, which makes dumps and restores
deterministic. The side effect is byte-order sorting: "Émile" sorts after
"Zoé".

This is fixable **without reinitialising the database** — ICU collations are
available in the image, so an `ALTER TABLE … COLLATE "fr-FR-x-icu"` will do it
the day a contact list is long enough for the ordering to matter.

## Direct access

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

No port is published, so this is the only way in — which is intended. See
[backup-restore.md](backup-restore.md) for dumps.
