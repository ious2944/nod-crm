import { json, withActor } from "@/lib/tasks/route-helpers";
import { listTrash } from "@/lib/tasks/service";

/** Corbeille : tâches supprimées que l'acteur peut restaurer ou supprimer définitivement. */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => json({ items: await listTrash(actor) }));
}
