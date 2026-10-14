-- NOD CRM V1.0 — gestion de travail (projets, sections, sous-tâches,
-- dépendances, champs personnalisés, collaboration, notifications,
-- automatisations).
--
-- Migration additive et conservatrice :
--   * aucune table ni colonne existante n'est supprimée, renommée ni retypée ;
--   * la seule contrainte relâchée est `tasks.due_at NOT NULL` (une tâche peut
--     désormais ne pas avoir d'échéance) — aucune ligne existante n'est touchée
--     par ce changement ;
--   * les tâches existantes restent dans la même table : la liste historique,
--     le cockpit et les fiches CRM continuent de les lire telles quelles.
--
-- Reprise de données en fin de fichier : statut dérivé de `completed_at`.
-- Le créateur est repris par la migration suivante ; le responsable n'est
-- jamais déduit.

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'WAITING', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('WORKSPACE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ON_HOLD', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'EDITOR', 'COMMENTER');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SINGLE_SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "TaskFollowerKind" AS ENUM ('COLLABORATOR', 'FOLLOWER');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approval_status" "ApprovalStatus",
ADD COLUMN     "assignee_id" UUID,
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "due_time" TEXT,
ADD COLUMN     "estimated_minutes" INTEGER,
ADD COLUMN     "is_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_milestone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "recurrence" JSONB,
ADD COLUMN     "recurrence_origin_id" UUID,
ADD COLUMN     "start_at" TIMESTAMP(3),
ADD COLUMN     "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
ADD COLUMN     "subtask_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "due_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'indigo',
    "icon" TEXT NOT NULL DEFAULT 'folder',
    "owner_id" UUID,
    "created_by_id" UUID,
    "start_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "visibility" "ProjectVisibility" NOT NULL DEFAULT 'WORKSPACE',
    "status" "ProjectStatus" NOT NULL DEFAULT 'ON_TRACK',
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "contact_id" UUID,
    "organization_id" UUID,
    "opportunity_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'EDITOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "project_sections" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_projects" (
    "task_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "section_id" UUID,
    "workspace_id" UUID NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_projects_pkey" PRIMARY KEY ("task_id","project_id")
);

-- CreateTable
CREATE TABLE "project_favorites" (
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_favorites_pkey" PRIMARY KEY ("user_id","project_id")
);

-- CreateTable
CREATE TABLE "project_status_updates" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "author_id" UUID,
    "status" "ProjectStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_tags" (
    "task_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "task_tags_pkey" PRIMARY KEY ("task_id","tag_id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_custom_fields" (
    "project_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "project_custom_fields_pkey" PRIMARY KEY ("project_id","field_id")
);

-- CreateTable
CREATE TABLE "task_custom_field_values" (
    "task_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "text_value" TEXT,
    "number_value" DOUBLE PRECISION,
    "date_value" TIMESTAMP(3),
    "bool_value" BOOLEAN,
    "option_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "task_custom_field_values_pkey" PRIMARY KEY ("task_id","field_id")
);

-- CreateTable
CREATE TABLE "task_followers" (
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "TaskFollowerKind" NOT NULL DEFAULT 'FOLLOWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_followers_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "blocking_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("blocking_id","blocked_id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID,
    "status_update_id" UUID,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reactions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("comment_id","user_id","emoji")
);

-- CreateTable
CREATE TABLE "task_activities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_id" UUID,
    "automation_rule_id" UUID,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_time_entries" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "minutes" INTEGER NOT NULL,
    "spent_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" TEXT NOT NULL,
    "task_id" UUID,
    "project_id" UUID,
    "comment_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "action_kind" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID,
    "event_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "estimated_minutes" INTEGER,
    "is_approval" BOOLEAN NOT NULL DEFAULT false,
    "subtasks" JSONB NOT NULL DEFAULT '[]',
    "tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_forms" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "section_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_workspace_id_archived_at_is_template_idx" ON "projects"("workspace_id", "archived_at", "is_template");

-- CreateIndex
CREATE INDEX "projects_contact_id_idx" ON "projects"("contact_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");

-- CreateIndex
CREATE INDEX "projects_opportunity_id_idx" ON "projects"("opportunity_id");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE INDEX "project_sections_project_id_position_idx" ON "project_sections"("project_id", "position");

-- CreateIndex
CREATE INDEX "task_projects_project_id_section_id_position_idx" ON "task_projects"("project_id", "section_id", "position");

-- CreateIndex
CREATE INDEX "project_status_updates_project_id_created_at_idx" ON "project_status_updates"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspace_id_name_key" ON "tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "task_tags_tag_id_idx" ON "task_tags"("tag_id");

-- CreateIndex
CREATE INDEX "custom_fields_workspace_id_idx" ON "custom_fields"("workspace_id");

-- CreateIndex
CREATE INDEX "task_custom_field_values_field_id_idx" ON "task_custom_field_values"("field_id");

-- CreateIndex
CREATE INDEX "task_followers_user_id_idx" ON "task_followers"("user_id");

-- CreateIndex
CREATE INDEX "task_dependencies_blocked_id_idx" ON "task_dependencies"("blocked_id");

-- CreateIndex
CREATE INDEX "task_dependencies_workspace_id_idx" ON "task_dependencies"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_attachments_storage_key_key" ON "task_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "task_attachments_task_id_idx" ON "task_attachments"("task_id");

-- CreateIndex
CREATE INDEX "comments_task_id_created_at_idx" ON "comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_status_update_id_created_at_idx" ON "comments"("status_update_id", "created_at");

-- CreateIndex
CREATE INDEX "task_activities_task_id_created_at_idx" ON "task_activities"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_time_entries_task_id_idx" ON "task_time_entries"("task_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_archived_at_created_at_idx" ON "notifications"("user_id", "archived_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "saved_views_user_id_scope_idx" ON "saved_views"("user_id", "scope");

-- CreateIndex
CREATE INDEX "automation_rules_workspace_id_trigger_is_enabled_idx" ON "automation_rules"("workspace_id", "trigger", "is_enabled");

-- CreateIndex
CREATE INDEX "automation_runs_rule_id_created_at_idx" ON "automation_runs"("rule_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_rule_id_event_key_key" ON "automation_runs"("rule_id", "event_key");

-- CreateIndex
CREATE INDEX "task_templates_workspace_id_project_id_idx" ON "task_templates"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "task_forms_project_id_idx" ON "task_forms"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_recurrence_origin_id_key" ON "tasks"("recurrence_origin_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_assignee_id_completed_at_idx" ON "tasks"("workspace_id", "assignee_id", "completed_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "tasks"("organization_id");

-- CreateIndex
CREATE INDEX "tasks_parent_id_subtask_position_idx" ON "tasks"("parent_id", "subtask_position");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_origin_id_fkey" FOREIGN KEY ("recurrence_origin_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sections" ADD CONSTRAINT "project_sections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "project_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_favorites" ADD CONSTRAINT "project_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_favorites" ADD CONSTRAINT "project_favorites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_custom_fields" ADD CONSTRAINT "project_custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_custom_fields" ADD CONSTRAINT "project_custom_fields_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocking_id_fkey" FOREIGN KEY ("blocking_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_status_update_id_fkey" FOREIGN KEY ("status_update_id") REFERENCES "project_status_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_forms" ADD CONSTRAINT "task_forms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_forms" ADD CONSTRAINT "task_forms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_forms" ADD CONSTRAINT "task_forms_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "project_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Reprise des données existantes ─────────────────────────────────────────

-- 1. Statut : une tâche terminée est DONE, les autres restent TODO (défaut).
UPDATE "tasks" SET "status" = 'DONE' WHERE "completed_at" IS NOT NULL;

-- 2. Créateur et responsable : voir la migration suivante
--    (20261014090000_work_management_hardening). Aucun responsable n'est
--    déduit ici : l'auteur d'une création n'est pas nécessairement la personne
--    responsable de la tâche.
