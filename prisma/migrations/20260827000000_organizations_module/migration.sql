-- NOD CRM V0.5 — module Organisations.
--
-- Strictement additive : aucune colonne existante supprimée, renommée ni
-- retypée, aucune contrainte retirée. Les contacts et suivis déjà en base
-- continuent de fonctionner à l'identique.
--
-- Étapes conformes au plan de migration documenté dans docs/contacts.md :
--   1. Créer la table `organizations`.
--   2. Backfiller les organisations distinctes depuis `contacts.organization_name`.
--   3. Ajouter `contacts.organization_id` (nullable, ON DELETE SET NULL).
--   4. Backfiller `organization_id` par correspondance de nom dans le workspace.
--   5. `organization_name` est conservé — il sera retiré dans une version ultérieure.
--
-- `ON DELETE SET NULL` sur `contacts.organization_id` : supprimer (ou archiver)
-- une organisation ne supprime jamais un contact ; il perd seulement son lien.
-- La cohérence de workspace entre un contact et son organisation est vérifiée
-- par l'application avant écriture (src/app/(app)/organizations/actions.ts) ;
-- une clé étrangère composite (id, workspace_id) l'imposerait côté SQL mais
-- interdirait le `SET NULL` ci-dessus.

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organizations_workspace_id_archived_at_name_idx" ON "organizations"("workspace_id", "archived_at", "name");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill : insérer une organisation par nom distinct dans chaque workspace,
-- à partir des valeurs existantes de `contacts.organization_name`.
-- Les doublons sont éliminés par le GROUP BY ; les noms vides ou nuls sont
-- ignorés. L'identifiant est généré par gen_random_uuid(), disponible en
-- PostgreSQL 13+ sans extension.
INSERT INTO "organizations" ("id", "workspace_id", "name", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    c."workspace_id",
    c."organization_name",
    NOW(),
    NOW()
FROM (
    SELECT DISTINCT "workspace_id", "organization_name"
    FROM "contacts"
    WHERE "organization_name" IS NOT NULL
      AND "organization_name" <> ''
) c;

-- AddColumn
ALTER TABLE "contacts" ADD COLUMN "organization_id" UUID;

-- CreateIndex (contacts.organization_id)
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill : relier chaque contact à l'organisation créée ci-dessus par
-- correspondance exacte (workspace_id, organization_name). Un contact dont
-- le nom d'organisation ne correspond à aucune organisation du workspace
-- reste avec organization_id = NULL, ce qui est correct.
UPDATE "contacts" c
SET "organization_id" = o."id"
FROM "organizations" o
WHERE c."workspace_id" = o."workspace_id"
  AND c."organization_name" = o."name"
  AND c."organization_name" IS NOT NULL
  AND c."organization_name" <> '';
