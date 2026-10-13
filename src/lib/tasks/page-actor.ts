import "server-only";

import { requireUser } from "@/lib/auth/dal";

import type { Actor } from "./access";

/** Acteur d'une page du module : redirige vers /login sans session. */
export async function getPageActor(): Promise<Actor> {
  const user = await requireUser();
  return { id: user.id, workspaceId: user.workspaceId };
}
