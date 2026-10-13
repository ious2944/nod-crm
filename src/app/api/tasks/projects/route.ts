import { json, withActor } from "@/lib/tasks/route-helpers";
import { listProjects } from "@/lib/tasks/work-queries";

const SCOPES = ["active", "archived", "templates", "all"] as const;

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const raw = new URL(request.url).searchParams.get("scope") ?? "active";
    const scope = (SCOPES as readonly string[]).includes(raw) ? (raw as (typeof SCOPES)[number]) : "active";
    return json({ projects: await listProjects(actor, scope) });
  });
}
