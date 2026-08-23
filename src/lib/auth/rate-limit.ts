import "server-only";

import { prisma } from "@/lib/prisma";
import { hmac } from "./secret";

/**
 * Limitation de débit du login, stockée en base.
 *
 * Choix assumé : pas de Redis. L'application est mono-instance et PostgreSQL est
 * déjà là. Le compteur survit à un redémarrage du conteneur, ce qu'un compteur
 * en mémoire ne ferait pas.
 *
 * Deux compteurs indépendants :
 *  - par email, contre le bourrinage d'un compte précis ;
 *  - par IP, contre le balayage de nombreux comptes depuis une même source.
 *
 * Le seuil par IP est nettement plus haut : plusieurs personnes peuvent partager
 * une sortie NAT, et on ne veut pas de faux positif sur un bureau entier.
 * Nginx (`limit_req`) et Fail2ban traitent la couche réseau en amont ; ceci est
 * la dernière ligne, applicative.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 30;
/** Les tentatives plus vieilles que ceci sont supprimées opportunément. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RateLimitVerdict {
  blocked: boolean;
  /** Secondes avant la prochaine tentative autorisée, si bloqué. */
  retryAfterSeconds: number;
}

function emailScope(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

function ipScope(ip: string): string {
  // L'IP n'est jamais stockée en clair : seule son empreinte sert de clé.
  return `ip:${hmac(ip)}`;
}

async function countFailures(scope: string, since: Date): Promise<number> {
  return prisma.loginAttempt.count({
    where: { scope, successful: false, createdAt: { gte: since } },
  });
}

async function oldestFailure(scope: string, since: Date): Promise<Date | null> {
  const attempt = await prisma.loginAttempt.findFirst({
    where: { scope, successful: false, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return attempt?.createdAt ?? null;
}

/** À appeler avant toute vérification de mot de passe. */
export async function checkLoginRateLimit(
  email: string,
  ip: string | null,
): Promise<RateLimitVerdict> {
  const since = new Date(Date.now() - WINDOW_MS);

  const scopes: Array<{ scope: string; max: number }> = [
    { scope: emailScope(email), max: MAX_FAILURES_PER_EMAIL },
  ];
  if (ip) scopes.push({ scope: ipScope(ip), max: MAX_FAILURES_PER_IP });

  for (const { scope, max } of scopes) {
    const failures = await countFailures(scope, since);
    if (failures < max) continue;

    const oldest = await oldestFailure(scope, since);
    const releaseAt = (oldest?.getTime() ?? Date.now()) + WINDOW_MS;
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((releaseAt - Date.now()) / 1000)),
    };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

/** Enregistre l'issue d'une tentative. Aucun mot de passe n'est journalisé. */
export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  successful: boolean,
): Promise<void> {
  const rows = [{ scope: emailScope(email), successful }];
  if (ip) rows.push({ scope: ipScope(ip), successful });

  await prisma.loginAttempt.createMany({ data: rows });
}

/** Une connexion réussie remet les compteurs de ce compte à zéro. */
export async function clearLoginFailures(email: string, ip: string | null): Promise<void> {
  const scopes = [emailScope(email)];
  if (ip) scopes.push(ipScope(ip));
  await prisma.loginAttempt.deleteMany({ where: { scope: { in: scopes } } });
}

/** Nettoyage de l'historique, déclenché après chaque connexion réussie. */
export async function purgeOldLoginAttempts(): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
  });
}
