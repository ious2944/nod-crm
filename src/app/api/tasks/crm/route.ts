import { json, withActor } from "@/lib/tasks/route-helpers";
import { searchCrm, type CrmKind } from "@/lib/tasks/work-queries";

const KINDS: CrmKind[] = ["contact", "organization", "opportunity"];

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") as CrmKind;
    if (!KINDS.includes(kind)) return json({ error: "Type invalide." }, { status: 400 });
    return json({ items: await searchCrm(actor, kind, (params.get("q") ?? "").slice(0, 120)) });
  });
}
