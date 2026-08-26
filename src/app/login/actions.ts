"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { logAuthEvent } from "@/lib/auth/audit-log";
import { getClientIp } from "@/lib/auth/client-ip";
import { getCurrentUser } from "@/lib/auth/dal";
import { burnPasswordTime, verifyPassword } from "@/lib/auth/password";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  purgeOldLoginAttempts,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
import { loginSchema, type LoginState } from "@/lib/auth/schemas";
import { createSession, destroySession, purgeExpiredSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/**
 * Message unique pour tous les refus de connexion.
 * Ne jamais distinguer « email inconnu », « mot de passe faux » et « compte
 * désactivé » : ce serait un oracle d'énumération de comptes.
 */
const GENERIC_FAILURE = "Adresse email ou mot de passe incorrect.";

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: GENERIC_FAILURE };
  }

  const { email, password } = parsed.data;
  const ip = await getClientIp();

  const verdict = await checkLoginRateLimit(email, ip);
  if (verdict.blocked) {
    logAuthEvent("login.blocked", { email, ip });
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return {
      status: "error",
      message: `Trop de tentatives. Réessaie dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!user) {
    // Même coût de calcul que pour un compte existant : pas de fuite par timing.
    await burnPasswordTime(password);
    await recordLoginAttempt(email, ip, false);
    logAuthEvent("login.failed", { email, ip });
    return { status: "error", message: GENERIC_FAILURE };
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid || !user.isActive) {
    await recordLoginAttempt(email, ip, false);
    logAuthEvent(user.isActive ? "login.failed" : "login.inactive", { email, ip });
    return { status: "error", message: GENERIC_FAILURE };
  }

  await clearLoginFailures(email, ip);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await createSession(user.id, {
    userAgent: (await headers()).get("user-agent"),
    ip,
  });

  // Entretien courant, hors du chemin critique de la lecture.
  await purgeExpiredSessions();
  await purgeOldLoginAttempts();

  logAuthEvent("login.success", { email, ip });
  redirect("/today");
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();

  if (user) {
    logAuthEvent("logout", { email: user.email, ip: await getClientIp() });
  }

  redirect("/login");
}
