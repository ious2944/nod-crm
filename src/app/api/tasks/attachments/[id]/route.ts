import { assertUuid, withActor } from "@/lib/tasks/route-helpers";
import { readAttachment } from "@/lib/tasks/settings-service";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

/**
 * Téléchargement d'une pièce jointe : uniquement si la tâche est lisible par
 * l'utilisateur de la session (espace + projets privés). Jamais servi en
 * statique. `nosniff` + `Content-Disposition` empêchent l'exécution d'un
 * contenu dans l'origine de l'application ; seuls images et PDF s'affichent.
 */
export async function GET(request: Request, context: RouteContext<"/api/tasks/attachments/[id]">): Promise<Response> {
  return withActor(async (actor) => {
    const id = assertUuid((await context.params).id);
    const file = await readAttachment(actor, id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const disposition = !download && INLINE.has(file.mimeType) ? "inline" : "attachment";
    const encoded = encodeURIComponent(file.fileName);
    return new Response(new Blob([file.bytes as BlobPart], { type: file.mimeType }), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}
