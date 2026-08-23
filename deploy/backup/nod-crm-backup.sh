#!/usr/bin/env bash
#
# NOD CRM — PostgreSQL backup.
#
#   sudo /opt/nod-crm/deploy/backup/nod-crm-backup.sh
#
# Touches only the NOD CRM database. The password never appears in the script
# nor on a command line: it is read from the environment file, which should be
# readable by root only (`chmod 600 .env`).
#
# Everything is overridable, so the script fits an existing deployment instead
# of dictating one:
#
#   NOD_CRM_DIR           project directory        (default /opt/nod-crm)
#   NOD_CRM_ENV           environment file         (default $NOD_CRM_DIR/.env)
#   NOD_CRM_BACKUP_DIR    where dumps are written  (default /var/backups/nod-crm)
#   NOD_CRM_DB_CONTAINER  database container       (default nod-crm-postgres)
#   NOD_CRM_RETENTION_DAYS  delete dumps older than this  (default 30)
#   NOD_CRM_MIN_KEPT      never go below this many dumps  (default 7)
set -Eeuo pipefail

# ---------------------------------------------------------------- parameters
PROJECT_DIR="${NOD_CRM_DIR:-/opt/nod-crm}"
ENV_FILE="${NOD_CRM_ENV:-$PROJECT_DIR/.env}"
BACKUP_DIR="${NOD_CRM_BACKUP_DIR:-/var/backups/nod-crm}"
CONTAINER="${NOD_CRM_DB_CONTAINER:-nod-crm-postgres}"
RETENTION_DAYS="${NOD_CRM_RETENTION_DAYS:-30}"
# Safety net: never prune below this many backups. A multi-week outage must not
# quietly erase every copy.
MIN_KEPT="${NOD_CRM_MIN_KEPT:-7}"

log()  { printf '%s [nod-crm-backup] %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

trap 'fail "interrupted at line $LINENO"' ERR

# --------------------------------------------------------------------- checks
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
command -v docker >/dev/null || fail "docker not found"

# The secrets file is read WITHOUT `source`: `source` executes its content, and
# a password containing `$(…)` or a quote would be interpreted as shell — at
# best a mangled variable, at worst command execution. Each key is extracted
# literally instead.
read_env() {
  local key="$1" line
  line="$(grep -m1 -E "^[[:space:]]*${key}=" "$ENV_FILE" || true)"
  [[ -n "$line" ]] || return 1
  line="${line#*=}"
  # Strip optional surrounding quotes.
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

POSTGRES_USER="$(read_env POSTGRES_USER)" || fail "POSTGRES_USER missing from $ENV_FILE"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD)" || fail "POSTGRES_PASSWORD missing from $ENV_FILE"
POSTGRES_DB="$(read_env POSTGRES_DB)" || fail "POSTGRES_DB missing from $ENV_FILE"
[[ -n "$POSTGRES_PASSWORD" ]] || fail "POSTGRES_PASSWORD is empty in $ENV_FILE"

docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || fail "container $CONTAINER is not running"

# --------------------------------------------------------------------- backup
install -d -m 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/nod-crm-$STAMP.sql.gz"
TMP="$TARGET.partial"

log "dumping $POSTGRES_DB from $CONTAINER"

# The password travels as a container environment variable, not as an argument,
# so it never shows up in `ps`.
# `--clean --if-exists` makes the dump replayable onto a non-empty database.
if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" \
        pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
                --format=plain --clean --if-exists --no-owner --no-privileges \
     | gzip -9 > "$TMP"; then
  rm -f "$TMP"
  fail "pg_dump failed — no backup written"
fi

# `PIPESTATUS` does not survive the `if`, so the content is revalidated — which
# is the only proof that counts anyway.
if ! gzip -t "$TMP"; then
  rm -f "$TMP"
  fail "corrupt archive — backup rejected"
fi

# A valid dump necessarily contains the follow-ups table.
if ! zgrep -q "CREATE TABLE public.follow_ups" "$TMP"; then
  rm -f "$TMP"
  fail "incomplete dump: table follow_ups is missing"
fi

chmod 600 "$TMP"
mv "$TMP" "$TARGET"

SIZE="$(du -h "$TARGET" | cut -f1)"
log "backup complete: $TARGET ($SIZE)"

# ------------------------------------------------------------------- rotation
TOTAL="$(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-*.sql.gz' | wc -l)"
if (( TOTAL > MIN_KEPT )); then
  # Only the surplus above MIN_KEPT is deleted, and only if it is older than
  # the retention window.
  mapfile -t OLD < <(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-*.sql.gz' \
                       -mtime "+$RETENTION_DAYS" -printf '%T@ %p\n' | sort -n | cut -d' ' -f2-)
  ALLOWED=$(( TOTAL - MIN_KEPT ))
  REMOVED=0
  for file in "${OLD[@]:-}"; do
    [[ -n "$file" ]] || continue
    (( REMOVED < ALLOWED )) || break
    rm -f -- "$file"
    log "pruned: $(basename "$file")"
    REMOVED=$(( REMOVED + 1 ))
  done
  (( REMOVED > 0 )) && log "$REMOVED backup(s) pruned"
fi

log "$(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-*.sql.gz' | wc -l) backup(s) kept"
exit 0
