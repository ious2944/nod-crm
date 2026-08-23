import { describe, expect, it } from "vitest";

import { login } from "@/app/login/actions";
import { initialLoginState } from "@/lib/auth/schemas";
import { readSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { TestRedirect } from "./cookie-jar";
import { formData } from "./fixtures";

/**
 * Bout de chaîne : un compte créé par `scripts/admin.mjs` doit permettre de se
 * connecter à l'application.
 *
 * La CLI hache le mot de passe avec sa propre copie des paramètres Argon2id ;
 * l'application le vérifie avec les siennes. Rien ne garantit statiquement
 * qu'elles concordent — et elles ont déjà divergé une fois, quand
 * `Algorithm.Argon2id` (const enum ambiant) valait `undefined` à l'exécution.
 *
 * Ce test n'est exécuté que par `tests/pty/admin-cli.py`, qui crée d'abord le
 * compte dans un vrai pseudo-terminal et fournit `CLI_EMAIL` / `CLI_PASSWORD`.
 */
const email = process.env.CLI_EMAIL;
const password = process.env.CLI_PASSWORD;

describe.runIf(email && password)("compte créé par la CLI", () => {
  it("est stocké avec un hachage Argon2id", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email! } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.isActive).toBe(true);
  });

  it("permet de se connecter à l'application", async () => {
    await expect(
      login(initialLoginState, formData({ email: email!, password: password! })),
    ).rejects.toThrow(TestRedirect);

    const session = await readSession();
    expect(session?.email).toBe(email!.toLowerCase());
  });

  it("refuse un autre mot de passe", async () => {
    const result = await login(
      initialLoginState,
      formData({ email: email!, password: `${password!}-faux` }),
    );
    expect(result.status).toBe("error");
  });
});
