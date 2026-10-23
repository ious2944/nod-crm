import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "@/app/login/actions";
import { burnPasswordTime, verifyPassword } from "@/lib/auth/password";
import { MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP } from "@/lib/auth/rate-limit";
import { initialLoginState } from "@/lib/auth/schemas";
import { hmac } from "@/lib/auth/secret";
import { prisma } from "@/lib/prisma";

import { TestRedirect } from "./cookie-jar";
import { createWorkspaceWithUser, formData, resetDatabase, type TestUser } from "./fixtures";

/**
 * Limitation de débit du login : requêtes simultanées, compteur par IP et
 * empreinte d'IP des journaux.
 *
 * Les fonctions de vérification de mot de passe sont enveloppées pour compter
 * les évaluations réellement effectuées, sans changer leur comportement.
 */
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/password")>();
  return {
    ...original,
    verifyPassword: vi.fn(original.verifyPassword),
    burnPasswordTime: vi.fn(original.burnPasswordTime),
  };
});

const WRONG_PASSWORD = "ce-mot-de-passe-est-faux";
// Valeur posée par `setup.ts` sur l'en-tête `x-real-ip`.
const TEST_IP = "203.0.113.10";

async function attemptLogin(email: string, password: string) {
  return login(initialLoginState, formData({ email, password }));
}

function passwordEvaluations(): number {
  return vi.mocked(verifyPassword).mock.calls.length + vi.mocked(burnPasswordTime).mock.calls.length;
}

function ipFailures(): Promise<number> {
  return prisma.loginAttempt.count({ where: { scope: `ip:${hmac(TEST_IP)}`, successful: false } });
}

describe("limitation de débit du login — requêtes simultanées", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("throttle-burst-ws");
    vi.mocked(verifyPassword).mockClear();
    vi.mocked(burnPasswordTime).mockClear();
  });

  it(`n'évalue pas plus de ${MAX_FAILURES_PER_EMAIL} mots de passe pour 20 tentatives simultanées sur un compte`, async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => attemptLogin(user.email, WRONG_PASSWORD)),
    );

    const evaluated = passwordEvaluations();
    expect(results.every((result) => result.status === "error")).toBe(true);
    expect(evaluated).toBeLessThanOrEqual(MAX_FAILURES_PER_EMAIL);
    expect(results.filter((result) => /Trop de tentatives/.test(result.message ?? ""))).toHaveLength(
      20 - evaluated,
    );

    // Selon l'ordre d'arrivée, une rafale peut même être refusée en entier :
    // seul le plafond compte. Les tentatives refusées ne pèsent pas sur les
    // compteurs.
    const accountFailures = await prisma.loginAttempt.count({
      where: { scope: `email:${user.email}`, successful: false },
    });
    expect(accountFailures).toBe(evaluated);
  });

  it("bloque le compte une fois le seuil atteint, même pour une rafale suivante", async () => {
    for (let attempt = 0; attempt < MAX_FAILURES_PER_EMAIL; attempt += 1) {
      await attemptLogin(user.email, WRONG_PASSWORD);
    }
    vi.mocked(verifyPassword).mockClear();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => attemptLogin(user.email, user.password)),
    );

    expect(results.every((result) => /Trop de tentatives/.test(result.message ?? ""))).toBe(true);
    expect(passwordEvaluations()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("vide le compteur du compte après une connexion réussie", async () => {
    await attemptLogin(user.email, WRONG_PASSWORD);
    await attemptLogin(user.email, WRONG_PASSWORD);

    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    expect(await prisma.loginAttempt.count({ where: { scope: `email:${user.email}` } })).toBe(0);
  });
});

describe("limitation de débit du login — compteur par IP", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("throttle-ip-ws");
  });

  it("conserve le compteur de l'IP après une connexion réussie", async () => {
    const failures = MAX_FAILURES_PER_IP - 1;
    // Une adresse différente à chaque fois : seul le compteur par IP monte.
    for (let attempt = 0; attempt < failures; attempt += 1) {
      const result = await attemptLogin(`inconnu-${attempt}@nulle-part.test`, WRONG_PASSWORD);
      expect(result.status).toBe("error");
    }
    expect(await ipFailures()).toBe(failures);

    await expect(attemptLogin(user.email, user.password)).rejects.toThrow(TestRedirect);

    // La connexion réussie n'efface rien et ne compte pas comme un échec.
    expect(await ipFailures()).toBe(failures);

    // Un échec de plus atteint le seuil : l'IP est ensuite bloquée.
    await attemptLogin("encore-un@nulle-part.test", WRONG_PASSWORD);
    const blocked = await attemptLogin("dernier@nulle-part.test", WRONG_PASSWORD);
    expect(blocked.message).toMatch(/Trop de tentatives/);
  });
});

describe("journal d'authentification — empreinte de l'IP", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("throttle-log-ws");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("écrit une empreinte HMAC de l'IP, pas un SHA-256 simple", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await attemptLogin(user.email, WRONG_PASSWORD);

    const lines = info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[auth]"));
    expect(lines).toHaveLength(1);
    const src = /src=(\S+)/.exec(lines[0])?.[1];

    expect(src).toBe(hmac(TEST_IP).slice(0, 12));
    expect(src).not.toBe(createHash("sha256").update(TEST_IP).digest("hex").slice(0, 12));
    expect(lines[0]).not.toContain(TEST_IP);
  });
});
