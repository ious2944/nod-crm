import "server-only";

/**
 * Journalisation des événements d'authentification.
 *
 * Règle unique : ne jamais écrire de secret. Sont interdits ici — et nulle part
 * ailleurs dans le code — le mot de passe, son hash, le jeton de session, le
 * cookie complet, l'en-tête Authorization et la `DATABASE_URL`.
 *
 * On journalise juste assez pour détecter un abus : l'événement, l'email
 * masqué, et une empreinte courte de l'IP (jamais l'IP en clair, qui est une
 * donnée personnelle sans valeur ajoutée pour la détection).
 */
import { createHash } from "node:crypto";

type AuthEvent =
  | "login.success"
  | "login.failed"
  | "login.blocked"
  | "login.inactive"
  | "logout";

/** `alice.martin@example.com` → `a***e@example.com`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.length <= 2 ? local[0] ?? "*" : `${local[0]}***${local.at(-1)}`;
  return `${visible}@${domain}`;
}

/** Empreinte courte et non réversible en pratique, suffisante pour corréler. */
function fingerprint(value: string | null): string {
  if (!value) return "unknown";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function logAuthEvent(
  event: AuthEvent,
  details: { email?: string; ip?: string | null },
): void {
  const parts = [`event=${event}`];
  if (details.email) parts.push(`account=${maskEmail(details.email)}`);
  parts.push(`src=${fingerprint(details.ip ?? null)}`);

  // Sortie standard : récupérée par les logs Docker, sans fichier à gérer.
  console.info(`[auth] ${parts.join(" ")}`);
}
