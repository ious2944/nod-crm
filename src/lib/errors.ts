/**
 * Hiérarchie d'erreurs applicatives.
 *
 * Partagées entre les Server Actions (où elles sont levées) et le client
 * (`useRowActions`, où elles sont interceptées) pour permettre une
 * discrimination précise dans les blocs `catch`.
 *
 * NOTA — sérialisation Next.js : lors du transit Server Action → client,
 * la chaîne prototypale est perdue. `instanceof` fonctionne pour les erreurs
 * levées côté client ; pour les erreurs venant du serveur, le bloc catch
 * vérifie également `error.name`. Les deux sont combinés ci-dessous pour
 * être robuste dans les deux cas.
 *
 * Ce fichier n'a pas de directive `"use server"` et peut donc exporter des
 * classes, contrairement aux fichiers d'actions.
 */

/** Conflit de version : l'enregistrement a été modifié entre la lecture et l'écriture. */
export class ConflictError extends Error {
  constructor(
    message = "Un autre onglet ou utilisateur a peut-être modifié cet élément.",
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Erreur de validation : au moins un champ du formulaire est invalide. */
export class ValidationError extends Error {
  /** Nom du champ concerné, si disponible. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** Erreur réseau : la requête n'a pas pu aboutir (pas de connexion, timeout…). */
export class NetworkError extends Error {
  constructor(message = "Impossible de joindre le serveur.") {
    super(message);
    this.name = "NetworkError";
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Retourne `true` si l'erreur est un conflit de version.
 *
 * Vérifie à la fois `instanceof` (erreurs locales) et `error.name` (erreurs
 * re-construites après sérialisation depuis un Server Action).
 */
export function isConflictError(error: unknown): boolean {
  if (error instanceof ConflictError) return true;
  if (
    error instanceof Error &&
    // FollowUpConflictError, TaskConflictError, etc. sont compatibles
    (error.name === "ConflictError" ||
      error.name === "FollowUpConflictError" ||
      error.name === "TaskConflictError")
  )
    return true;
  return false;
}

/** Retourne `true` si l'erreur est une erreur de validation. */
export function isValidationError(error: unknown): error is ValidationError {
  if (error instanceof ValidationError) return true;
  if (error instanceof Error && error.name === "ValidationError") return true;
  return false;
}

/** Retourne `true` si l'erreur est une erreur réseau. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  // TypeError levée par fetch() en cas de réseau coupé
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "NetworkError") return true;
  return false;
}
