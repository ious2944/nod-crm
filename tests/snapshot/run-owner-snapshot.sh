#!/usr/bin/env bash
# Permissions V1, lot A — non-régression de la propriétaire, de bout en bout.
#
#   SNAPSHOT_DATABASE_URL=postgresql://…/nod_snapshot tests/snapshot/run-owner-snapshot.sh [ref-avant]
#
# Rejoue, sur une base JETABLE (elle est vidée), le déploiement réel du lot A
# et compare ce que voit la propriétaire avant et après :
#
#   1. schéma et code d'avant le lot A (`ref-avant`, défaut : 3c83e86, la branche principale juste avant le lot A),
#      jeu de données hérité (`legacy-seed.sql`), instantané « avant » ;
#   2. code du lot A : `prisma migrate deploy` — la migration 2 doit refuser
#      (backfill non fait), puis `migrate resolve --rolled-back` ;
#   3. backfill : `--dry-run`, exécution, seconde exécution (idempotence) ;
#   4. `prisma migrate deploy` — passe ; instantané « après » ;
#   5. comparaison : identique, hors différences attendues listées plus bas.
#
# Code de sortie 0 si tout est conforme.
set -euo pipefail

URL="${SNAPSHOT_DATABASE_URL:?SNAPSHOT_DATABASE_URL est obligatoire (base jetable)}"
# Dernier commit de la branche principale avant le lot A (lot 0 compris).
BEFORE_REF="${1:-3c83e86}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
OWNER_EMAIL="proprietaire@acme.fr"
WORKSPACE_ID="a0000000-0000-4000-8000-000000000001"
trap 'git -C "$ROOT" worktree remove --force "$WORK/avant" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

echo "▸ Base jetable remise à zéro"
psql "$URL" -qc 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null

echo "▸ Avant : schéma et code de $BEFORE_REF"
git -C "$ROOT" worktree add --detach "$WORK/avant" "$BEFORE_REF" >/dev/null
ln -s "$ROOT/node_modules" "$WORK/avant/node_modules"
mkdir -p "$WORK/avant/tests/snapshot"
cp "$ROOT/tests/snapshot/owner-view.dump.ts" "$ROOT/tests/snapshot/vitest.snapshot.config.mts" "$WORK/avant/tests/snapshot/"
(cd "$WORK/avant" && DATABASE_URL="$URL" npx prisma migrate deploy >/dev/null && npx prisma generate >/dev/null)
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/snapshot/legacy-seed.sql"
(cd "$WORK/avant" && TEST_DATABASE_URL="$URL" SNAPSHOT_OUT="$WORK/avant.json" npx vitest run --config tests/snapshot/vitest.snapshot.config.mts >/dev/null)

echo "▸ Après : code du lot A — la migration 2 doit refuser tant que le backfill n'a pas tourné"
cd "$ROOT"
npx prisma generate >/dev/null
if DATABASE_URL="$URL" npx prisma migrate deploy >"$WORK/deploy1.log" 2>&1; then
  echo "✗ La migration 2 aurait dû refuser une base non attribuée." && exit 1
fi
grep -q "backfill incomplet, migration refusée sans modification" "$WORK/deploy1.log" || { cat "$WORK/deploy1.log"; exit 1; }
echo "  refus attendu : $(grep -o 'backfill incomplet[^"]*' "$WORK/deploy1.log" | head -1)"
DATABASE_URL="$URL" npx prisma migrate resolve --rolled-back 20261021100000_permissions_owner_required >/dev/null

echo "▸ Backfill (dry-run, puis exécution, puis relance)"
DATABASE_URL="$URL" node scripts/backfill-owner.mjs --workspace "$WORKSPACE_ID" --owner "$OWNER_EMAIL" --e2e-user e2e@nod-crm.test --dry-run | tee "$WORK/dry-run.txt"
DATABASE_URL="$URL" node scripts/backfill-owner.mjs --workspace "$WORKSPACE_ID" --owner "$OWNER_EMAIL" --e2e-user e2e@nod-crm.test >"$WORK/run1.txt"
DATABASE_URL="$URL" node scripts/backfill-owner.mjs --workspace "$WORKSPACE_ID" --owner "$OWNER_EMAIL" --e2e-user e2e@nod-crm.test >"$WORK/run2.txt"
# Idempotence : la seconde exécution n'écrit rien (toutes les lignes chiffrées à 0).
if grep -E '^\s{2}.*\s[1-9][0-9]*$' "$WORK/run2.txt" | grep -v "Accès perdus" | grep -vq "non préservables"; then
  echo "✗ La seconde exécution du backfill a écrit :" && cat "$WORK/run2.txt" && exit 1
fi
diff <(grep -v "^Mode" "$WORK/dry-run.txt") <(grep -v "^Mode" "$WORK/run1.txt") >/dev/null || { echo "✗ Le dry-run n'annonce pas ce qu'a fait l'exécution."; exit 1; }

DATABASE_URL="$URL" npx prisma migrate deploy >/dev/null
TEST_DATABASE_URL="$URL" SNAPSHOT_OUT="$WORK/apres.json" npx vitest run --config tests/snapshot/vitest.snapshot.config.mts >/dev/null

echo "▸ Comparaison"
node - "$WORK/avant.json" "$WORK/apres.json" <<'NODE'
const fs = require("node:fs");
const [before, after] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));

// Différences attendues, chacune justifiée (docs/permissions-v1.md, § Lot A).
const P2 = "a0000000-0000-4000-8000-000000000602";
const P5 = "a0000000-0000-4000-8000-000000000605";
const OWNER = "a0000000-0000-4000-8000-000000000010";
const projectAt = (path) => before.projects[Number(/^projects\[(\d+)\]/.exec(path)?.[1])]?.id;
const ALLOWED = [
  // (f) tous les projets passent en PRIVATE.
  [/^projects\[\d+\]\.visibility$/, "visibilité WORKSPACE → PRIVATE (décision f)"],
  // (f) un projet doit avoir un propriétaire : le projet hérité qui n'en avait aucun devient le sien.
  [(d) => /^projects\[\d+\]\.canManage$/.test(d.path) && projectAt(d.path) === P5 && d.before === false && d.after === true,
    "projet hérité sans propriétaire : il lui est attribué (ownerId obligatoire)"],
  // (b) annuaire : soi et les co-membres — l'annuaire ne peut que se réduire.
  [(d) => d.path === "context.users" && d.after.every((id) => d.before.includes(id)),
    "annuaire réduit à soi et aux co-membres (décision b)"],
  // Projet « espace » d'une autre personne : elle en devient membre EDITOR, exactement son droit d'avant.
  [new RegExp(`^bundles\\.${P2}\\.members`), "adhésion EDITOR ajoutée sur un projet « espace » qu'elle ne possédait pas"],
  // Règles d'espace sans auteur / d'un auteur inactif : elles ne s'exécutaient pas ; reprises par elle, désactivées.
  [/^settings\.[^.]+\.rules\[\d+\]\.isEnabled$/, "règle d'espace dormante (auteur absent ou inactif) reprise et désactivée"],
  // Tâches libres d'une autre personne : elle en devient collaboratrice (mêmes droits, et désormais l'accès).
  [/^taskDetails\.[^.]+\.followers/, `collaboratrice ajoutée (${OWNER}) sur les tâches libres d'une autre personne`],
];

const diffs = [];
(function walk(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path ? `${path}.${key}` : key);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => x && typeof x === "object")) {
    a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
    return;
  }
  diffs.push({ path, before: a, after: b });
})(before, after, "");

let unexpected = 0;
for (const d of diffs) {
  const rule = ALLOWED.find(([test]) => (typeof test === "function" ? test(d) : test.test(d.path)));
  console.log(`${rule ? "  attendu  " : "✗ INATTENDU"} ${d.path} : ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}${rule ? `  (${rule[1]})` : ""}`);
  if (!rule) unexpected += 1;
}
console.log(diffs.length === 0 ? "  aucune différence" : `  ${diffs.length} différence(s), dont ${unexpected} inattendue(s)`);
process.exit(unexpected ? 1 : 0);
NODE
echo "✓ La propriétaire voit et peut faire la même chose qu'avant le lot A."
