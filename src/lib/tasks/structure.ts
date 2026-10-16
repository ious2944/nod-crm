import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { TaskValidationError } from "./access";

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
 * Le verrou est libéré au COMMIT ou au ROLLBACK (`pg_try_advisory_xact_lock`).
 * Les écritures qui ne changent pas la structure (titre, échéance, statut sans
 * récurrence, commentaires…) ne le prennent pas.
 *
 * Acquisition **non bloquante** : la transaction essaie de prendre le verrou
 * (`pg_try_advisory_xact_lock`) et, s'il est déjà tenu, se termine aussitôt —
 * aucune connexion n'est gardée pendant l'attente. Deux nouvelles tentatives
 * courtes, chacune dans une nouvelle transaction (`STRUCTURE_RETRY_DELAYS_MS`,
 * environ 0,2 s au total), absorbent les chevauchements ordinaires ; ensuite
 * l'opération est refusée avec `StructureBusyError`, sans rien avoir écrit.
 * Une opération qui détient le verrou le garde le temps de son propre travail
 * (une purge de 8 000 tâches : environ 8 s) ; `STRUCTURE_TRANSACTION_TIMEOUT_MS`
 * annule sa transaction si elle dépasse 20 s entre deux requêtes — une requête
 * en cours n'est pas interrompue.
 */

/** Classe du verrou consultatif (deux entiers : classe, espace). « nodS ». */
export const STRUCTURE_LOCK_CLASS = 0x6e6f6453;

/** Durée maximale d'une transaction de structure qui détient le verrou. */
export const STRUCTURE_TRANSACTION_TIMEOUT_MS = 20_000;

/** Pauses entre les tentatives d'acquisition (hors transaction, aucune connexion gardée). */
export const STRUCTURE_RETRY_DELAYS_MS = [50, 150] as const;

export const STRUCTURE_BUSY_MESSAGE = "Une opération est déjà en cours. Réessayez dans quelques instants.";

/** Le verrou de structure de l'espace est déjà tenu : rien n'a été écrit. */
export class StructureBusyError extends TaskValidationError {
  constructor() {
    super(STRUCTURE_BUSY_MESSAGE);
    this.name = "StructureBusyError";
  }
}

/** Essaie de prendre le verrou dans la transaction ; `false` s'il est tenu ailleurs. */
export async function tryLockStructure(tx: Prisma.TransactionClient, workspaceId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${STRUCTURE_LOCK_CLASS}::int, hashtext(${workspaceId})) AS locked`;
  return rows[0]?.locked === true;
}

/** Signal interne : verrou indisponible pour cette tentative. */
class LockUnavailable extends Error {}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function structureTransaction<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Rien n'est lu ni écrit avant d'avoir le verrou : une tentative
          // refusée n'a aucun effet et peut être rejouée telle quelle.
          if (!(await tryLockStructure(tx, workspaceId))) throw new LockUnavailable();
          return fn(tx);
        },
        { maxWait: 5_000, timeout: STRUCTURE_TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (!(error instanceof LockUnavailable)) throw error;
      const delay = STRUCTURE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new StructureBusyError();
      await pause(delay);
    }
  }
}

/** Verrouille des tâches dans l'ordre de leur identifiant. */
export async function lockTasks(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$queryRaw`SELECT id FROM tasks WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}
