import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Verrou de structure d'un espace.
 *
 * Toute écriture qui change **où vit une tâche** — rattachement ou retrait
 * d'un projet, parenté, dépendances, corbeille (tâche ou projet), purge,
 * création dans un projet ou sous une parente, duplication, occurrence
 * récurrente — s'exécute dans `structureTransaction`. La transaction prend
 * d'abord un verrou consultatif propre à l'espace, puis relit et revérifie
 * ce dont elle dépend, puis écrit.
 *
 * Ordre de verrouillage, identique partout : 1) ce verrou d'espace ;
 * 2) les lignes (projets, puis tâches) dans l'ordre de leur identifiant.
 * Deux opérations de structure d'un même espace ne s'intercalent donc
 * jamais, et ne peuvent pas s'interbloquer entre elles.
 *
 * Le verrou est libéré au COMMIT ou au ROLLBACK (`pg_advisory_xact_lock`).
 * Les écritures qui ne changent pas la structure (titre, échéance, statut sans
 * récurrence, commentaires…) ne le prennent pas.
 */

/** Classe du verrou consultatif (deux entiers : classe, espace). « nodS ». */
export const STRUCTURE_LOCK_CLASS = 0x6e6f6453;

/** Durée maximale d'une transaction de structure (attente du verrou comprise). */
export const STRUCTURE_TRANSACTION_TIMEOUT_MS = 20_000;

export async function lockStructure(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STRUCTURE_LOCK_CLASS}::int, hashtext(${workspaceId}))`;
}

export function structureTransaction<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockStructure(tx, workspaceId);
      return fn(tx);
    },
    { maxWait: 5_000, timeout: STRUCTURE_TRANSACTION_TIMEOUT_MS },
  );
}

/** Verrouille des tâches dans l'ordre de leur identifiant. */
export async function lockTasks(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM tasks WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}
