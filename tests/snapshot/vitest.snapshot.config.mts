import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Instantané de non-régression du lot A (`run-owner-snapshot.sh`). Même
 * amorçage que les tests d'intégration, mais sans aucune remise à zéro : la
 * base est préparée par le script.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../integration/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    include: ["tests/snapshot/**/*.dump.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 60_000,
  },
});
