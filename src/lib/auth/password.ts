import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * Hachage de mot de passe.
 *
 * Argon2id avec les paramètres recommandés par l'OWASP Password Storage Cheat
 * Sheet (19 MiB, 2 itérations, parallélisme 1). Le binding `@node-rs/argon2`
 * fournit des binaires précompilés : aucune chaîne de compilation dans l'image.
 *
 * Le sel est généré par la bibliothèque et intégré au hash encodé.
 */
const ARGON2_OPTIONS = {
  // `Algorithm.Argon2id` est un const enum ambiant, inutilisable sous
  // `isolatedModules` : on passe la valeur correspondante (2).
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;


export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    // Hash illisible ou corrompu : on refuse, sans faire remonter de détail.
    return false;
  }
}

/**
 * Vérification factice, exécutée quand l'email est inconnu.
 * Sans elle, un attaquant distinguerait « email inexistant » (réponse immédiate)
 * de « mot de passe faux » (réponse après un Argon2id complet).
 */
// Hash Argon2id valide d'une valeur aléatoire jetée : aucun mot de passe
// utilisable ne correspond, mais la vérification coûte le même temps qu'une vraie.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$BmuISA4Tq1yVSTFhWSrkXQ$cMAX0vI2Dw5abGB5C8Tt1Mgtn5rcCVY6aCmVUqbEtrQ";

export async function burnPasswordTime(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}
