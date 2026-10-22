-- Permissions V1, lot A — étape 3/3 : propriété obligatoire, projets privés par défaut.
--
-- À appliquer APRÈS `scripts/backfill-owner.mjs` (étape 2), relancé application
-- arrêtée juste avant ce déploiement : voir `docs/permissions-v1.md`,
-- § « Déploiement du lot A ».
--
-- Garde-fou : la migration refuse de s'appliquer, AVANT toute modification,
-- s'il reste une fiche sans propriétaire ou un projet `WORKSPACE` — signe que
-- le backfill n'a pas tourné (ou pas depuis les dernières créations). Le
-- message nomme les tables concernées ; rien n'est modifié. Corriger :
-- `prisma migrate resolve --rolled-back 20261021100000_permissions_owner_required`,
-- relancer le backfill, puis redéployer.

DO $$
DECLARE
  missing text := '';
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'contacts', 'follow_ups', 'opportunities',
                           'privacy_treatments', 'privacy_processors', 'privacy_requests', 'privacy_incidents'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE owner_id IS NULL', t) INTO n;
    IF n > 0 THEN missing := missing || format(' %s=%s', t, n); END IF;
  END LOOP;
  SELECT count(*) INTO n FROM projects WHERE visibility = 'WORKSPACE';
  IF n > 0 THEN missing := missing || format(' projects(WORKSPACE)=%s', n); END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Permissions V1 : backfill incomplet, migration refusée sans modification.%', missing
      USING HINT = 'Lancer scripts/backfill-owner.mjs pour chaque espace, puis redéployer (voir docs/permissions-v1.md).';
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "follow_ups" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "opportunities" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "privacy_incidents" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "privacy_processors" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "privacy_requests" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "privacy_treatments" ALTER COLUMN "owner_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';
