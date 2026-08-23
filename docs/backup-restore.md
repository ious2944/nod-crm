# Backup and restore

Two scripts, in [`deploy/backup/`](../deploy/backup/). They only ever touch the
NOD CRM database.

| | |
| --- | --- |
| Tool | `pg_dump`, plain format, `--clean --if-exists` |
| Location | `/var/backups/nod-crm/` (directory `700`, archives `600`) |
| Naming | `nod-crm-<YYYYMMDD>T<HHMMSS>Z.sql.gz` (UTC) |
| Retention | 30 days, never dropping below 7 archives |
| Compression | `gzip -9` |

Everything is overridable through the environment, so the scripts fit your
layout instead of dictating one: `NOD_CRM_DIR`, `NOD_CRM_ENV`,
`NOD_CRM_BACKUP_DIR`, `NOD_CRM_DB_CONTAINER`, `NOD_CRM_APP_CONTAINER`,
`NOD_CRM_RETENTION_DAYS`, `NOD_CRM_MIN_KEPT`.

## Taking a backup

```bash
sudo ./deploy/backup/nod-crm-backup.sh
```

The script aborts — **without leaving a partial archive** — if:

- the environment file is missing or incomplete;
- the PostgreSQL container is not running;
- `pg_dump` fails;
- the gzip archive does not verify;
- the dump does not contain `CREATE TABLE public.follow_ups`.

That last check is the useful one. It catches a syntactically valid but empty
dump, which passes every other test and is exactly the backup you discover is
worthless on the day you need it.

Writing goes to a `.partial` file that is renamed only after validation: an
archive present in the directory is an archive that was verified.

The database password is read from the environment file and passed to the
container as an environment variable, never as a command-line argument — so it
never appears in `ps`. The file is parsed literally rather than with `source`,
because `source` executes its content: a password containing `$(…)` would be
run as a shell command.

## Automating it

```cron
17 3 * * * root /opt/nod-crm/deploy/backup/nod-crm-backup.sh >> /var/log/nod-crm-backup.log 2>&1
```

Pick an odd minute rather than `0 3 * * *`, so you are not competing with every
other cron job on the machine.

Rotation keeps at least 7 archives regardless of age. A multi-week outage of
the backup job cannot silently erase every copy you have.

## Verifying a backup

**A backup you have never restored is a hypothesis, not a backup.**

```bash
sudo ./deploy/backup/nod-crm-restore.sh --verify
```

With no argument it takes the most recent archive — which is the question you
actually want answered. It then:

1. checks the gzip integrity;
2. creates a **temporary** database;
3. restores the archive into it;
4. prints the row count of every table;
5. checks that `workspaces`, `users`, `sessions`, `contacts` and `follow_ups`
   all exist;
6. drops the temporary database, whatever happened.

Production is never touched. Run it monthly, and after any change to the
database or the backup setup.

## Restoring into production

Destructive. The command is deliberately awkward to type.

```bash
# 1. Always verify the archive first.
sudo ./deploy/backup/nod-crm-restore.sh --verify /var/backups/nod-crm/nod-crm-….sql.gz

# 2. Then restore.
sudo ./deploy/backup/nod-crm-restore.sh \
     --into-production /var/backups/nod-crm/nod-crm-….sql.gz \
     --yes-i-am-sure
```

The script takes its own safety backup of the current state *before* touching
anything, verifies that safety archive, stops the application container,
restores, and starts it again.

Everyone is logged out afterwards: the `sessions` table is restored to the
state captured in the archive, so current sessions no longer exist. That is
expected — sign in again.

## Restoring somewhere else

To spin up a copy on another machine — for a test, or a migration:

```bash
git clone https://github.com/ious2944/nod-crm.git && cd nod-crm
./scripts/init-env.sh
docker compose up -d postgres
gunzip -c nod-crm-….sql.gz | \
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose up -d
```

Note that a restored copy carries the *original* password hashes and sessions,
but `AUTH_SECRET` on the new machine is different — so every restored session
is already invalid. Passwords still work. That is the correct behaviour: a
copy of your database on another host should not inherit live sessions.

## What backups do not cover

- **`.env`.** It holds `AUTH_SECRET` and the database password, and it is not
  in the dump and not in Git. Copy it into a password manager. Without it you
  can restore the data but not start the stack.
- **The Docker image.** Rebuilt from the repository; nothing to back up.
- **Uploaded files.** There are none — NOD CRM stores no files.

## Residual risk

Backups written by these scripts live **on the same host as the database**. A
disk or host failure takes both. Copying them off-site is left to you because
the right destination is yours to pick:

```bash
# Example — adapt to your destination.
rsync -a --chmod=600 /var/backups/nod-crm/ backup-host:/srv/backups/nod-crm/
```

Whatever you choose, verify a restore from *that* copy at least once. An
off-site backup nobody has ever restored has the same value as no backup.
