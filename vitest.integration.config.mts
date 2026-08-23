import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests d'intégration : ils parlent à un vrai PostgreSQL.
 *
 * Séparés des tests unitaires (`vitest.config.mts`) parce qu'ils exigent une
 * base accessible. `TEST_DATABASE_URL` doit pointer sur une base **dédiée** :
 * la suite tronque les tables entre les fichiers.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/integration/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Les tests partagent une base : ils s'exécutent en série.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
