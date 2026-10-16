-- V1.0 — Affectations retirées sans origine établie : restauration
-- (migration corrective de `20261014091000_work_management_legacy_reconcile`).
--
-- Pourquoi : sans ligne `_prisma_migrations` pour `20261013120000` (migration
-- appliquée à la main), `20261014091000` ne peut pas dater la V1.0 ; elle
-- tient alors pour « historique » toute tâche sans ligne `task_activities`.
-- Or la V1.0 crée aussi des tâches sans historique (sous-tâches copiées par
-- une duplication ou une récurrence) : leurs responsables et créateurs
-- légitimes étaient retirés. Plus généralement, sans date de référence,
-- l'origine d'une affectation ne peut pas être établie : elle ne doit pas
-- être annulée.
--
-- `20261014091000` reste inchangée (des bases l'ont appliquée). Cette
-- migration remet les valeurs retirées **sans origine établie**, à partir de
-- l'ancienne valeur conservée dans `task_migration_notes.detail` :
--   * sans historique Prisma de `20261013120000` : tous les retraits ;
--   * avec cet historique : les retraits portant sur des tâches créées après
--     son application (impossibles par le chemin normal ; possibles si
--     `20261014091000` a d'abord tourné sans historique).
-- Une valeur n'est remise que si le champ est encore vide (une affectation
-- faite depuis l'emporte) et si l'utilisateur existe encore dans le même
-- espace. Le signalement devient `ASSIGNEE_ORIGIN_UNKNOWN` /
-- `CREATOR_ORIGIN_UNKNOWN` (valeur conservée, à vérifier), et le signalement
-- `*_UNKNOWN` de la tâche, devenu faux, est retiré. Rien d'autre n'est
-- modifié. Idempotente.

DO $$
DECLARE
  v1_at timestamp;
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    SELECT min("finished_at") AT TIME ZONE 'UTC' INTO v1_at
    FROM "_prisma_migrations"
    WHERE "migration_name" = '20261013120000_work_management'
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;
  END IF;

  CREATE TEMP TABLE "unestablished_reverts" ON COMMIT DROP AS
  SELECT n."task_id", n."reason",
         CASE WHEN n."detail" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN n."detail"::uuid END AS "value",
         t."workspace_id"
  FROM "task_migration_notes" n
  JOIN "tasks" t ON t."id" = n."task_id"
  WHERE n."reason" IN ('ASSIGNEE_INFERRED_REVERTED', 'CREATOR_INFERRED_REVERTED')
    AND (v1_at IS NULL OR t."created_at" >= v1_at);

  -- Responsables.
  UPDATE "tasks" t SET "assignee_id" = r."value"
  FROM "unestablished_reverts" r
  WHERE t."id" = r."task_id" AND r."reason" = 'ASSIGNEE_INFERRED_REVERTED'
    AND t."assignee_id" IS NULL AND r."value" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = r."value" AND u."workspace_id" = t."workspace_id");

  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason", "detail")
  SELECT r."task_id", r."workspace_id", 'ASSIGNEE_ORIGIN_UNKNOWN', r."value"::text
  FROM "unestablished_reverts" r JOIN "tasks" t ON t."id" = r."task_id"
  WHERE r."reason" = 'ASSIGNEE_INFERRED_REVERTED' AND t."assignee_id" = r."value"
  ON CONFLICT DO NOTHING;

  DELETE FROM "task_migration_notes" n
  USING "unestablished_reverts" r, "tasks" t
  WHERE n."task_id" = r."task_id" AND t."id" = r."task_id"
    AND r."reason" = 'ASSIGNEE_INFERRED_REVERTED' AND t."assignee_id" = r."value"
    AND n."reason" IN ('ASSIGNEE_INFERRED_REVERTED', 'ASSIGNEE_UNKNOWN');

  -- Créateurs.
  UPDATE "tasks" t SET "created_by_id" = r."value"
  FROM "unestablished_reverts" r
  WHERE t."id" = r."task_id" AND r."reason" = 'CREATOR_INFERRED_REVERTED'
    AND t."created_by_id" IS NULL AND r."value" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = r."value" AND u."workspace_id" = t."workspace_id");

  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason", "detail")
  SELECT r."task_id", r."workspace_id", 'CREATOR_ORIGIN_UNKNOWN', r."value"::text
  FROM "unestablished_reverts" r JOIN "tasks" t ON t."id" = r."task_id"
  WHERE r."reason" = 'CREATOR_INFERRED_REVERTED' AND t."created_by_id" = r."value"
  ON CONFLICT DO NOTHING;

  DELETE FROM "task_migration_notes" n
  USING "unestablished_reverts" r, "tasks" t
  WHERE n."task_id" = r."task_id" AND t."id" = r."task_id"
    AND r."reason" = 'CREATOR_INFERRED_REVERTED' AND t."created_by_id" = r."value"
    AND n."reason" IN ('CREATOR_INFERRED_REVERTED', 'CREATOR_UNKNOWN');

  DROP TABLE "unestablished_reverts";
END $$;
