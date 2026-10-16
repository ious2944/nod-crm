import { assertUuid, json, withActor } from "@/lib/tasks/route-helpers";
import { getTaskDetail } from "@/lib/tasks/work-queries";

export async function GET(_request: Request, context: RouteContext<"/api/tasks/items/[id]">): Promise<Response> {
  return withActor(async (actor) => {
    const id = assertUuid((await context.params).id);
    return json(await getTaskDetail(actor, id));
  });
}
