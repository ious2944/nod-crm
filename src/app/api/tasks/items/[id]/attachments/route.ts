import { MAX_ATTACHMENT_BYTES } from "@/lib/tasks/constants";
import { assertUuid, isSameOrigin, json, withActor } from "@/lib/tasks/route-helpers";
import { addAttachment } from "@/lib/tasks/settings-service";

/**
 * Envoi d'une pièce jointe (multipart, champ `file`).
 *
 * Contrôles : même origine (CSRF), session, droit de modifier la tâche, taille
 * (10 Mo), type (extension + signature binaire). Le fichier est stocké sous
 * une clé opaque générée par le serveur ; le nom d'origine n'est conservé que
 * pour l'affichage.
 */
export async function POST(request: Request, context: RouteContext<"/api/tasks/items/[id]/attachments">): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Origine refusée." }, { status: 403 });
  return withActor(async (actor) => {
    const id = assertUuid((await context.params).id);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_ATTACHMENT_BYTES + 64 * 1024) {
      return json({ error: "Fichier trop volumineux (10 Mo maximum)." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Aucun fichier reçu." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachmentId = await addAttachment(actor, id, file.name, bytes);
    return json({ id: attachmentId }, { status: 201 });
  });
}
