-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('A_QUALIFIER', 'EN_DISCUSSION', 'PROPOSITION', 'GAGNEE', 'PERDUE');

-- AlterTable
ALTER TABLE "follow_ups" ADD COLUMN     "opportunity_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "privacy_incidents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "privacy_processors" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "privacy_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "privacy_treatments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "opportunity_id" UUID;

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID,
    "name" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'A_QUALIFIER',
    "estimated_amount" DECIMAL(14,2),
    "expected_close_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_status_created_at_idx" ON "opportunities"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_status_estimated_amount_idx" ON "opportunities"("workspace_id", "status", "estimated_amount");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_idx" ON "opportunities"("organization_id");

-- CreateIndex
CREATE INDEX "opportunities_contact_id_idx" ON "opportunities"("contact_id");

-- CreateIndex
CREATE INDEX "follow_ups_opportunity_id_idx" ON "follow_ups"("opportunity_id");

-- CreateIndex
CREATE INDEX "tasks_opportunity_id_idx" ON "tasks"("opportunity_id");

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
