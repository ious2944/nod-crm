import { json, triggerSweep, withActor } from "@/lib/tasks/route-helpers";
import { getWorkContext } from "@/lib/tasks/work-queries";

/** Contexte partagé par toutes les vues : utilisateurs, tags, champs, projets. */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => {
    triggerSweep(actor.workspaceId);
    return json(await getWorkContext(actor));
  });
}
