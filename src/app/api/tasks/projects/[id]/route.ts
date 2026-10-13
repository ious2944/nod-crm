import { assertUuid, json, withActor } from "@/lib/tasks/route-helpers";
import { getProjectBundle } from "@/lib/tasks/work-queries";

export async function GET(_request: Request, context: RouteContext<"/api/tasks/projects/[id]">): Promise<Response> {
  return withActor(async (actor) => {
    const id = assertUuid((await context.params).id);
    return json(await getProjectBundle(actor, id));
  });
}
