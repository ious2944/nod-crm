import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Régression : `next build` échouait sans `DATABASE_URL`.
 *
 * `src/lib/prisma.ts` créait le client à l'évaluation du module. Next charge
 * les modules d'une page pour collecter ses métadonnées au build — sans qu'une
 * seule requête ne parte — et la construction de l'image Docker s'arrêtait donc
 * sur « DATABASE_URL est manquant ». Le défaut était invisible en local, où un
 * `.env` traîne toujours ; il ne s'est révélé qu'au premier vrai `docker build`.
 *
 * Le contrat vérifié ici : importer le module sans base configurée doit
 * réussir ; seul un accès effectif doit échouer.
 */
describe("le module Prisma s'importe sans base de données", () => {
  const runWithoutDatabaseUrl = (source: string) => {
    const environment = { ...process.env };
    delete environment.DATABASE_URL;

    return spawnSync("npx", ["tsx", "--eval", source], {
      env: environment,
      encoding: "utf-8",
      timeout: 60_000,
    });
  };

  it("l'import seul ne lève pas", () => {
    const result = runWithoutDatabaseUrl(
      `import { prisma } from "./src/lib/prisma.ts";
       if (!prisma) throw new Error("module vide");
       console.log("IMPORT_OK");`,
    );

    expect(result.stdout).toContain("IMPORT_OK");
    expect(result.stderr).not.toContain("DATABASE_URL est manquant");
  });

  it("mais un accès réel échoue avec un message explicite", () => {
    const result = runWithoutDatabaseUrl(
      `import { prisma } from "./src/lib/prisma.ts";
       try { prisma.user; } catch (error) { console.log("MESSAGE:" + error.message); }`,
    );

    expect(result.stdout).toContain("MESSAGE:DATABASE_URL est manquant");
  });
});
