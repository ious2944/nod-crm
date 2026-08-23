/**
 * Constantes d'authentification sans dépendance : ce module est importable
 * depuis un composant client, contrairement à `password.ts` qui charge Argon2id
 * et ne doit jamais atteindre le navigateur.
 *
 * La politique de robustesse des mots de passe vit dans `scripts/admin.mjs` :
 * c'est le seul endroit qui en fixe un. L'application n'en crée jamais.
 */

/** Borne haute appliquée à la connexion, pour ne pas offrir Argon2id en DoS. */
export const MAX_PASSWORD_LENGTH = 256;
