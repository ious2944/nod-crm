-- V1.0 — Corbeille des projets : clés étrangères, garde corrigée.
--
-- `20261014092000_project_trash` ne crée ses deux clés étrangères que si
-- aucune contrainte du même nom n'existe dans `pg_constraint`, sans filtrer
-- par schéma : dans une base qui contient déjà ce nom dans un autre schéma,
-- elles n'étaient pas créées. Ce défaut a été trouvé par le contrôle de schéma
-- de `scripts/migration-check.mjs`. Cette migration ne modifie pas la
-- précédente (déjà appliquée par certaines bases) : elle crée les contraintes
-- manquantes dans le schéma courant. Sans effet là où elles existent déjà.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'tasks_deleted_with_project_id_fkey' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_with_project_id_fkey" FOREIGN KEY ("deleted_with_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conname = 'projects_deleted_by_id_fkey' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
