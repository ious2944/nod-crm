import "server-only";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/dal";

import { TaskAccessError, TaskValidationError, type Actor } from "./access";

/**
 * Lectures du module exposées en Route Handlers (`GET /api/tasks/...`).
 *
 * Pourquoi pas des Server Actions : Next exécute les actions d'un client une
 * par une. Une relecture déclenchée par le temps réel bloquerait alors la
 * saisie de l'utilisateur. Les GET, eux, partent en parallèle.
 *
 * Mêmes garanties qu'une page : session vérifiée, espace dérivé de la session,
 * réponse `404` identique pour « inexistant » et « interdit », jamais mise en
 * cache (`no-store`, données privées).
 */

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, { ...init, headers: { ...PRIVATE_HEADERS, ...(init.headers ?? {}) } });
}

export async function withActor(handler: (actor: Actor) => Promise<Response>): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Authentification requise." }, { status: 401 });
  const actor = { id: user.id, workspaceId: user.workspaceId };
  try {
    return await handler(actor);
  } catch (error) {
    if (error instanceof TaskAccessError) {
      return json({ error: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    }
    if (error instanceof TaskValidationError) return json({ error: error.message }, { status: 400 });
    console.error("[tasks] lecture en échec", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    return json({ error: "Erreur serveur." }, { status: 500 });
  }
}

export const uuid = z.uuid();

export function assertUuid(value: string | null | undefined): string {
  if (!value || !uuid.safeParse(value).success) throw new TaskAccessError("NOT_FOUND");
  return value;
}

/**
 * Garde CSRF des Route Handlers qui écrivent (envoi de pièce jointe) : les
 * Server Actions ont la leur, intégrée à Next ; ici on compare nous-mêmes
 * l'en-tête `Origin` à l'hôte servi.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

