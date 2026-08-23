import "server-only";

import { createHmac } from "node:crypto";

/**
 * `AUTH_SECRET` sert de poivre côté serveur : la base ne stocke que
 * `HMAC-SHA256(jeton, AUTH_SECRET)`. Une fuite de la base seule ne suffit donc
 * pas à forger un cookie de session valide, il faut aussi le secret.
 *
 * En production le secret est obligatoire. En développement et en test, une
 * valeur de repli permet de démarrer sans configuration — jamais en production.
 */
const DEV_FALLBACK_SECRET = "nod-crm-development-only-secret-do-not-use-in-production";
const MIN_SECRET_LENGTH = 32;

/**
 * Valeurs de remplacement livrées dans le dépôt public.
 *
 * `.env.example` est lisible par tout le monde : un secret laissé tel quel n'en
 * est pas un, et il est assez long pour passer le contrôle de taille. On refuse
 * donc explicitement les gabarits, plutôt que de laisser une instance tourner
 * avec un poivre de session que n'importe qui peut lire sur GitHub.
 */
const PLACEHOLDER_PATTERNS = [
  /change-?me/i,
  /your-secret-here/i,
  // Les valeurs injectées pour construire l'image et pour la CI : le build a
  // besoin d'*une* valeur, jamais d'un vrai secret. Aucune ne devrait atteindre
  // un serveur en production — et si l'une y arrive, c'est exactement le genre
  // de fuite silencieuse qu'on veut voir échouer au démarrage.
  /placeholder/i,
];

function isPlaceholder(secret: string): boolean {
  return secret === DEV_FALLBACK_SECRET || PLACEHOLDER_PATTERNS.some((p) => p.test(secret));
}

let cached: string | null = null;

export function getAuthSecret(): string {
  if (cached) return cached;

  const secret = process.env.AUTH_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProduction) {
      throw new Error(
        "AUTH_SECRET est absent. Générez-le avec `openssl rand -base64 48` et fournissez-le via l'environnement de production.",
      );
    }
    cached = DEV_FALLBACK_SECRET;
    return cached;
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `AUTH_SECRET est trop court (${secret.length} caractères, minimum ${MIN_SECRET_LENGTH}).`,
    );
  }

  if (isProduction && isPlaceholder(secret)) {
    throw new Error(
      "AUTH_SECRET utilise une valeur d'exemple : refusé en production. " +
        "Générez-en un avec `openssl rand -base64 48` (ou lancez ./scripts/init-env.sh).",
    );
  }

  cached = secret;
  return cached;
}

/** Empreinte stockée en base pour un jeton de session. */
export function hmac(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}
