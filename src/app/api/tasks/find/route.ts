import { json, withActor } from "@/lib/tasks/route-helpers";
import { quickFindTasks } from "@/lib/tasks/work-queries";

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").slice(0, 120);
    const exclude = params.get("exclude");
    return json({ tasks: await quickFindTasks(actor, q, exclude && /^[0-9a-f-]{36}$/.test(exclude) ? exclude : undefined) });
  });
}
