#!/usr/bin/env bash
#
# NOD CRM — PostgreSQL restore.
#
#   # Rehearsal on a throwaway database (safe):
#   sudo ./nod-crm-restore.sh --verify /var/backups/nod-crm/nod-crm-….sql.gz
#
#   # Real restore (destructive, requires --yes-i-am-sure):
#   sudo ./nod-crm-restore.sh --into-production /var/backups/… --yes-i-am-sure
#
# By default the script REFUSES to write to the production database: `--verify`
# restores into a disposable database and drops it afterwards.
#
# Overridable, like the backup script:
#   NOD_CRM_DIR / NOD_CRM_ENV / NOD_CRM_BACKUP_DIR
#   NOD_CRM_DB_CONTAINER   (default nod-crm-postgres)
#   NOD_CRM_APP_CONTAINER  (default nod-crm-app)
set -Eeuo pipefail

PROJECT_DIR="${NOD_CRM_DIR:-/opt/nod-crm}"
ENV_FILE="${NOD_CRM_ENV:-$PROJECT_DIR/.env}"
CONTAINER="${NOD_CRM_DB_CONTAINER:-nod-crm-postgres}"
APP_CONTAINER="${NOD_CRM_APP_CONTAINER:-nod-crm-app}"
BACKUP_DIR="${NOD_CRM_BACKUP_DIR:-/var/backups/nod-crm}"

MODE=""
ARCHIVE=""
CONFIRMED=0

log()  { printf '%s [nod-crm-restore] %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
Usage:
  nod-crm-restore.sh --verify [archive.sql.gz]
      Without an argument: verifies the most recent backup in
      /var/backups/nod-crm (or $NOD_CRM_BACKUP_DIR).

  nod-crm-restore.sh --into-production <archive.sql.gz> --yes-i-am-sure
      Destructive: the archive path is MANDATORY here.
USAGE
  exit 1
}

# `shift 2` is deliberately NOT used to consume an option's value: when the
# argument is missing it fails, and `set -e` aborts the script before `usage`
# ever writes anything. A backup check that exits silently is the worst possible
# behaviour for a tool you run precisely when something is already wrong.
take_value() {
  # $1 = option name (for the message), the rest = remaining arguments.
  local option="$1"; shift
  [[ $# -ge 1 && "${1:0:2}" != "--" ]] || return 1
  printf '%s' "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify)
      MODE=verify
      if ARCHIVE="$(take_value --verify "${@:2}")"; then shift 2; else shift; fi
      ;;
    --into-production)
      MODE=production
      ARCHIVE="$(take_value --into-production "${@:2}")" \
        || fail "--into-production requires the archive path."
      shift 2
      ;;
    --yes-i-am-sure)    CONFIRMED=1; shift ;;
    *)                  usage ;;
  esac
done

[[ -n "$MODE" ]] || usage

# In verify mode, no path means the most recent backup: that is the question
# you actually ask ("is the latest one restorable?").
if [[ -z "$ARCHIVE" ]]; then
  [[ -d "$BACKUP_DIR" ]] || fail "no backup directory: $BACKUP_DIR"
  ARCHIVE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-*.sql.gz' -type f \
             -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  [[ -n "$ARCHIVE" ]] || fail "no backup found in $BACKUP_DIR"
  log "no archive given — using the most recent: $ARCHIVE"
fi

[[ -f "$ARCHIVE" ]] || fail "archive not found: $ARCHIVE"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"

# Read secrets WITHOUT `source` — see nod-crm-backup.sh for why.
read_env() {
  local key="$1" line
  line="$(grep -m1 -E "^[[:space:]]*${key}=" "$ENV_FILE" || true)"
  [[ -n "$line" ]] || return 1
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

POSTGRES_USER="$(read_env POSTGRES_USER)" || fail "POSTGRES_USER missing from $ENV_FILE"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD)" || fail "POSTGRES_PASSWORD missing from $ENV_FILE"
POSTGRES_DB="$(read_env POSTGRES_DB)" || fail "POSTGRES_DB missing from $ENV_FILE"

log "checking the archive"
gzip -t "$ARCHIVE" || fail "corrupt archive"

psql_in() {
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
    psql --username "$POSTGRES_USER" --dbname "$1" -v ON_ERROR_STOP=1 "${@:2}"
}

if [[ "$MODE" == "verify" ]]; then
  TEMP_DB="nod_crm_restore_check_$(date -u +%Y%m%d%H%M%S)"
  log "rehearsal restore into temporary database $TEMP_DB"
  # `postgres` is the admin database: production is never touched.
  psql_in postgres -c "CREATE DATABASE \"$TEMP_DB\";" >/dev/null

  # Whatever happens next, the disposable database is dropped.
  trap 'log "cleaning up $TEMP_DB"; docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" psql --username "$POSTGRES_USER" --dbname postgres -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" >/dev/null 2>&1 || true' EXIT

  gunzip -c "$ARCHIVE" | psql_in "$TEMP_DB" >/dev/null

  log "restored content:"
  psql_in "$TEMP_DB" -At -c "
    SELECT '  ' || table_name || ' : ' ||
           (xpath('/row/c/text()',
                  query_to_xml('SELECT count(*) AS c FROM public.' || quote_ident(table_name),
                               false, true, '')))[1]::text || ' row(s)'
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;"

  # The schema must be complete, otherwise the backup is worthless.
  for table in workspaces users sessions contacts follow_ups; do
    psql_in "$TEMP_DB" -At -c "SELECT to_regclass('public.$table');" | grep -q "$table" \
      || fail "table missing from the backup: $table"
  done

  log "verification passed — the backup is restorable"
  exit 0
fi

# ---------------------------------------------------------- production mode
(( CONFIRMED == 1 )) || fail "production restore refused without --yes-i-am-sure"

log "WARNING: database $POSTGRES_DB is about to be overwritten."
SAFETY="$BACKUP_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
install -d -m 700 "$(dirname "$SAFETY")"
log "taking a safety backup first: $SAFETY"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
  pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
          --format=plain --clean --if-exists --no-owner --no-privileges \
  | gzip -9 > "$SAFETY"
chmod 600 "$SAFETY"
gzip -t "$SAFETY" || fail "the safety backup is corrupt — restore aborted"

log "stopping the application during the restore"
docker stop "$APP_CONTAINER" >/dev/null 2>&1 || log "application container already stopped"

log "restoring"
gunzip -c "$ARCHIVE" | psql_in "$POSTGRES_DB" >/dev/null

log "starting the application again"
docker start "$APP_CONTAINER" >/dev/null

log "restore complete. Safety backup: $SAFETY"
