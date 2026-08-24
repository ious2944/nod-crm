-- NOD CRM V0.2 — module Contacts.
--
-- Strictement additive : aucune colonne existante n'est supprimée, renommée ni
-- retypée, et aucune ligne n'est touchée. Les contacts déjà présents restent
-- valides avec `archived_at IS NULL` (donc actifs) et des champs nouveaux à NULL.
--
-- `follow_ups.contact_id` n'apparaît pas ici : la relation facultative
-- existait déjà depuis la migration initiale (`NULL` autorisé, `ON DELETE SET
-- NULL`). Les suivis sans contact continuent donc de fonctionner à l'identique.
--
-- Les index sont remplacés, pas empilés : l'ancien
-- `(workspace_id, first_name, last_name)` ne servait plus, la liste filtrant
-- désormais toujours sur `archived_at`.

-- DropIndex
DROP INDEX "contacts_workspace_id_first_name_last_name_idx";

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_key" TEXT,
ADD COLUMN     "photo_mime_type" TEXT;

-- CreateIndex
CREATE INDEX "contacts_workspace_id_archived_at_first_name_last_name_idx" ON "contacts"("workspace_id", "archived_at", "first_name", "last_name");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_archived_at_created_at_idx" ON "contacts"("workspace_id", "archived_at", "created_at");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_archived_at_updated_at_idx" ON "contacts"("workspace_id", "archived_at", "updated_at");
