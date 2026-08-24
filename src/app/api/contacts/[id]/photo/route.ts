import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { objectStore } from "@/lib/storage";

/**
 * Photo d'un contact.
 *
 * Les images ne sont **pas** servies en statique : elles vivent hors de
 * `public/`, et ce gestionnaire est le seul chemin qui y mène. Il revérifie la
 * session puis l'appartenance au workspace, exactement comme une page.
 * Autrement, connaître (ou deviner) un identifiant suffirait à récupérer la
 * photo d'un contact d'un autre espace.
 *
 * Ce que la réponse ne dit pas compte aussi : un identifiant valide appartenant
 * à quelqu'un d'autre et un identifiant inexistant renvoient le même 404. Rien
 * ne permet de distinguer les deux, donc rien ne permet d'énumérer.
 */

const idSchema = z.uuid();

const NOT_FOUND = new Response(null, { status: 404 });

export async function GET(
  request: Request,
  context: RouteContext<"/api/contacts/[id]/photo">,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    // 401, pas une redirection : ce chemin sert une image, pas une page.
    return new Response(null, { status: 401 });
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NOT_FOUND;
  }

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: user.workspaceId },
    select: { photoKey: true, photoMimeType: true },
  });

  if (!contact?.photoKey) {
    return NOT_FOUND;
  }

  // La clé change à chaque envoi : elle fait un ETag parfait, et le navigateur
  // cesse de servir l'ancienne image dès que la photo est remplacée.
  const etag = `"${contact.photoKey}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  // `read` peut aussi *lever* : volume démonté, droits perdus. Une image
  // manquante ne doit jamais transformer une page en erreur serveur, et le
  // message système — qui contient un chemin — ne doit pas sortir d'ici.
  let bytes: Uint8Array | null = null;
  try {
    bytes = await objectStore.read(contact.photoKey);
  } catch {
    console.error("[contacts] lecture impossible dans le magasin d'objets");
    return NOT_FOUND;
  }

  if (!bytes) {
    // La fiche référence un objet absent (volume non monté, fichier effacé à la
    // main). On le signale dans les journaux plutôt qu'à l'utilisateur.
    console.error("[contacts] photo introuvable dans le magasin d'objets");
    return NOT_FOUND;
  }

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      // Type constaté à l'envoi, jamais celui annoncé par le client.
      "Content-Type": contact.photoMimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      // `private` : une photo de contact ne doit jamais être mise en cache par
      // un intermédiaire partagé. `no-cache` impose la revalidation par ETag.
      "Cache-Control": "private, no-cache, must-revalidate",
      ETag: etag,
      // Ceinture supplémentaire, même si le proxy pose déjà l'en-tête : le
      // navigateur ne doit jamais deviner un type à la place du nôtre.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
