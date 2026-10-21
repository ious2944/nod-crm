import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CAPABILITIES, isCapability } from "@/lib/authz/capabilities";

/**
 * Inventaire des points d'écriture (permissions V1, lot 0).
 *
 * Toute Server Action exportée et toute route `POST` / `PUT` / `PATCH` /
 * `DELETE` doit passer par le point de contrôle central (`authorize`) **avant
 * d'exécuter quoi que ce soit**. Le test le vérifie sur le code source, par
 * l'arbre syntaxique TypeScript :
 *
 * - action : le corps est exactement `return runAction("<capacité>", …)` ou
 *   `return runCrmAction("<capacité>", …)` — seule variante admise, un
 *   `try { return await runCrmAction(…) } catch …` dont le `try` ne contient
 *   que cet appel (action qui convertit déjà ses erreurs en état) ;
 * - route d'écriture : `return withActor(…, "<capacité>")`, précédé au plus
 *   de la garde d'origine `if (!isSameOrigin(request)) return …`.
 *
 * La capacité doit être une chaîne littérale du catalogue (`capabilities.ts`).
 *
 * Pourquoi une analyse statique plutôt qu'un registre à l'exécution : un
 * registre prouve qu'une action **a** appelé `authorize`, pas qu'elle l'a fait
 * *avant* toute requête Prisma ; et il faudrait exécuter chaque action avec
 * des arguments valides. La forme imposée ici garantit l'ordre par
 * construction : rien ne s'exécute dans l'action hors du helper, qui résout
 * l'acteur puis appelle `authorize` en premier.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const APP = join(ROOT, "src", "app");

/** Points d'entrée sans acteur (avant authentification) : exclus, et figés ici. */
const PRE_AUTH_EXPORTS: Record<string, string[]> = {
  "src/app/login/actions.ts": ["login", "logout"],
};

const ACTION_HELPERS = new Set(["runAction", "runCrmAction"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return collectFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function isUseServer(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return Boolean(
    first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server",
  );
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

interface ExportedFunction {
  name: string;
  body: ts.Block | undefined;
}

/** Exports de valeur d'un module ; tout ce qui n'est pas une fonction nommée est signalé. */
function exportedFunctions(source: ts.SourceFile): { functions: ExportedFunction[]; others: string[] } {
  const functions: ExportedFunction[] = [];
  const others: string[] = [];
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (ts.isExportDeclaration(statement)) {
      if (!statement.isTypeOnly) others.push(statement.getText(source).slice(0, 80));
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      others.push("export default …");
      continue;
    }
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.push({ name: statement.name.text, body: statement.body });
    } else {
      others.push(statement.getText(source).slice(0, 80));
    }
  }
  return { functions, others };
}

function unwrapAwait(expression: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(expression) ? expression.expression : expression;
}

/** `return helper("<capacité>", …)` → la capacité, ou une explication. */
function capabilityOfReturn(statement: ts.Statement | undefined, helpers: Set<string>, position: "first" | "last"): string {
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression) throw new Error("pas un `return helper(...)`");
  const call = unwrapAwait(statement.expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !helpers.has(call.expression.text)) {
    throw new Error(`appel attendu : ${[...helpers].join(" | ")}`);
  }
  const arg = position === "first" ? call.arguments[0] : call.arguments[call.arguments.length - 1];
  if (!arg || !ts.isStringLiteral(arg)) throw new Error("capacité attendue en chaîne littérale");
  if (!isCapability(arg.text)) throw new Error(`capacité inconnue : ${arg.text}`);
  return arg.text;
}

function actionCapability(body: ts.Block | undefined): string {
  const statements = body?.statements ?? [];
  if (statements.length !== 1) throw new Error(`le corps doit être un seul \`return\` (trouvé ${statements.length} instructions)`);
  const [only] = statements;
  if (ts.isTryStatement(only)) {
    if (only.tryBlock.statements.length !== 1) throw new Error("le `try` doit contenir le seul appel au helper");
    return capabilityOfReturn(only.tryBlock.statements[0], ACTION_HELPERS, "first");
  }
  return capabilityOfReturn(only, ACTION_HELPERS, "first");
}

function routeCapability(body: ts.Block | undefined): string {
  const statements = [...(body?.statements ?? [])];
  const last = statements.pop();
  for (const guard of statements) {
    const text = ts.isIfStatement(guard) ? guard.expression.getText() : "";
    if (text !== "!isSameOrigin(request)") throw new Error(`instruction avant \`withActor\` non admise : ${guard.getText().slice(0, 60)}`);
  }
  return capabilityOfReturn(last, new Set(["withActor"]), "last");
}

const sources = collectFiles(APP).map((file) => ({ file, rel: relative(ROOT, file), source: parse(file) }));
const actionFiles = sources.filter((s) => isUseServer(s.source) && !(s.rel in PRE_AUTH_EXPORTS));
const routeFiles = sources.filter((s) => s.rel.endsWith("route.ts"));

const actionCases = actionFiles.flatMap(({ rel, source }) =>
  exportedFunctions(source).functions.map((fn) => [`${rel} › ${fn.name}`, fn] as const),
);
const routeCases = routeFiles.flatMap(({ rel, source }) =>
  exportedFunctions(source)
    .functions.filter((fn) => WRITE_METHODS.has(fn.name))
    .map((fn) => [`${rel} › ${fn.name}`, fn] as const),
);

describe("inventaire des points d'écriture : tous passent par authorize", () => {
  it("trouve les fichiers d'actions et la route d'écriture attendus", () => {
    // Garde contre une détection cassée : ces nombres ne baissent pas sans raison.
    expect(actionFiles.length).toBeGreaterThanOrEqual(9);
    expect(actionCases.length).toBeGreaterThanOrEqual(99);
    expect(routeCases.length).toBeGreaterThanOrEqual(1);
  });

  it("les points d'entrée sans acteur sont exactement ceux déclarés", () => {
    for (const [rel, names] of Object.entries(PRE_AUTH_EXPORTS)) {
      const entry = sources.find((s) => s.rel === rel);
      expect(entry, rel).toBeDefined();
      expect(exportedFunctions(entry!.source).functions.map((fn) => fn.name).sort()).toEqual([...names].sort());
    }
  });

  it.each(actionFiles.map(({ rel, source }) => [rel, source] as const))("%s n'exporte que des fonctions nommées", (_rel, source) => {
    expect(exportedFunctions(source).others).toEqual([]);
  });

  it.each(actionCases)("%s", (_label, fn) => {
    expect(() => actionCapability(fn.body)).not.toThrow();
  });

  it.each(routeCases)("%s", (_label, fn) => {
    expect(() => routeCapability(fn.body)).not.toThrow();
  });

  it("aucune route n'exporte d'autre méthode d'écriture hors de cette liste", () => {
    for (const { rel, source } of routeFiles) {
      for (const statement of source.statements) {
        if (!isExported(statement) || !ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const name = declaration.name.getText(source);
          expect(WRITE_METHODS.has(name), `${rel} › export const ${name}`).toBe(false);
        }
      }
    }
  });

  it("chaque capacité du catalogue sert au moins une fois", () => {
    const used = new Set([
      ...actionCases.map(([, fn]) => actionCapability(fn.body)),
      ...routeCases.map(([, fn]) => routeCapability(fn.body)),
    ]);
    expect(CAPABILITIES.filter((capability) => !used.has(capability))).toEqual([]);
  });
});
