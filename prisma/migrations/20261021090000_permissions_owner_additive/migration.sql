-- Permissions V1, lot A — étape 1/3 : colonnes de propriété, purement additives.
--
-- * `owner_id` NULLABLE sur les fiches CRM (organisations, contacts, suivis,
--   opportunités) et RGPD (traitements, sous-traitants, demandes, incidents) ;
-- * `created_by_id` sur `tags` et `custom_fields` (décision a) ;
-- * index `(workspace_id, owner_id)`.
--
-- Aucun changement de comportement : le code déployé avec cette étape ignore
-- encore ces colonnes. Elles sont remplies par `scripts/backfill-owner.mjs`
-- (étape 2), puis rendues obligatoires par la migration suivante (étape 3).
-- Ordre de déploiement : `docs/permissions-v1.md`, § « Déploiement du lot A ».
--
-- `ON DELETE NO ACTION` (et non RESTRICT) : la contrainte est vérifiée en fin
-- d'instruction, ce qui laisse la suppression d'un espace (cascade vers ses
-- utilisateurs ET ses fiches) aboutir. Supprimer seul un utilisateur qui
-- possède encore des fiches est refusé : on désactive un compte, on ne le
-- supprime pas.

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "custom_fields" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "follow_ups" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "privacy_incidents" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "privacy_processors" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "privacy_requests" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "privacy_treatments" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "created_by_id" UUID;

-- CreateIndex
CREATE INDEX "contacts_workspace_id_owner_id_idx" ON "contacts"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "follow_ups_workspace_id_owner_id_idx" ON "follow_ups"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_owner_id_idx" ON "opportunities"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "organizations_workspace_id_owner_id_idx" ON "organizations"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "privacy_incidents_workspace_id_owner_id_idx" ON "privacy_incidents"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "privacy_processors_workspace_id_owner_id_idx" ON "privacy_processors"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "privacy_requests_workspace_id_owner_id_idx" ON "privacy_requests"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "privacy_treatments_workspace_id_owner_id_idx" ON "privacy_treatments"("workspace_id", "owner_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_treatments" ADD CONSTRAINT "privacy_treatments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_processors" ADD CONSTRAINT "privacy_processors_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_incidents" ADD CONSTRAINT "privacy_incidents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
