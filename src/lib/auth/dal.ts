import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { readSession, type AuthenticatedUser } from "./session";

/**
 * Data Access Layer.
 *
 * Toute lecture et toute mutation métier passe par une de ces fonctions. Le
 * `proxy` ne fait qu'un filtrage optimiste sur la présence du cookie ; c'est ici
 * que la session est réellement vérifiée, au plus près des données.
 *
 * `cache()` déduplique l'appel au sein d'une même requête : une page qui
 * appelle `requireUser()` dans le layout et dans la page ne lit la session
 * qu'une fois.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  return readSession();
});

/** Pour une page : sans session valide, on renvoie vers l'écran de connexion. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Erreur levée par une mutation appelée sans session. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentification requise.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Pour une Server Action : on échoue franchement plutôt que de rediriger.
 * Une action POSTée directement, sans passer par l'interface, doit être rejetée.
 */
export async function requireActor(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
