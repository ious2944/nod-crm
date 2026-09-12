import "server-only";

import { prisma } from "@/lib/prisma";

import { resolveRequestId } from "./request-context";
import type { AuditEvent } from "./types";

/**
 * Écrit une ligne d'audit. Best-effort et silencieux à l'appelant : une panne
 * de journalisation (base momentanément indisponible, contrainte violée...)
 * ne doit jamais faire échouer — ni annuler — la mutation métier qu'elle
 * observe. C'est un choix délibéré : entre « la mutation réussit mais
 * l'événement n'est pas tracé cette fois-ci » et « une panne de journalisation
 * bloque tout le produit », le premier est le seul acceptable pour un module
 * qui n'est pas sur le chemin critique.
 *
 * Ce qui part en base : uniquement les champs de `AuditEvent`. Jamais l'objet
 * `error` complet (il peut, selon le pilote, contenir des fragments de
 * connexion ou de requête) — seulement son nom de classe, à des fins de
 * diagnostic, et les identifiants déjà présents dans `event` (des UUID et une
 * valeur d'enum, jamais une donnée personnelle).
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: event.workspaceId,
        userId: event.userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        requestId: event.requestId ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] écriture impossible", {
      workspaceId: event.workspaceId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
}

/**
 * Point d'entrée pour les Server Actions : résout le `requestId` (en-tête
 * entrant ou identifiant généré) puis journalise. C'est la fonction que les
 * modules métier doivent appeler — `logAudit` reste utilisable directement
 * pour les tests ou un `requestId` déjà connu.
 */
export async function recordAudit(event: Omit<AuditEvent, "requestId">): Promise<void> {
  const requestId = await resolveRequestId();
  await logAudit({ ...event, requestId });
}
