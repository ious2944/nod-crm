import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Même stub que la suite d'intégration : `server-only` lève à l'import
      // hors d'un bundle Next, ce qui rend intestable tout module qui l'importe
      // — y compris ceux dont c'est justement la logique qu'on veut couvrir.
      "server-only": fileURLToPath(
        new URL("./tests/integration/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
