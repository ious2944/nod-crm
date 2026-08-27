-- NOD CRM V0.8 — RGPD Essentials
-- Migration additive : ajoute uniquement les tables du module confidentialité.

CREATE TABLE "privacy_treatments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "data_subjects" TEXT,
    "data_categories" TEXT,
    "legal_basis" TEXT NOT NULL DEFAULT 'TO_DETERMINE',
    "retention_period" TEXT,
    "recipients" TEXT,
    "transfer_outside_eea" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "security_measures" TEXT,
    "last_reviewed_at" TIMESTAMP(3),
    "next_review_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_treatments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_processors" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "category" TEXT,
    "data_categories" TEXT,
    "purpose" TEXT,
    "country" TEXT,
    "eea_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dpa_status" TEXT NOT NULL DEFAULT 'TO_REVIEW',
    "dpa_url" TEXT,
    "subprocessors_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "last_reviewed_at" TIMESTAMP(3),
    "next_review_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_processors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_treatment_processors" (
    "workspace_id" UUID NOT NULL,
    "treatment_id" UUID NOT NULL,
    "processor_id" UUID NOT NULL,
    CONSTRAINT "privacy_treatment_processors_pkey" PRIMARY KEY ("treatment_id", "processor_id")
);

CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID,
    "requester_name" TEXT,
    "requester_email" TEXT,
    "request_type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "owner" TEXT,
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "privacy_incidents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "discovered_at" TIMESTAMP(3) NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "data_categories" TEXT,
    "affected_count" INTEGER,
    "consequences" TEXT,
    "measures" TEXT,
    "risk_level" TEXT NOT NULL DEFAULT 'TO_ASSESS',
    "authority_notification" TEXT NOT NULL DEFAULT 'TO_ASSESS',
    "notified_at" TIMESTAMP(3),
    "people_informed" TEXT NOT NULL DEFAULT 'TO_ASSESS',
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "privacy_treatments_workspace_id_archived_at_name_idx" ON "privacy_treatments"("workspace_id", "archived_at", "name");
CREATE INDEX "privacy_treatments_workspace_id_next_review_at_idx" ON "privacy_treatments"("workspace_id", "next_review_at");
CREATE INDEX "privacy_processors_workspace_id_archived_at_name_idx" ON "privacy_processors"("workspace_id", "archived_at", "name");
CREATE INDEX "privacy_processors_workspace_id_next_review_at_idx" ON "privacy_processors"("workspace_id", "next_review_at");
CREATE INDEX "privacy_treatment_processors_workspace_id_idx" ON "privacy_treatment_processors"("workspace_id");
CREATE INDEX "privacy_treatment_processors_processor_id_idx" ON "privacy_treatment_processors"("processor_id");
CREATE INDEX "privacy_requests_workspace_id_status_due_at_idx" ON "privacy_requests"("workspace_id", "status", "due_at");
CREATE INDEX "privacy_requests_contact_id_idx" ON "privacy_requests"("contact_id");
CREATE INDEX "privacy_incidents_workspace_id_status_discovered_at_idx" ON "privacy_incidents"("workspace_id", "status", "discovered_at");

ALTER TABLE "privacy_treatments" ADD CONSTRAINT "privacy_treatments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_processors" ADD CONSTRAINT "privacy_processors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_treatment_processors" ADD CONSTRAINT "privacy_treatment_processors_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "privacy_treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_treatment_processors" ADD CONSTRAINT "privacy_treatment_processors_processor_id_fkey" FOREIGN KEY ("processor_id") REFERENCES "privacy_processors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "privacy_incidents" ADD CONSTRAINT "privacy_incidents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
