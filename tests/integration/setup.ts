import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, vi } from "vitest";

import { cookieJar, headerJar, TestRedirect } from "./cookie-jar";

/**
 * Amorçage commun des tests d'intégration.
 *
 * On force `DATABASE_URL` sur la base de test *avant* que le moindre module
 * applicatif ne soit importé : `src/lib/prisma.ts` lit la variable au premier
 * import et garde le client en mémoire.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL est obligatoire pour les tests d'intégration. " +
      "Utilisez une base dédiée : la suite vide les tables entre les fichiers.",
  );
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === TEST_DATABASE_URL) {
  // Garde-fou : on ne veut jamais tronquer la base de développement.
  console.warn("[tests] TEST_DATABASE_URL et DATABASE_URL sont identiques.");
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "secret-de-test-suffisamment-long-pour-passer-la-validation";

/**
 * Les photos de contacts partent dans un répertoire jetable. Comme pour
 * `DATABASE_URL`, la variable doit être posée AVANT le premier import de
 * `src/lib/storage`, qui la lit au chargement du module.
 */
process.env.NOD_UPLOAD_DIR ??= mkdtempSync(path.join(tmpdir(), "nod-uploads-"));
// `NODE_ENV` est typé en lecture seule : on passe par l'objet pour le forcer.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

/**
 * Ces trois modules Next exigent un contexte de requête que Vitest n'a pas.
 * On les remplace par des équivalents observables, ce qui permet de tester les
 * Server Actions comme de vraies fonctions — avec la vraie base derrière.
 */
vi.mock("next/headers", () => ({
  cookies: async () => cookieJar,
  headers: async () => headerJar,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new TestRedirect(location);
  },
}));

beforeAll(() => {
  headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10" });
});
