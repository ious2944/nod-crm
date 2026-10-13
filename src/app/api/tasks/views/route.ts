import { json, withActor } from "@/lib/tasks/route-helpers";
import { getSavedViews } from "@/lib/tasks/work-queries";

/** Vues personnelles enregistrées de l'utilisateur (jamais celles des autres). */
export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const scope = new URL(request.url).searchParams.get("scope") ?? undefined;
    return json({ views: await getSavedViews(actor, scope?.slice(0, 80)) });
  });
}
