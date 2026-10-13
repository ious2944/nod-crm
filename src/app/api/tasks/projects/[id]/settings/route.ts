import { assertUuid, json, withActor } from "@/lib/tasks/route-helpers";
import { getProjectSettings } from "@/lib/tasks/work-queries";

export async function GET(_request: Request, context: RouteContext<"/api/tasks/projects/[id]/settings">): Promise<Response> {
  return withActor(async (actor) => {
    const id = assertUuid((await context.params).id);
    return json(await getProjectSettings(actor, id));
  });
}
