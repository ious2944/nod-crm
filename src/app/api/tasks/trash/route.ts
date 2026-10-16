import { listProjectTrash } from "@/lib/tasks/project-service";
import { json, withActor } from "@/lib/tasks/route-helpers";
import { listTrash } from "@/lib/tasks/service";

/**
 * Corbeille : tâches et projets supprimés que l'acteur peut restaurer ou
 * supprimer définitivement (droits évalués côté serveur).
 */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => {
    const [items, projects] = await Promise.all([listTrash(actor), listProjectTrash(actor)]);
    return json({ items, projects });
  });
}
