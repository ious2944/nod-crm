#!/usr/bin/env bash
#
# NOD CRM — create a ready-to-use `.env`.
#
#   ./scripts/init-env.sh
#
# Copies `.env.example` and replaces the two placeholder secrets with values
# generated locally. It never overwrites an existing `.env`, never prints a
# secret, and never contacts anything.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

TEMPLATE=".env.example"
TARGET=".env"

[[ -f "$TEMPLATE" ]] || { echo "error: $TEMPLATE not found" >&2; exit 1; }

if [[ -e "$TARGET" ]]; then
  echo "$TARGET already exists — nothing was changed."
  echo "Delete it first if you really want to regenerate it (this logs everyone out)."
  exit 0
fi

command -v openssl >/dev/null || {
  echo "error: openssl is required to generate secrets" >&2
  exit 1
}

# Alphanumeric only for the database password: it also ends up inside a
# connection URL, where '/', '+' and '@' would need escaping.
DB_PASSWORD="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)"
AUTH_SECRET="$(openssl rand -base64 48)"

umask 077

# Rewritten line by line in pure bash: `sed` would need the generated secrets
# escaped, and base64 output contains `/` and `&` — exactly the characters that
# silently corrupt a substitution.
: > "$TARGET"
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    POSTGRES_PASSWORD=*)
      printf 'POSTGRES_PASSWORD=%s\n' "$DB_PASSWORD" >> "$TARGET" ;;
    AUTH_SECRET=*)
      printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET" >> "$TARGET" ;;
    DATABASE_URL=*)
      printf 'DATABASE_URL="postgresql://%s:%s@127.0.0.1:5432/%s?schema=public"\n' \
        "nodcrm" "$DB_PASSWORD" "nod_crm" >> "$TARGET" ;;
    *)
      printf '%s\n' "$line" >> "$TARGET" ;;
  esac
done < "$TEMPLATE"

chmod 600 "$TARGET"

echo "$TARGET created with freshly generated secrets (permissions 600)."
echo
echo "Next:"
echo "  docker compose up -d"
echo "  docker compose exec app node scripts/admin.mjs create-workspace"
echo "  docker compose exec app node scripts/admin.mjs create-user"
