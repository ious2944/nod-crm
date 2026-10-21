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
 * - action : le corps est exactement `return runAction("<capacité>", fn)` ou
 *   `return runCrmAction("<capacité>", fn)`, avec `fn` une fonction et le
 *   helper importé de son module — seule variante admise, un
 *   `try { return await runCrmAction(…) } catch …` dont le `try` ne contient
 *   que cet appel, sans `finally`, et dont le `catch` n'appelle rien (action qui
 *   convertit déjà ses erreurs en état) ;
 * - route d'écriture : `return withActor(handler, "<capacité>")`, précédé au
 *   plus de la garde d'origine `if (!isSameOrigin(request)) return …`.
 *
 * La capacité doit être une chaîne littérale du catalogue (`capabilities.ts`)
 * et **celle figée dans `EXPECTED_CAPABILITIES`** : changer la capacité d'une
 * action (ou en ajouter une) est une décision de droits, qui passe par ce test
 * et par `docs/permissions-v1.md`.
 *
 * Périmètre : tout `src/` (hors client Prisma généré). Une directive
 * `"use server"` ailleurs qu'en tête de fichier (action inline) fait échouer le
 * test : elle échapperait à l'inventaire.
 *
 * Pourquoi une analyse statique plutôt qu'un registre à l'exécution : un
 * registre prouve qu'une action **a** appelé `authorize`, pas qu'elle l'a fait
 * *avant* toute requête Prisma ; et il faudrait exécuter chaque action avec
 * des arguments valides. La forme imposée ici garantit l'ordre par
 * construction : rien ne s'exécute dans l'action hors du helper, qui résout
 * l'acteur puis appelle `authorize` en premier.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");

/** Points d'entrée sans acteur (avant authentification) : exclus, et figés ici. */
const PRE_AUTH_EXPORTS: Record<string, string[]> = {
  "src/app/login/actions.ts": ["login", "logout"],
};

/** Helper autorisé → module dont il doit être importé. */
const ACTION_HELPERS: Record<string, string> = {
  runAction: "@/lib/tasks/action-result",
  runCrmAction: "@/lib/authz/run-crm-action",
};
const ROUTE_HELPERS: Record<string, string> = { withActor: "@/lib/tasks/route-helpers" };
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Capacité attendue de chaque point d'entrée — la même que la colonne
 * « Capacité » de `docs/permissions-v1.md` §3. 99 actions + 1 route.
 */
const EXPECTED_CAPABILITIES: Record<string, string> = {
"src/app/(app)/commerce/actions.ts › createOpportunity": "crm.opportunity.create",
  "src/app/(app)/commerce/actions.ts › updateOpportunity": "crm.opportunity.update",
  "src/app/(app)/commerce/actions.ts › changeOpportunityStatus": "crm.opportunity.update",
  "src/app/(app)/commerce/actions.ts › deleteOpportunity": "crm.opportunity.delete",
  "src/app/(app)/commerce/actions.ts › findOpportunities": "crm.opportunity.read",
  "src/app/(app)/contacts/actions.ts › createContact": "crm.contact.create",
  "src/app/(app)/contacts/actions.ts › updateContact": "crm.contact.update",
  "src/app/(app)/contacts/actions.ts › archiveContact": "crm.contact.archive",
  "src/app/(app)/contacts/actions.ts › restoreContact": "crm.contact.archive",
  "src/app/(app)/contacts/actions.ts › findContacts": "crm.contact.read",
  "src/app/(app)/contacts/import-actions.ts › previewContactImport": "crm.contact.import",
  "src/app/(app)/contacts/import-actions.ts › importContacts": "crm.contact.import",
  "src/app/(app)/follow-ups/actions.ts › createFollowUp": "crm.followup.create",
  "src/app/(app)/follow-ups/actions.ts › applyQuickAction": "crm.followup.update",
  "src/app/(app)/follow-ups/actions.ts › updateFollowUp": "crm.followup.update",
  "src/app/(app)/organizations/actions.ts › createOrganization": "crm.organization.create",
  "src/app/(app)/organizations/actions.ts › updateOrganization": "crm.organization.update",
  "src/app/(app)/organizations/actions.ts › archiveOrganization": "crm.organization.archive",
  "src/app/(app)/organizations/actions.ts › restoreOrganization": "crm.organization.archive",
  "src/app/(app)/organizations/actions.ts › findOrganizations": "crm.organization.read",
  "src/app/(app)/rgpd/actions.ts › createTreatment": "privacy.treatment.create",
  "src/app/(app)/rgpd/actions.ts › updateTreatment": "privacy.treatment.update",
  "src/app/(app)/rgpd/actions.ts › archiveTreatment": "privacy.treatment.archive",
  "src/app/(app)/rgpd/actions.ts › createProcessor": "privacy.processor.create",
  "src/app/(app)/rgpd/actions.ts › updateProcessor": "privacy.processor.update",
  "src/app/(app)/rgpd/actions.ts › archiveProcessor": "privacy.processor.archive",
  "src/app/(app)/rgpd/actions.ts › createPrivacyRequest": "privacy.request.create",
  "src/app/(app)/rgpd/actions.ts › updatePrivacyRequest": "privacy.request.update",
  "src/app/(app)/rgpd/actions.ts › createIncident": "privacy.incident.create",
  "src/app/(app)/rgpd/actions.ts › updateIncident": "privacy.incident.update",
  "src/app/(app)/rgpd/archive-actions.ts › restoreTreatment": "privacy.treatment.archive",
  "src/app/(app)/rgpd/archive-actions.ts › restoreProcessor": "privacy.processor.archive",
  "src/app/(app)/tasks/actions.ts › createTask": "task.create",
  "src/app/(app)/tasks/actions.ts › updateTask": "task.edit",
  "src/app/(app)/tasks/actions.ts › applyTaskAction": "task.edit",
  "src/app/(app)/tasks/actions.ts › findFollowUps": "crm.followup.read",
  "src/app/(app)/tasks/work-actions.ts › createTaskAction": "task.create",
  "src/app/(app)/tasks/work-actions.ts › updateTaskAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › deleteTaskAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › restoreTaskAction": "task.restore",
  "src/app/(app)/tasks/work-actions.ts › purgeTaskAction": "task.purge",
  "src/app/(app)/tasks/work-actions.ts › duplicateTaskAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › moveTaskAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › addTaskToProjectAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › removeTaskFromProjectAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › moveSubtaskAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › setTaskParentAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › setTaskTagsAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › setCustomFieldValueAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › addDependencyAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › removeDependencyAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › setFollowerAction": "task.read",
  "src/app/(app)/tasks/work-actions.ts › addTimeEntryAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › deleteTimeEntryAction": "task.read",
  "src/app/(app)/tasks/work-actions.ts › addCommentAction": "task.comment",
  "src/app/(app)/tasks/work-actions.ts › editCommentAction": "task.comment.own",
  "src/app/(app)/tasks/work-actions.ts › deleteCommentAction": "task.comment.own",
  "src/app/(app)/tasks/work-actions.ts › toggleReactionAction": "task.comment",
  "src/app/(app)/tasks/work-actions.ts › bulkUpdateAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › bulkPatchAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › bulkDeleteAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › bulkMoveAction": "task.manage",
  "src/app/(app)/tasks/work-actions.ts › deleteAttachmentAction": "task.edit",
  "src/app/(app)/tasks/work-actions.ts › createProjectAction": "project.create",
  "src/app/(app)/tasks/work-actions.ts › updateProjectAction": "project.manage",
  "src/app/(app)/tasks/work-actions.ts › duplicateProjectAction": "project.read",
  "src/app/(app)/tasks/work-actions.ts › archiveProjectAction": "project.manage",
  "src/app/(app)/tasks/work-actions.ts › deleteProjectAction": "project.manage",
  "src/app/(app)/tasks/work-actions.ts › restoreProjectAction": "project.restore",
  "src/app/(app)/tasks/work-actions.ts › previewProjectPurgeAction": "project.purge",
  "src/app/(app)/tasks/work-actions.ts › purgeProjectAction": "project.purge",
  "src/app/(app)/tasks/work-actions.ts › setProjectMemberAction": "project.manage",
  "src/app/(app)/tasks/work-actions.ts › setFavoriteAction": "project.read",
  "src/app/(app)/tasks/work-actions.ts › createSectionAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › renameSectionAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › moveSectionAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › deleteSectionAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › postStatusUpdateAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › commentStatusUpdateAction": "project.read",
  "src/app/(app)/tasks/work-actions.ts › setProjectFieldAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › importCsvAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › createTagAction": "workspace.tag.write",
  "src/app/(app)/tasks/work-actions.ts › updateTagAction": "workspace.tag.write",
  "src/app/(app)/tasks/work-actions.ts › deleteTagAction": "workspace.tag.write",
  "src/app/(app)/tasks/work-actions.ts › saveCustomFieldAction": "workspace.field.write",
  "src/app/(app)/tasks/work-actions.ts › deleteCustomFieldAction": "workspace.field.write",
  "src/app/(app)/tasks/work-actions.ts › saveRuleAction": "workspace.rule.write",
  "src/app/(app)/tasks/work-actions.ts › deleteRuleAction": "workspace.rule.write",
  "src/app/(app)/tasks/work-actions.ts › saveTaskTemplateAction": "workspace.template.write",
  "src/app/(app)/tasks/work-actions.ts › deleteTaskTemplateAction": "workspace.template.write",
  "src/app/(app)/tasks/work-actions.ts › taskToTemplateAction": "workspace.template.write",
  "src/app/(app)/tasks/work-actions.ts › saveFormAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › deleteFormAction": "project.edit",
  "src/app/(app)/tasks/work-actions.ts › submitFormAction": "project.read",
  "src/app/(app)/tasks/work-actions.ts › saveViewAction": "user.view.write",
  "src/app/(app)/tasks/work-actions.ts › deleteViewAction": "user.view.write",
  "src/app/(app)/tasks/work-actions.ts › markNotificationsAction": "user.notification.write",
  "src/app/(app)/tasks/work-actions.ts › setNotificationPreferenceAction": "user.notification.write",
  "src/app/(app)/tasks/work-actions.ts › setWeeklyCapacityAction": "user.capacity.write",
  "src/app/api/tasks/items/[id]/attachments/route.ts › POST": "task.edit",
};

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === "generated" ? [] : collectFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
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

/** Identifiants importés par nom, et leur module. */
function importsOf(source: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) imports.set(element.name.text, statement.moduleSpecifier.text);
  }
  return imports;
}

/** Directives `"use server"` qui ne sont pas en tête de fichier (actions inline). */
function inlineUseServer(source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use server" &&
      node !== source.statements[0]
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function containsCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) || ts.isTaggedTemplateExpression(node)) {
    return true;
  }
  return Boolean(ts.forEachChild(node, (child) => (containsCall(child) ? true : undefined)));
}

function unwrapAwait(expression: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(expression) ? expression.expression : expression;
}

const isFunction = (node: ts.Node | undefined) => Boolean(node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)));

/**
 * `return helper(…)` → la capacité, ou une explication. Exactement deux
 * arguments : la capacité littérale et une fonction (rien d'autre n'est
 * évalué avant `authorize`). `capabilityFirst` : `helper(cap, fn)` pour les
 * actions, `helper(fn, cap)` pour `withActor`.
 */
function capabilityOfReturn(
  statement: ts.Statement | undefined,
  helpers: Record<string, string>,
  imports: Map<string, string>,
  capabilityFirst: boolean,
): string {
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression) throw new Error("pas un `return helper(...)`");
  const call = unwrapAwait(statement.expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !(call.expression.text in helpers)) {
    throw new Error(`appel attendu : ${Object.keys(helpers).join(" | ")}`);
  }
  const helper = call.expression.text;
  if (imports.get(helper) !== helpers[helper]) throw new Error(`\`${helper}\` doit être importé de ${helpers[helper]}`);
  if (call.arguments.length !== 2) throw new Error("exactement deux arguments attendus : capacité et fonction");
  const [arg, fn] = capabilityFirst ? call.arguments : [call.arguments[1], call.arguments[0]];
  if (!isFunction(fn)) throw new Error("le corps de l'action doit être une fonction passée au helper");
  if (!ts.isStringLiteral(arg)) throw new Error("capacité attendue en chaîne littérale");
  if (!isCapability(arg.text)) throw new Error(`capacité inconnue : ${arg.text}`);
  return arg.text;
}

function actionCapability(body: ts.Block | undefined, imports: Map<string, string>): string {
  const statements = body?.statements ?? [];
  if (statements.length !== 1) throw new Error(`le corps doit être un seul \`return\` (trouvé ${statements.length} instructions)`);
  const [only] = statements;
  if (ts.isTryStatement(only)) {
    if (only.tryBlock.statements.length !== 1) throw new Error("le `try` doit contenir le seul appel au helper");
    if (only.finallyBlock) throw new Error("`finally` interdit : il s'exécuterait même après un refus");
    if (only.catchClause && containsCall(only.catchClause.block)) {
      throw new Error("le `catch` ne doit rien appeler : il s'exécuterait même après un refus");
    }
    return capabilityOfReturn(only.tryBlock.statements[0], ACTION_HELPERS, imports, true);
  }
  return capabilityOfReturn(only, ACTION_HELPERS, imports, true);
}

function routeCapability(body: ts.Block | undefined, imports: Map<string, string>): string {
  const statements = [...(body?.statements ?? [])];
  const last = statements.pop();
  for (const guard of statements) {
    const text = ts.isIfStatement(guard) ? guard.expression.getText() : "";
    if (text !== "!isSameOrigin(request)") throw new Error(`instruction avant \`withActor\` non admise : ${guard.getText().slice(0, 60)}`);
  }
  return capabilityOfReturn(last, ROUTE_HELPERS, imports, false);
}

const sources = collectFiles(SRC).map((file) => {
  const source = parse(file);
  return { file, rel: relative(ROOT, file), source, imports: importsOf(source) };
});
const actionFiles = sources.filter((s) => isUseServer(s.source) && !(s.rel in PRE_AUTH_EXPORTS));
const routeFiles = sources.filter((s) => /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/.test(s.rel));

const actionCases = actionFiles.flatMap(({ rel, source, imports }) =>
  exportedFunctions(source).functions.map((fn) => [`${rel} › ${fn.name}`, fn, imports] as const),
);
const routeCases = routeFiles.flatMap(({ rel, source, imports }) =>
  exportedFunctions(source)
    .functions.filter((fn) => WRITE_METHODS.has(fn.name))
    .map((fn) => [`${rel} › ${fn.name}`, fn, imports] as const),
);

describe("inventaire des points d'écriture : tous passent par authorize", () => {
  it("trouve les fichiers d'actions et la route d'écriture attendus", () => {
    // Garde contre une détection cassée : ces nombres ne baissent pas sans raison.
    expect(actionFiles.length).toBeGreaterThanOrEqual(9);
    expect(actionCases.length).toBe(99);
    expect(routeCases.length).toBe(1);
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

  it.each(actionCases)("%s", (label, fn, imports) => {
    expect(actionCapability(fn.body, imports)).toBe(EXPECTED_CAPABILITIES[label]);
  });

  it.each(routeCases)("%s", (label, fn, imports) => {
    expect(routeCapability(fn.body, imports)).toBe(EXPECTED_CAPABILITIES[label]);
  });

  it("la table figée ne contient que des points d'entrée existants", () => {
    const found = new Set<string>([...actionCases, ...routeCases].map(([label]) => label));
    expect(Object.keys(EXPECTED_CAPABILITIES).filter((label) => !found.has(label))).toEqual([]);
  });

  it("aucune Server Action inline (« use server » hors tête de fichier)", () => {
    expect(sources.filter((s) => inlineUseServer(s.source) > 0).map((s) => s.rel)).toEqual([]);
  });

  it("aucune route n'exporte de méthode d'écriture sous une autre forme", () => {
    for (const { rel, source } of routeFiles) {
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            expect(WRITE_METHODS.has(element.name.text), `${rel} › export { … as ${element.name.text} }`).toBe(false);
          }
        }
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
      ...actionCases.map(([, fn, imports]) => actionCapability(fn.body, imports)),
      ...routeCases.map(([, fn, imports]) => routeCapability(fn.body, imports)),
    ]);
    expect(CAPABILITIES.filter((capability) => !used.has(capability))).toEqual([]);
  });
});
