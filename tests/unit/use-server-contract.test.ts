import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde structurelle sur les fichiers `"use server"`.
 *
 * Next.js impose qu'un tel fichier n'exporte QUE des fonctions asynchrones.
 * Exporter une constante ou une classe fait perdre au module la totalité de ses
 * exports, et l'application casse au premier import côté client.
 *
 * Cette erreur s'est produite deux fois dans l'histoire du projet : une
 * constante d'état initial au premier chantier, une classe d'erreur au second.
 * Le build la détecte, mais après plusieurs minutes et avec un message qui ne
 * nomme pas la cause. Ce test la nomme en une seconde.
 *
 * Les exports de types sont acceptés : ils disparaissent à la compilation.
 */

const ROOT = join(import.meta.dirname, "..", "..", "src");

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      // Le client Prisma généré n'est pas du code applicatif.
      return entry === "generated" ? [] : collectFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Un fichier « use server » a la directive sur sa première ligne de code. */
function isUseServerModule(source: string): boolean {
  const firstStatement = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));

  return firstStatement === '"use server";' || firstStatement === "'use server';";
}

/** Exports interdits : tout ce qui n'est ni un type ni une fonction asynchrone. */
function findForbiddenExports(source: string): string[] {
  const problems: string[] = [];

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("export")) continue;

    // Types, interfaces et ré-exports de types : effacés à la compilation.
    if (/^export\s+(type|interface)\b/.test(trimmed)) continue;
    if (/^export\s+type\s*\{/.test(trimmed)) continue;

    if (/^export\s+(default\s+)?async\s+function\b/.test(trimmed)) continue;
    if (/^export\s+(const|let|var)\s+\w+\s*[:=].*\basync\b/.test(trimmed)) continue;

    problems.push(trimmed.slice(0, 90));
  }

  return problems;
}

describe("contrat des fichiers « use server »", () => {
  const files = collectFiles(ROOT);
  const useServerFiles = files.filter((file) => isUseServerModule(readFileSync(file, "utf8")));

  it("trouve au moins un fichier « use server » à contrôler", () => {
    // Si ce test tombe à zéro, c'est que la détection est cassée — pas que le
    // projet n'a plus de Server Actions.
    expect(useServerFiles.length).toBeGreaterThan(0);
  });

  it.each(useServerFiles.map((file) => [relative(ROOT, file), file]))(
    "%s n'exporte que des fonctions asynchrones",
    (_label, file) => {
      const forbidden = findForbiddenExports(readFileSync(file, "utf8"));

      expect(
        forbidden,
        `Un fichier "use server" ne peut exporter que des fonctions asynchrones. ` +
          `Déplacez ces exports dans un module ordinaire (ex. src/lib/…) :\n  ` +
          forbidden.join("\n  "),
      ).toEqual([]);
    },
  );
});
