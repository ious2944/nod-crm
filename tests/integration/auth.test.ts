import { beforeEach, describe, expect, it } from "vitest";

import { login, logout } from "@/app/login/actions";
import { getCurrentUser } from "@/lib/auth/dal";
import { MAX_FAILURES_PER_EMAIL } from "@/lib/auth/rate-limit";
import { initialLoginState } from "@/lib/auth/schemas";
import { readSession, SESSION_ABSOLUTE_MS } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { cookieJar, TestRedirect } from "./cookie-jar";
import {
  createWorkspaceWithUser,
  DEV_SESSION_COOKIE,
  formData,
  resetDatabase,
  type TestUser,
} from "./fixtures";

const WRONG_PASSWORD = "ce-mot-de-passe-est-faux";

async function attemptLogin(email: string, password: string) {
  return login(initialLoginState, formData({ email, password }));
}

describe("connexion", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("auth-ws");
  });

  it("ouvre une session et redirige vers le cockpit", async () => {
    // `redirect()` interrompt l'action : c'est le signal de succès.
    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    const session = await readSession();
    expect(session?.email).toBe(user.email);
    expect(session?.workspaceId).toBe(user.workspaceId);
  });

  it("pose un cookie HttpOnly, SameSite et limité dans le temps", async () => {
    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    const cookie = cookieJar.inspect(DEV_SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.expires).toBeInstanceOf(Date);
    // L'expiration ne dépasse jamais la durée absolue.
    expect(cookie!.expires!.getTime() - Date.now()).toBeLessThanOrEqual(SESSION_ABSOLUTE_MS + 1000);
  });

  it("ne stocke jamais le jeton en clair en base", async () => {
    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    const token = cookieJar.get(DEV_SESSION_COOKIE)!.value;
    const rows = await prisma.session.findMany({ select: { tokenHash: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuse un mauvais mot de passe sans ouvrir de session", async () => {
    const result = await attemptLogin(user.email, WRONG_PASSWORD);

    expect(result.status).toBe("error");
    expect(cookieJar.names()).toHaveLength(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("répond la même chose pour un compte inexistant et un mot de passe faux", async () => {
    const unknown = await attemptLogin("personne@nulle-part.test", WRONG_PASSWORD);
    const wrong = await attemptLogin(user.email, WRONG_PASSWORD);

    // Sinon, l'écran de connexion devient un oracle d'énumération de comptes.
    expect(unknown.message).toBe(wrong.message);
  });

  it("refuse un compte désactivé", async () => {
    const disabled = await createWorkspaceWithUser("auth-off", "Mot-De-Passe-Test-2026!", {
      isActive: false,
    });

    const result = await attemptLogin(disabled.email, disabled.password);

    expect(result.status).toBe("error");
    expect(await prisma.session.count()).toBe(0);
  });

  it("rejette une adresse email malformée", async () => {
    const result = await attemptLogin("pas-une-adresse", user.password);
    expect(result.status).toBe("error");
  });
});

describe("session", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("session-ws");
    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);
  });

  it("invalide la session au logout, côté serveur et côté cookie", async () => {
    await expect(logout()).rejects.toThrow(TestRedirect);

    expect(cookieJar.names()).toHaveLength(0);
    expect(await prisma.session.count()).toBe(0);
    expect(await readSession()).toBeNull();
  });

  it("refuse une session expirée (expiration absolue)", async () => {
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await readSession()).toBeNull();
    // La ligne morte est supprimée au passage.
    expect(await prisma.session.count()).toBe(0);
  });

  it("refuse une session inactive trop longtemps", async () => {
    await prisma.session.updateMany({ data: { idleExpiresAt: new Date(Date.now() - 1000) } });

    expect(await readSession()).toBeNull();
  });

  it("refuse une session révoquée", async () => {
    await prisma.session.updateMany({ data: { revokedAt: new Date() } });

    expect(await readSession()).toBeNull();
  });

  it("refuse la session d'un compte désactivé entre-temps", async () => {
    await prisma.user.update({ where: { id: user.userId }, data: { isActive: false } });

    expect(await readSession()).toBeNull();
  });

  it("refuse un jeton forgé", async () => {
    cookieJar.set(DEV_SESSION_COOKIE, "jeton-inventé-de-toutes-pièces");

    expect(await readSession()).toBeNull();
  });

  it("ne renvoie aucune donnée sensible au reste de l'application", async () => {
    const session = await getCurrentUser();

    expect(session).not.toBeNull();
    expect(Object.keys(session!).sort()).toEqual(
      ["displayName", "email", "id", "sessionId", "workspaceId", "workspaceName"].sort(),
    );
  });
});

describe("limitation de débit du login", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("throttle-ws");
  });

  it("bloque le compte après le seuil d'échecs, même avec le bon mot de passe", async () => {
    for (let attempt = 0; attempt < MAX_FAILURES_PER_EMAIL; attempt += 1) {
      const result = await attemptLogin(user.email, WRONG_PASSWORD);
      expect(result.status).toBe("error");
    }

    const blocked = await attemptLogin(user.email, user.password);
    expect(blocked.status).toBe("error");
    expect(blocked.message).toMatch(/Trop de tentatives/);
    expect(await prisma.session.count()).toBe(0);
  });

  it("remet les compteurs à zéro après une connexion réussie", async () => {
    await attemptLogin(user.email, WRONG_PASSWORD);
    await attemptLogin(user.email, WRONG_PASSWORD);

    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    const remaining = await prisma.loginAttempt.count({
      where: { scope: `email:${user.email}` },
    });
    expect(remaining).toBe(0);
  });

  it("ne journalise ni mot de passe ni hash dans les tentatives", async () => {
    await attemptLogin(user.email, WRONG_PASSWORD);

    const attempts = await prisma.loginAttempt.findMany();
    const serialized = JSON.stringify(attempts);
    expect(serialized).not.toContain(WRONG_PASSWORD);
    expect(serialized).not.toContain("argon2");
    // L'IP n'apparaît qu'en empreinte.
    expect(serialized).not.toContain("203.0.113.10");
  });
});
