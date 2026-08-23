/**
 * Régression : askSecret() se bloquait indéfiniment après ask().
 *
 * readline.createInterface({ terminal: true }) n'appelle pas input.resume()
 * en interne. Quand ask() ferme son interface (rl.close() → input.pause()),
 * le stdin reste suspendu et le prompt de mot de passe ne reçoit jamais de
 * données. La correction est d'appeler process.stdin.resume() explicitement
 * avant de créer l'interface dans askSecret().
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("admin.mjs – askSecret régression stdin bloqué", () => {
  it("rl.close() laisse bien stdin en pause (confirme la nécessité du fix)", () => {
    // Vérifie que sans resume() explicite le stream serait effectivement bloqué.
    const script = `
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

const fakeStdin = new PassThrough();

// Simule ce que ask() fait : crée une interface non-terminal, puis la ferme.
const rl = createInterface({ input: fakeStdin, output: process.stdout });
rl.close(); // → input.pause()

// Sans resume() explicite, un second createInterface(terminal:true) ne
// reprend pas le stream : stdin reste en pause.
const isPaused = fakeStdin.isPaused();
process.exit(isPaused ? 0 : 1);
`;
    const result = spawnSync("node", ["--input-type=module"], {
      input: script,
      encoding: "utf-8",
    });
    // exit 0 ↔ stream bien en pause après rl.close() → resume() est indispensable
    expect(result.status).toBe(0);
  });

  it("askSecret() rejette avec un message explicite quand stdin n'est pas un TTY", () => {
    const script = `
import { createInterface } from "node:readline";

function askSecret(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(
        "La saisie du mot de passe exige un terminal interactif. " +
        "Lancez la commande avec \`docker compose exec -it\` (pas \`-T\`)."
      ));
      return;
    }
    process.stdin.resume();
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};
    rl.question("", (answer) => { rl.close(); process.stdout.write("\\n"); resolve(answer); });
  });
}

askSecret("Mot de passe : ")
  .then(() => process.exit(1))
  .catch((err) => {
    process.stderr.write(err.message + "\\n");
    process.exit(0);
  });
`;
    const result = spawnSync("node", ["--input-type=module"], {
      input: script,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("terminal interactif");
    expect(result.stderr).toContain("-it");
  });

  it("stdin.resume() avant createInterface(terminal:true) débloque le stream", () => {
    // Simule la séquence complète : ask() → pause → resume() → askSecret() → succès.
    const script = `
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

const fakeStdin = new PassThrough();
fakeStdin.isTTY = false; // non-TTY pour éviter setRawMode dans le test

// Étape 1 : ask() crée et ferme une interface → stdin en pause
const rl1 = createInterface({ input: fakeStdin, output: process.stdout });
rl1.close();

if (!fakeStdin.isPaused()) { process.exit(2); } // pré-condition non remplie

// Étape 2 : le correctif — resume() explicite avant la seconde interface
fakeStdin.resume();

if (fakeStdin.isPaused()) { process.exit(3); } // resume() n'a pas fonctionné

// Étape 3 : createInterface fonctionne et reçoit la donnée
const rl2 = createInterface({ input: fakeStdin, output: process.stdout });
rl2.question("", (answer) => {
  rl2.close();
  process.exit(answer === "secret" ? 0 : 4);
});

// Envoie la réponse simulée
fakeStdin.push("secret\\n");
`;
    const result = spawnSync("node", ["--input-type=module"], {
      input: script,
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
  });
});
