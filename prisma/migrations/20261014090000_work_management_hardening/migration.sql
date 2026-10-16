-- NOD CRM V1.0 — durcissement du module de gestion de travail.
--
-- Additive : colonnes facultatives et tables nouvelles uniquement.
--   * corbeille (`tasks.deleted_at`, `deleted_by_id`) ;
--   * dernier statut actif (réouverture) ;
--   * projet concerné par une ligne d'historique (confidentialité) ;
--   * champs personnalisés propres à un projet ;
--   * capacité hebdomadaire des utilisateurs (vue Charge) ;
--   * rappels d'échéance planifiés (`task_reminders`) et bail d'exécution
--     (`job_leases`) ;
--   * signalements de reprise des tâches historiques.

-- AlterTable
ALTER TABLE "custom_fields" ADD COLUMN     "project_id" UUID;

-- AlterTable
ALTER TABLE "task_activities" ADD COLUMN     "project_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_id" UUID,
ADD COLUMN     "last_active_status" "TaskStatus";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "weekly_capacity_minutes" INTEGER;

-- CreateTable
CREATE TABLE "task_reminders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "reminder_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "due_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_leases" (
    "job" TEXT NOT NULL,
    "locked_until" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_started_at" TIMESTAMP(3),
    "last_finished_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_message" TEXT,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "task_migration_notes" (
    "task_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_migration_notes_pkey" PRIMARY KEY ("task_id","reason")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_reminders_reminder_key_key" ON "task_reminders"("reminder_key");

-- CreateIndex
CREATE INDEX "task_reminders_status_created_at_idx" ON "task_reminders"("status", "created_at");

-- CreateIndex
CREATE INDEX "task_migration_notes_workspace_id_reason_idx" ON "task_migration_notes"("workspace_id", "reason");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_deleted_at_idx" ON "tasks"("workspace_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_migration_notes" ADD CONSTRAINT "task_migration_notes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Reprise des tâches historiques ─────────────────────────────────────────
--
-- Une tâche « historique » est une tâche antérieure à la V1.0 : elle n'a
-- aucune ligne d'historique (toute tâche créée par la V1.0 en a au moins une).
--
-- Règle : on n'utilise que des données explicites.
--   * Créateur : l'auteur de l'événement d'audit `Task / CREATE`, s'il existe
--     encore et appartient au même espace (actif ou non : c'est un fait
--     historique). Sinon : inconnu.
--   * Responsable : la V0.x n'avait pas de notion de responsable. Il n'est donc
--     jamais déduit — ni de l'auteur de la création ou d'une modification, ni
--     du fait qu'un espace n'ait qu'un utilisateur. La tâche reste non affectée.
-- Chaque information manquante est signalée dans `task_migration_notes`.

UPDATE "tasks" AS t
SET "created_by_id" = a."user_id"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "user_id"
  FROM "audit_logs"
  WHERE "entity_type" = 'Task' AND "action" = 'CREATE'
  ORDER BY "entity_id", "created_at"
) AS a
WHERE a."entity_id" = t."id"
  AND t."created_by_id" IS NULL
  AND a."user_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."user_id" AND u."workspace_id" = t."workspace_id")
  AND NOT EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id");

INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason")
SELECT t."id", t."workspace_id", 'ASSIGNEE_UNKNOWN'
FROM "tasks" t
WHERE t."assignee_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id")
ON CONFLICT DO NOTHING;

INSERT INTO "task_migration_notes" ("task_id", "workspace_id", "reason")
SELECT t."id", t."workspace_id", 'CREATOR_UNKNOWN'
FROM "tasks" t
WHERE t."created_by_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "task_activities" ta WHERE ta."task_id" = t."id")
ON CONFLICT DO NOTHING;
