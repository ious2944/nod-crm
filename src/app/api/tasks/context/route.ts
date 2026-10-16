import { json, withActor } from "@/lib/tasks/route-helpers";
import { getWorkContext } from "@/lib/tasks/work-queries";

/** Contexte partagé par toutes les vues : utilisateurs, tags, champs, projets. */
export async function GET(): Promise<Response> {
  return withActor(async (actor) => {
    return json(await getWorkContext(actor));
  });
}
