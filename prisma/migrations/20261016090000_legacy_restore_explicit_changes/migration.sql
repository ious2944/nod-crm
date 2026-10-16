-- V1.0 — Restaurations contredites par une modification explicite
-- (migration corrective de `20261015090000_legacy_reconcile_unestablished_restore`).
--
-- Pourquoi : `20261015090000` remet un responsable retiré par
-- `20261014091000` dès que le champ est vide. Or un champ vide peut être un
-- choix explicite : entre les deux migrations, quelqu'un a pu affecter la tâche
-- puis retirer l'affectation (lignes d'historique `field = 'Responsable'`).
-- La restauration a alors rétabli une ancienne valeur contre ce choix.
--
-- `20261015090000` reste inchangée (des bases l'ont appliquée). Cette
-- migration revient sur ses restaurations **seulement** quand :
--   * la valeur actuelle est encore exactement celle qu'elle a remise
--     (`task_migration_notes.detail` du signalement `*_ORIGIN_UNKNOWN`) ;
--   * une modification explicite du champ est antérieure à cette restauration ;
--   * aucune modification explicite n'est postérieure (sinon la valeur
--     actuelle est un choix récent : elle est conservée).
-- Le champ redevient vide, comme l'avait laissé la personne, et le cas est
-- signalé `ASSIGNEE_RESTORE_UNDONE` (valeur écartée dans `detail`). Dans le
-- doute, rien n'est modifié.
--
-- Créateur : la V1.0 ne permet pas de le modifier ; aucune modification
-- explicite ne peut donc contredire sa restauration. Par prudence, la même
-- règle s'applique à toute ligne d'historique qui le concernerait
-- (`field = 'Créateur'`), et rien d'autre n'est touché.
--
-- Idempotente : une seconde exécution ne trouve plus de signalement
-- `*_ORIGIN_UNKNOWN` correspondant.

DO $$
BEGIN
  CREATE TEMP TABLE "restore_conflicts" ON COMMIT DROP AS
  SELECT n."task_id", n."reason", n."detail", t."workspace_id",
         CASE n."reason" WHEN 'ASSIGNEE_ORIGIN_UNKNOWN' THEN 'Responsable' ELSE 'Créateur' END AS "field"
  FROM "task_migration_notes" n
  JOIN "tasks" t ON t."id" = n."task_id"
  WHERE n."reason" IN ('ASSIGNEE_ORIGIN_UNKNOWN', 'CREATOR_ORIGIN_UNKNOWN')
    AND n."detail" IS NOT NULL
    AND (CASE n."reason" WHEN 'ASSIGNEE_ORIGIN_UNKNOWN' THEN t."assignee_id" ELSE t."created_by_id" END)::text = n."detail"
    AND EXISTS (
      SELECT 1 FROM "task_activities" a
       WHERE a."task_id" = n."task_id"
         AND a."field" = CASE n."reason" WHEN 'ASSIGNEE_ORIGIN_UNKNOWN' THEN 'Responsable' ELSE 'Créateur' END
         AND a."created_at" < n."created_at")
    AND NOT EXISTS (
      SELECT 1 FROM "task_activities" a
       WHERE a."task_id" = n."task_id"
         AND a."field" = CASE n."reason" WHEN 'ASSIGNEE_ORIGIN_UNKNOWN' THEN 'Responsable' ELSE 'Créateur' END
         AND a."created_at" >= n."created_at");

  UPDATE "tasks" t SET "assignee_id" = NULL
  FROM "restore_conflicts" c
  WHERE t."id" = c."task_id" AND c."reason" = 'ASSIGNEE_ORIGIN_UNKNOWN' AND t."assignee_id"::text = c."detail";

  UPDATE "tasks" t SET "created_by_id" = NULL
  FROM "restore_conflicts" c
  WHERE t."id" = c."task_id" AND c."reason" = 'CREATOR_ORIGIN_UNKNOWN' AND t."created_by_id"::text = c."detail";

  INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason", "detail")
  SELECT c."task_id", c."workspace_id",
         CASE c."reason" WHEN 'ASSIGNEE_ORIGIN_UNKNOWN' THEN 'ASSIGNEE_RESTORE_UNDONE' ELSE 'CREATOR_RESTORE_UNDONE' END,
         c."detail"
  FROM "restore_conflicts" c
  ON CONFLICT DO NOTHING;

  DELETE FROM "task_migration_notes" n
  USING "restore_conflicts" c
  WHERE n."task_id" = c."task_id" AND n."reason" = c."reason";

  DROP TABLE "restore_conflicts";
END $$;
