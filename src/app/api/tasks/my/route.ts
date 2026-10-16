import { json, withActor } from "@/lib/tasks/route-helpers";
import { getMyTasks } from "@/lib/tasks/work-queries";

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const completed = new URL(request.url).searchParams.get("completed") === "1";
    return json({ tasks: await getMyTasks(actor, completed) });
  });
}
