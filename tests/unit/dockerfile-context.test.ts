import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Le Dockerfile ne peut copier que ce que le dépôt contient réellement.
 *
 * Ce test existe à cause d'une panne concrète : le `Dockerfile` copiait
 * `public/`, un répertoire créé vide par `create-next-app`. Git ne versionne
 * pas les répertoires vides — il n'a donc jamais été poussé. Toutes les
 * constructions locales réussissaient, parce que le répertoire traînait dans
 * le contexte de build ; la première construction depuis un clone propre, sur
 * le VPS, a échoué sur `"/public": not found`.
 *
 * La leçon n'est pas « ne pas oublier public/ » mais : ce qui est copié depuis
 * le contexte de build doit être ce que `git clone` produit, et rien d'autre.
 * Un test qui interroge Git plutôt que le disque est le seul moyen de s'en
 * assurer depuis une machine de développement.
 */

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function trackedPaths(): Set<string> {
  const output = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const files = output.split("\n").filter(Boolean);
  const paths = new Set<string>(files);
  // Un `COPY prisma ./prisma` est satisfait dès qu'un fichier vit sous
  // `prisma/` : on enregistre donc aussi chaque répertoire parent.
  for (const file of files) {
    const segments = file.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      paths.add(segments.slice(0, i).join("/"));
    }
  }
  return paths;
}

/** Sources d'un `COPY` qui proviennent du contexte de build, pas d'un stage. */
function contextCopySources(dockerfile: string): { line: number; source: string }[] {
  const found: { line: number; source: string }[] = [];

  dockerfile.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line)) return;

    const tokens = line.split(/\s+/).slice(1);
    // `--from=builder` désigne un stage précédent : son contenu est produit
    // pendant la construction, pas repris du dépôt.
    if (tokens.some((token) => /^--from=/i.test(token))) return;

    const operands = tokens.filter((token) => !token.startsWith("--"));
    // Le dernier opérande est la destination.
    for (const source of operands.slice(0, -1)) {
      if (source === ".") continue; // le contexte entier, toujours disponible
      found.push({ line: index + 1, source });
    }
  });

  return found;
}

describe("Dockerfile et contexte de build", () => {
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  const sources = contextCopySources(dockerfile);
  const tracked = trackedPaths();

  it("copie au moins un chemin depuis le contexte (le test ne passe pas à vide)", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)("COPY ligne $line : « $source » est versionné", ({ source }) => {
    // Un répertoire vide, ou un fichier ignoré, est présent en développement et
    // absent du clone : c'est exactement le piège que ce test ferme.
    expect(tracked.has(source.replace(/\/$/, ""))).toBe(true);
  });

  it("le chemin sondé par HEALTHCHECK est accessible sans session", () => {
    // Une sonde redirigée vers /login obtiendrait un 200 et déclarerait
    // l'application saine quel que soit son état : elle réussirait par
    // accident. Le lien entre le Dockerfile et le proxy est donc un contrat.
    const probe = /HEALTHCHECK[\s\S]*?fetch\('http:\/\/127\.0\.0\.1:3000([^']+)'/.exec(dockerfile);
    expect(probe, "aucune sonde HTTP trouvée dans le HEALTHCHECK").not.toBeNull();

    const proxy = readFileSync(new URL("../../src/proxy.ts", import.meta.url), "utf8");
    const publicPaths = /const PUBLIC_PATHS = \[([^\]]*)\]/.exec(proxy);
    expect(publicPaths, "PUBLIC_PATHS introuvable dans src/proxy.ts").not.toBeNull();

    expect(publicPaths![1]).toContain(`"${probe![1]}"`);
  });

  it("la sonde exige un 200 et ne suit pas les redirections", () => {
    const healthcheck = /HEALTHCHECK[\s\S]*?(?=\n[A-Z]|\n*$)/.exec(dockerfile)?.[0] ?? "";
    expect(healthcheck).toContain("redirect:'manual'");
    expect(healthcheck).toContain("r.status===200");
  });

  it("aucune source de COPY n'est exclue par .dockerignore", () => {
    const ignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));

    // Comparaison sur les motifs littéraux uniquement : suffisant pour attraper
    // l'erreur réelle (« on copie un chemin qu'on a soi-même exclu »), sans
    // réimplémenter la sémantique des jokers de Docker.
    for (const { source } of sources) {
      expect(ignore).not.toContain(source.replace(/\/$/, ""));
    }
  });
});
