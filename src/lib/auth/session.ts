import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { hmac } from "./secret";

/** Nom du cookie. Le préfixe `__Host-` impose Secure + Path=/ + pas de Domain. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-nod_session" : "nod_session";

/** Durée de vie absolue : la session meurt même si elle est utilisée en continu. */
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** Durée d'inactivité tolérée avant expiration. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
/** Le rafraîchissement d'inactivité n'écrit en base qu'au-delà de ce délai. */
const REFRESH_THROTTLE_MS = 5 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
}

/** Contexte de création, purement indicatif ; l'IP n'est jamais stockée en clair. */
export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** Invalide la session courante côté serveur *et* supprime le cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hmac(token) } });
  }

  // Un cookie `__Host-` ne peut être écrasé que par un cookie portant
  // exactement les mêmes attributs, `Secure` compris : un `delete()` sans
  // `secure` est ignoré par le navigateur et le cookie survit à la déconnexion.
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Crée une session et pose le cookie.
 * Le jeton brut n'existe que dans le cookie ; la base n'en garde que le HMAC.
 */
export async function createSession(
  userId: string,
  context: SessionContext = {},
): Promise<void> {
  // La session éventuellement présente dans ce navigateur est détruite avant
  // d'en ouvrir une nouvelle. Deux raisons : ne pas accumuler des sessions
  // vivantes à chaque reconnexion, et ne laisser aucune chance à un jeton
  // déposé avant l'authentification de survivre à celle-ci (fixation de session).
  await destroySession();

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_ABSOLUTE_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hmac(token),
      expiresAt,
      idleExpiresAt: new Date(now + SESSION_IDLE_MS),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ipHash: context.ip ? hmac(context.ip) : null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/**
 * Résout la session courante. Retourne `null` si le cookie est absent,
 * inconnu, révoqué ou expiré (expiration absolue ou inactivité).
 *
 * C'est le seul endroit qui fait autorité : la vérification du `proxy` n'est
 * qu'un filtre optimiste.
 */
export async function readSession(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hmac(token) },
    select: {
      id: true,
      expiresAt: true,
      idleExpiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          isActive: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      },
    },
  });

  if (!session) return null;

  const now = new Date();
  const invalid =
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.idleExpiresAt <= now ||
    !session.user.isActive;

  if (invalid) {
    // Une session inutilisable est supprimée immédiatement : elle ne doit pas
    // pouvoir redevenir valide, et cela nettoie la table au fil de l'eau.
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now.getTime() - session.lastUsedAt.getTime() > REFRESH_THROTTLE_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: {
        lastUsedAt: now,
        // L'inactivité repart de zéro, mais jamais au-delà de l'expiration absolue.
        idleExpiresAt: new Date(
          Math.min(now.getTime() + SESSION_IDLE_MS, session.expiresAt.getTime()),
        ),
      },
    });
  }

  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    workspaceId: session.user.workspaceId,
    workspaceName: session.user.workspace.name,
    sessionId: session.id,
  };
}

/** Purge des sessions mortes — appelée à chaque connexion réussie. */
export async function purgeExpiredSessions(): Promise<void> {
  const now = new Date();
  await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { idleExpiresAt: { lte: now } }] },
  });
}
