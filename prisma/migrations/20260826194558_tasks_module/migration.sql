-- NOD CRM V0.4 — module Tâches.
--
-- Strictement additive : une seule table nouvelle, aucune colonne existante
-- supprimée, renommée ni retypée, aucune ligne touchée. Les suivis et les
-- contacts déjà en base continuent de fonctionner à l'identique.
--
-- `contact_id` et `follow_up_id` sont facultatifs et en `ON DELETE SET NULL` :
-- supprimer un contact ou un suivi ne fait jamais disparaître une tâche, elle
-- perd seulement son contexte. La cohérence de workspace de ces deux liens est
-- vérifiée par l'application avant écriture (voir `src/app/(app)/tasks/actions.ts`) ;
-- une clé étrangère composite `(id, workspace_id)` l'imposerait au niveau SQL
-- mais interdirait justement le `SET NULL` ci-dessus.

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID,
    "follow_up_id" UUID,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_workspace_id_completed_at_due_at_idx" ON "tasks"("workspace_id", "completed_at", "due_at");

-- CreateIndex
CREATE INDEX "tasks_contact_id_idx" ON "tasks"("contact_id");

-- CreateIndex
CREATE INDEX "tasks_follow_up_id_idx" ON "tasks"("follow_up_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
