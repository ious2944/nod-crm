import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AUTH_SECRET` est le poivre HMAC des jetons de session : le connaître suffit,
 * avec une copie de la base, à forger un cookie valide.
 *
 * Depuis que NOD CRM est public, `.env.example` est lisible par tout le monde.
 * Une instance qui démarrerait avec la valeur d'exemple offrirait donc un
 * secret de session que n'importe qui peut lire sur GitHub. Ces tests
 * verrouillent le refus, parce qu'un `.env` recopié sans être relu est le
 * chemin le plus fréquent vers une instance ouverte.
 *
 * Le module met son secret en cache : chaque cas ré-importe une instance neuve.
 */
const ORIGINAL_ENV = { ...process.env };

async function loadSecretModule() {
  // Le module mémorise son secret dans une variable de portée fichier : sans
  // vider le registre, le premier cas figerait la valeur pour tous les autres.
  vi.resetModules();
  return import("@/lib/auth/secret");
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string | undefined>)[key] = value;
  }
}

beforeEach(() => {
  setEnv({ AUTH_SECRET: undefined, NODE_ENV: undefined });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete (process.env as Record<string, string | undefined>)[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("getAuthSecret", () => {
  it("refuse un secret absent en production", async () => {
    setEnv({ NODE_ENV: "production" });
    const { getAuthSecret } = await loadSecretModule();
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET est absent/);
  });

  it("refuse un secret trop court, quel que soit l'environnement", async () => {
    setEnv({ AUTH_SECRET: "trop-court" });
    const { getAuthSecret } = await loadSecretModule();
    expect(() => getAuthSecret()).toThrow(/trop court/);
  });

  it.each([
    // La valeur livrée dans `.env.example`, et ses variantes probables.
    "change-me-with-a-long-random-secret",
    "CHANGE-ME-WITH-A-LONG-RANDOM-SECRET-UPPERCASE",
    "changeme-but-still-the-example-value-from-the-repo",
    // Le repli de développement.
    "nod-crm-development-only-secret-do-not-use-in-production",
    // Les valeurs injectées par le Dockerfile et par la CI pour construire :
    // elles ne devraient jamais atteindre un serveur, et doivent échouer
    // bruyamment si elles y arrivent.
    "build-time-placeholder-value-not-used-at-runtime",
    "ci-build-placeholder-not-used-at-runtime-32chars",
  ])("refuse la valeur d'exemple « %s » en production", async (placeholder) => {
    setEnv({ NODE_ENV: "production", AUTH_SECRET: placeholder });
    const { getAuthSecret } = await loadSecretModule();
    expect(() => getAuthSecret()).toThrow(/valeur d'exemple|développement/);
  });

  it("accepte un secret réel en production", async () => {
    const real = "Zx9/QpL2mN4vR7tY1uI3oP6aS8dF0gH5jK2lZ9xC4vB7nM1qW3e";
    setEnv({ NODE_ENV: "production", AUTH_SECRET: real });
    const { getAuthSecret, hmac } = await loadSecretModule();
    expect(getAuthSecret()).toBe(real);
    // Le HMAC doit être stable et ne jamais restituer la valeur d'entrée.
    expect(hmac("jeton")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac("jeton")).toBe(hmac("jeton"));
    expect(hmac("jeton")).not.toContain(real);
  });

  it("tolère la valeur de repli hors production", async () => {
    setEnv({ NODE_ENV: "test" });
    const { getAuthSecret } = await loadSecretModule();
    expect(getAuthSecret().length).toBeGreaterThanOrEqual(32);
  });
});
