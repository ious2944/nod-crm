-- V1.0 — Historique : référence vers la tâche citée.
--
-- Une ligne d'historique peut citer une autre tâche : dépendance (« Bloquée
-- par … ») ou source d'une copie (« Dupliquée depuis … »). Son titre était
-- écrit en clair dans `new_value` / `old_value` et montré à toute personne qui
-- lit la tâche, même sans pouvoir lire la tâche citée (projet privé).
-- `ref_task_id` désigne désormais la tâche citée : le titre n'est montré
-- qu'aux personnes qui peuvent la lire (voir `getTaskDetail`).
--
-- Anciennes lignes : rien n'est supprimé. La référence est retrouvée quand
-- elle est **certaine** — d'abord parmi les dépendances actuelles de la
-- tâche, puis parmi les tâches de l'espace portant exactement ce titre —, et
-- seulement si une seule tâche correspond. Sinon elle reste vide et la valeur
-- est masquée à la lecture (la ligne reste visible).

ALTER TABLE "task_activities" ADD COLUMN IF NOT EXISTS "ref_task_id" UUID;

CREATE INDEX IF NOT EXISTS "task_activities_ref_task_id_idx" ON "task_activities"("ref_task_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'task_activities_ref_task_id_fkey' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_ref_task_id_fkey" FOREIGN KEY ("ref_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 1. Dépendances : parmi les tâches liées (actuellement) à la tâche, par titre exact.
UPDATE "task_activities" a SET "ref_task_id" = m."ref"
FROM (
  SELECT a2."id", min(d."blocking_id"::text)::uuid AS "ref", count(*) AS "n"
  FROM "task_activities" a2
  JOIN "task_dependencies" d ON d."blocked_id" = a2."task_id"
  JOIN "tasks" b ON b."id" = d."blocking_id" AND b."title" = coalesce(a2."new_value", a2."old_value")
  WHERE a2."kind" IN ('dependency_added', 'dependency_removed') AND a2."ref_task_id" IS NULL
  GROUP BY a2."id"
) m
WHERE a."id" = m."id" AND m."n" = 1;

-- 2. Dépendances retirées depuis, copies : parmi les tâches de l'espace, par titre exact.
UPDATE "task_activities" a SET "ref_task_id" = m."ref"
FROM (
  SELECT a2."id", min(t."id"::text)::uuid AS "ref", count(*) AS "n"
  FROM "task_activities" a2
  JOIN "tasks" t ON t."workspace_id" = a2."workspace_id" AND t."id" <> a2."task_id"
                AND t."title" = coalesce(a2."new_value", a2."old_value")
  WHERE a2."kind" IN ('dependency_added', 'dependency_removed', 'duplicated') AND a2."ref_task_id" IS NULL
  GROUP BY a2."id"
) m
WHERE a."id" = m."id" AND m."n" = 1;
