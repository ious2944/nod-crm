import { prisma } from "@/lib/prisma";

/**
 * Sonde de santé, destinée au `HEALTHCHECK` du conteneur.
 *
 * Elle vérifie ce qui casse réellement en production : la liaison à la base.
 * Un processus Node vivant n'est pas une application saine — et la version
 * précédente de la sonde se contentait de charger `/login`, une page qui
 * s'affiche parfaitement pendant que PostgreSQL est injoignable. Le conteneur
 * restait `healthy` alors que rien ne fonctionnait.
 *
 * Ce que cette réponse ne contient pas est aussi important que ce qu'elle
 * contient : aucune version, aucun nom d'hôte, aucun message d'erreur, aucun
 * décompte. Un `ok` ou un `degraded`, rien d'autre. Le détail du diagnostic est
 * dans les journaux du conteneur, qui ne sont pas publics.
 *
 * Le VirtualHost refuse ce chemin depuis l'extérieur : la sonde tourne dans le
 * conteneur, sur la boucle locale. Rien n'oblige à offrir à Internet un moyen
 * de faire travailler la base.
 */

/** Au-delà, on considère la base injoignable plutôt que d'attendre. */
const PROBE_TIMEOUT_MS = 3_000;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export async function GET(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Une sonde qui reste suspendue est pire qu'une sonde qui échoue : Docker
    // finirait par la tuer, mais Nginx et l'opérateur, eux, attendraient.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
    });

    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);

    return Response.json({ status: "ok" }, { status: 200, headers: NO_STORE });
  } catch {
    // Le détail part dans les journaux du conteneur, jamais dans la réponse.
    console.error("[health] base de données injoignable");
    return Response.json({ status: "degraded" }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
