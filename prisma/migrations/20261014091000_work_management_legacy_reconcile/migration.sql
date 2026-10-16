-- V1.0 — Réconciliation des tâches historiques (migration corrective).
--
-- Pourquoi : la première version de `20261013120000_work_management` (celle
-- qui a pu être appliquée) déduisait le responsable — et parfois le créateur —
-- de l'auteur de l'audit `Task / CREATE` ou de l'unique utilisateur d'un
-- espace. Cette migration est restée telle quelle (les bases qui l'ont
-- appliquée gardent un historique valide) ; la correction est faite ici, pour
-- toutes les bases, quel que soit leur état de départ.
--
-- Idempotente : une seconde exécution ne change rien (aucun doublon, aucune
-- altération). Tout le traitement est un seul bloc, donc atomique.
--
-- Tâche historique : créée avant l'application de `20261013120000`
-- (`_prisma_migrations.finished_at`) et sans ligne de création V1.0. Sans
-- cette ligne d'historique Prisma (application manuelle), on retombe sur la
-- définition de `20261014090000` : aucune ligne `task_activities`.
--
-- Règles :
--   * Avant la V1.0, une tâche n'avait pas de responsable ; la V1.0 journalise
--     toute affectation (`task_activities.field = 'Responsable'`). Un
--     responsable présent sur une tâche historique sans cette ligne vient donc
--     du remplissage automatique.
--       - tâche jamais touchée depuis (ni historique ni commentaire) :
--         l'affectation est retirée (`ASSIGNEE_INFERRED_REVERTED`, ancienne
--         valeur dans `detail`) et la tâche signalée `ASSIGNEE_UNKNOWN` ;
--       - tâche utilisée depuis : cas ambigu, l'affectation est conservée et
--         signalée (`ASSIGNEE_INFERRED_KEPT`) pour vérification humaine.
--     Une affectation faite ou modifiée en V1.0 n'est jamais touchée.
--   * Créateur : seul l'auteur de l'audit `Task / CREATE` (encore présent dans
--     le même espace) est une donnée explicite. Un autre créateur sur une tâche
--     historique vient de la règle « unique utilisateur » : même traitement
--     (`CREATOR_INFERRED_REVERTED` / `CREATOR_INFERRED_KEPT`).
--   * Les signalements `*_UNKNOWN` posés à tort sur des tâches créées par la
--     V1.0 (sous-tâches copiées sans historique) sont retirés.

ALTER TABLE "task_migration_notes" ADD COLUMN IF NOT EXISTS "detail" TEXT;

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

  CREATE TEMP TABLE "legacy_tasks" ON COMMIT DROP AS
  SELECT
    t."id",
    t."workspace_id",
    t."assignee_id",
    t."created_by_id",
    (SELECT a."user_id"
       FROM "audit_logs" a
      WHERE a."entity_type" = 'Task' AND a."action" = 'CREATE' AND a."entity_id" = t."id"
      ORDER BY a."created_at"
      LIMIT 1) AS "audit_creator",
    EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id")
      OR EXISTS (SELECT 1 FROM "comments" c WHERE c."task_id" = t."id") AS "touched",
    EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id" AND ta."field" = 'Responsable') AS "assignee_changed"
  FROM "tasks" t
  WHERE CASE
    WHEN v1_at IS NULL THEN NOT EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id")
    ELSE t."created_at" < v1_at
     AND NOT EXISTS (
       SELECT 1 FROM "task_activities" ta
        WHERE ta."task_id" = t."id" AND ta."kind" IN ('created', 'duplicated', 'recurrence_created'))
  END;

  -- L'auteur d'audit n'est explicite que s'il existe encore dans le même espace.
  UPDATE "legacy_tasks" l SET "audit_creator" = NULL
  WHERE l."audit_creator" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = l."audit_creator" AND u."workspace_id" = l."workspace_id");

  -- 1. Responsables déduits.
  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason", "detail")
  SELECT l."id", l."workspace_id",
         CASE WHEN l."touched" THEN 'ASSIGNEE_INFERRED_KEPT' ELSE 'ASSIGNEE_INFERRED_REVERTED' END,
         l."assignee_id"::text
  FROM "legacy_tasks" l
  WHERE l."assignee_id" IS NOT NULL AND NOT l."assignee_changed"
  ON CONFLICT DO NOTHING;

  UPDATE "tasks" t SET "assignee_id" = NULL
  FROM "legacy_tasks" l
  WHERE t."id" = l."id" AND l."assignee_id" IS NOT NULL AND NOT l."assignee_changed" AND NOT l."touched";

  -- 2. Créateurs déduits (non justifiés par l'audit).
  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason", "detail")
  SELECT l."id", l."workspace_id",
         CASE WHEN l."touched" THEN 'CREATOR_INFERRED_KEPT' ELSE 'CREATOR_INFERRED_REVERTED' END,
         l."created_by_id"::text
  FROM "legacy_tasks" l
  WHERE l."created_by_id" IS NOT NULL AND l."created_by_id" IS DISTINCT FROM l."audit_creator"
  ON CONFLICT DO NOTHING;

  UPDATE "tasks" t SET "created_by_id" = NULL
  FROM "legacy_tasks" l
  WHERE t."id" = l."id" AND l."created_by_id" IS NOT NULL
    AND l."created_by_id" IS DISTINCT FROM l."audit_creator" AND NOT l."touched";

  -- 3. Créateurs explicites encore absents (tâches utilisées avant la migration 20261014090000).
  UPDATE "tasks" t SET "created_by_id" = l."audit_creator"
  FROM "legacy_tasks" l
  WHERE t."id" = l."id" AND t."created_by_id" IS NULL AND l."audit_creator" IS NOT NULL;

  -- 4. Signalements des informations manquantes (état final).
  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason")
  SELECT t."id", t."workspace_id", 'ASSIGNEE_UNKNOWN'
  FROM "tasks" t JOIN "legacy_tasks" l ON l."id" = t."id"
  WHERE t."assignee_id" IS NULL AND NOT l."assignee_changed"
  ON CONFLICT DO NOTHING;

  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason")
  SELECT t."id", t."workspace_id", 'CREATOR_UNKNOWN'
  FROM "tasks" t JOIN "legacy_tasks" l ON l."id" = t."id"
  WHERE t."created_by_id" IS NULL
  ON CONFLICT DO NOTHING;

  -- 5. Signalements posés à tort sur des tâches V1.0.
  IF v1_at IS NOT NULL THEN
    DELETE FROM "task_migration_notes" n
    WHERE n."reason" IN ('ASSIGNEE_UNKNOWN', 'CREATOR_UNKNOWN')
      AND NOT EXISTS (SELECT 1 FROM "legacy_tasks" l WHERE l."id" = n."task_id");
  END IF;
END $$;
