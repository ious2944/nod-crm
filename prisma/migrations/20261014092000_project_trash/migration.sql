-- V1.0 — Corbeille des projets.
--
-- Supprimer un projet le met à la corbeille (`projects.deleted_at`) au lieu de
-- l'effacer. Ses tâches exclusives (et leurs sous-tâches encore actives) sont
-- mises à la corbeille avec lui (`tasks.deleted_with_project_id`) ; sections,
-- membres, champs, règles et rattachements `task_projects` sont conservés pour
-- la restauration. Purement additive ; réexécutable sans effet.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deleted_with_project_id" UUID;

CREATE INDEX IF NOT EXISTS "projects_workspace_id_deleted_at_idx" ON "projects"("workspace_id", "deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_deleted_with_project_id_fkey') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_with_project_id_fkey" FOREIGN KEY ("deleted_with_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_deleted_by_id_fkey') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
