import { viewConfigSchema } from "@/lib/tasks/query-engine";
import { json, withActor } from "@/lib/tasks/route-helpers";
import { searchTasks } from "@/lib/tasks/work-queries";

/** Recherche serveur : `?filters=<JSON>` (titre + description complète, permissions appliquées). */
export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const raw = new URL(request.url).searchParams.get("filters") ?? "{}";
    let filters: unknown;
    try {
      filters = JSON.parse(raw);
    } catch {
      return json({ error: "Filtres invalides." }, { status: 400 });
    }
    const parsed = viewConfigSchema.shape.filters.safeParse(filters);
    if (!parsed.success) return json({ error: "Filtres invalides." }, { status: 400 });
    return json({ tasks: await searchTasks(actor, parsed.data) });
  });
}
