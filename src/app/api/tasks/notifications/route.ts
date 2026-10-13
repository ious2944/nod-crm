import { json, triggerSweep, withActor } from "@/lib/tasks/route-helpers";
import { getNotificationPreferences, listNotifications } from "@/lib/tasks/work-queries";

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    triggerSweep(actor.workspaceId);
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    const [items, preferences] = await Promise.all([
      listNotifications(actor, archived),
      getNotificationPreferences(actor),
    ]);
    return json({ items, preferences });
  });
}
