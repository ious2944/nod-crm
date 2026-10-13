import { assertUuid, json, withActor } from "@/lib/tasks/route-helpers";
import { getCrmRef, getLinkedWork, type CrmKind } from "@/lib/tasks/work-queries";

const KINDS: CrmKind[] = ["contact", "organization", "opportunity"];

/** Tâches et projets liés à une fiche CRM. */
export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") as CrmKind;
    if (!KINDS.includes(kind)) return json({ error: "Type invalide." }, { status: 400 });
    const id = assertUuid(params.get("id"));
    const [work, ref] = await Promise.all([getLinkedWork(actor, kind, id), getCrmRef(actor, kind, id)]);
    return json({ ...work, ref });
  });
}
