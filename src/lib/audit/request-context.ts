import "server-only";

import { headers } from "next/headers";

// Format UUID générique (peu importe la version) : on ne veut accepter que
// des valeurs qui passeront la colonne `request_id UUID` de `audit_logs`.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifiant de corrélation pour une écriture d'audit.
 *
 * Reprend l'en-tête `x-request-id` s'il est déjà présent (ex. injecté par un
 * reverse proxy en amont) et qu'il a la forme d'un UUID ; sinon en génère un
 * nouveau pour cet appel. Ne lève jamais : appelée hors contexte de requête
 * (script, tâche planifiée), `headers()` peut échouer — ce n'est pas une
 * raison pour faire échouer la mutation métier que cette fonction ne fait
 * qu'accompagner.
 */
export async function resolveRequestId(): Promise<string> {
  try {
    const incoming = (await headers()).get("x-request-id");
    if (incoming && UUID_PATTERN.test(incoming)) {
      return incoming;
    }
  } catch {
    // Hors contexte de requête HTTP : pas d'en-tête à lire, on retombe sur un
    // identifiant généré ci-dessous.
  }
  return crypto.randomUUID();
}
