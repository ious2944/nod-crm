-- DropIndex
DROP INDEX "contacts_workspace_id_last_name_first_name_idx";

-- CreateIndex
CREATE INDEX "contacts_workspace_id_first_name_last_name_idx" ON "contacts"("workspace_id", "first_name", "last_name");
