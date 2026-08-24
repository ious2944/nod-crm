#!/usr/bin/env bash
#
# NOD CRM — PostgreSQL and contact-photo backup.
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
#   NOD_CRM_APP_CONTAINER application container    (default nod-crm-app)
#   NOD_CRM_UPLOAD_DIR    uploads path in the app container (default /app/var/uploads)
#   NOD_CRM_SKIP_UPLOADS  set to 1 to back up the database only
#   NOD_CRM_RETENTION_DAYS  delete dumps older than this  (default 30)
#   NOD_CRM_MIN_KEPT      never go below this many dumps  (default 7)
#
# Since V0.2 the database is no longer the whole story: contact photos are
# files on the `nod-crm-uploads-data` volume, and the rows reference them. A
# dump restored without them leaves contacts pointing at photos that are gone —
# so this script writes TWO archives per run, sharing one timestamp, and they
# must be restored together.
set -Eeuo pipefail

# ---------------------------------------------------------------- parameters
PROJECT_DIR="${NOD_CRM_DIR:-/opt/nod-crm}"
ENV_FILE="${NOD_CRM_ENV:-$PROJECT_DIR/.env}"
BACKUP_DIR="${NOD_CRM_BACKUP_DIR:-/var/backups/nod-crm}"
CONTAINER="${NOD_CRM_DB_CONTAINER:-nod-crm-postgres}"
APP_CONTAINER="${NOD_CRM_APP_CONTAINER:-nod-crm-app}"
UPLOAD_DIR="${NOD_CRM_UPLOAD_DIR:-/app/var/uploads}"
SKIP_UPLOADS="${NOD_CRM_SKIP_UPLOADS:-0}"
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
log "database backup complete: $TARGET ($SIZE)"

# ------------------------------------------------------------ contact photos
#
# The archive is taken from inside the running application container, which
# already has the volume mounted: no image to pull, nothing to resolve, and it
# works the same whether the volume is named, bind-mounted or something else
# entirely.
#
# The failure policy mirrors the dump's, and for the same reason: a backup that
# silently covers half the data is worse than one that stops and says so. The
# ONE tolerated case is a deployment that predates V0.2 and has no uploads
# directory yet — that is logged, not failed.
UPLOADS_TARGET="$BACKUP_DIR/nod-crm-uploads-$STAMP.tar.gz"

if [[ "$SKIP_UPLOADS" == "1" ]]; then
  log "uploads backup skipped (NOD_CRM_SKIP_UPLOADS=1) — photos are NOT in this backup"
elif ! docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null | grep -q true; then
  fail "container $APP_CONTAINER is not running — cannot back up contact photos.
       Start it, or set NOD_CRM_SKIP_UPLOADS=1 to accept a database-only backup."
elif ! docker exec "$APP_CONTAINER" test -d "$UPLOAD_DIR" 2>/dev/null; then
  # No uploads directory: a pre-V0.2 deployment, or one that has never been
  # given the volume. Nothing to save, and nothing to be alarmed about.
  log "no uploads directory at $UPLOAD_DIR in $APP_CONTAINER — nothing to archive"
else
  UPLOADS_TMP="$UPLOADS_TARGET.partial"
  log "archiving contact photos from $APP_CONTAINER:$UPLOAD_DIR"

  if ! docker exec "$APP_CONTAINER" tar -cf - -C "$UPLOAD_DIR" . | gzip -9 > "$UPLOADS_TMP"; then
    rm -f "$UPLOADS_TMP"
    fail "tar failed — no uploads archive written"
  fi

  if ! gzip -t "$UPLOADS_TMP"; then
    rm -f "$UPLOADS_TMP"
    fail "corrupt uploads archive — rejected"
  fi

  chmod 600 "$UPLOADS_TMP"
  mv "$UPLOADS_TMP" "$UPLOADS_TARGET"
  log "photo backup complete: $UPLOADS_TARGET ($(du -h "$UPLOADS_TARGET" | cut -f1))"
fi

# ------------------------------------------------------------------- rotation
# The two archive families are rotated independently but with the same policy.
# Sharing one timestamp keeps a dump and its photos aligned, and pruning them
# under identical rules keeps them aligned as they age out.
prune() {
  local pattern="$1" total allowed removed=0
  total="$(find "$BACKUP_DIR" -maxdepth 1 -name "$pattern" | wc -l)"
  (( total > MIN_KEPT )) || return 0

  # Only the surplus above MIN_KEPT is deleted, and only if it is older than
  # the retention window.
  mapfile -t OLD < <(find "$BACKUP_DIR" -maxdepth 1 -name "$pattern" \
                       -mtime "+$RETENTION_DAYS" -printf '%T@ %p\n' | sort -n | cut -d' ' -f2-)
  allowed=$(( total - MIN_KEPT ))
  for file in "${OLD[@]:-}"; do
    [[ -n "$file" ]] || continue
    (( removed < allowed )) || break
    rm -f -- "$file"
    log "pruned: $(basename "$file")"
    removed=$(( removed + 1 ))
  done
  (( removed > 0 )) && log "$removed archive(s) pruned"
  return 0
}

prune 'nod-crm-*.sql.gz'
prune 'nod-crm-uploads-*.tar.gz'

# Both counts, deliberately: an operator glancing at the log must be able to
# see that the photos are covered too, not just the database.
log "$(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-*.sql.gz' | wc -l) database backup(s) and \
$(find "$BACKUP_DIR" -maxdepth 1 -name 'nod-crm-uploads-*.tar.gz' | wc -l) photo archive(s) kept"
exit 0
