#!/usr/bin/env node
/**
 * Parcours de bout en bout du module de gestion de travail (V1.0).
 *
 *   BASE_URL=http://127.0.0.1:3000 E2E_EMAIL=… E2E_PASSWORD='…' npm run test:e2e:work
 *
 * Vérifie : création de projet, ajout rapide en Liste, apparition dans le
 * Tableau, glisser-déposer persistant après rechargement, panneau de détail
 * répercuté dans les autres vues, rendu de chaque onglet et des pages du module
 * sans erreur JavaScript, affichage mobile. Les captures vont dans E2E_SHOTS.
 */
import process from "node:process";
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const shots = process.env.E2E_SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const step = (s) => console.log("→", s);

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', process.env.E2E_EMAIL);
await page.fill('input[name="password"]', process.env.E2E_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/today/);
step("connecté");

await page.goto(`${BASE}/tasks/projects`);
await page.getByRole("button", { name: "Nouveau projet" }).first().click();
const name = `Projet E2E ${Date.now() % 100000}`;
await page.getByLabel("Nom du projet").fill(name);
await page.getByRole("button", { name: "Créer le projet" }).click();
await page.waitForURL(/tasks\/projects\/[0-9a-f-]{36}/);
const projectUrl = page.url().split("?")[0];
step("projet créé " + projectUrl);

const quick = page.getByLabel("Ajouter une tâche…").first();
await quick.click();
await quick.fill("Tâche E2E 1");
await quick.press("Enter");
await quick.fill("Tâche E2E 2");
await quick.press("Enter");
await page.locator('input[aria-label="Nom de la tâche"][value="Tâche E2E 2"]').waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/list.png` });
step("tâches ajoutées en liste");

await page.getByRole("tab", { name: "Tableau", exact: true }).click();
const card = page.locator("article", { hasText: "Tâche E2E 1" });
await card.waitFor();
const target = page.locator('section[aria-label="En cours"] [data-drop="lane"]');
const cb = await card.boundingBox();
const tb = await target.boundingBox();
await page.mouse.move(cb.x + 40, cb.y + 10);
await page.mouse.down();
await page.mouse.move(cb.x + 60, cb.y + 20, { steps: 5 });
await page.mouse.move(tb.x + 60, tb.y + 20, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/board.png` });
await page.reload();
await page.getByRole("tab", { name: "Tableau", exact: true }).click();
const inProgress = await page.locator('section[aria-label="En cours"]').innerText();
const failures = [];
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) failures.push(label); };
check("déplacement conservé après rechargement", inProgress.includes("Tâche E2E 1"));

await page.locator("article", { hasText: "Tâche E2E 1" }).click();
await page.getByRole("dialog", { name: "Détail de la tâche" }).waitFor();
await page.waitForTimeout(800);
await page.getByRole("dialog", { name: "Détail de la tâche" }).getByRole("button", { name: /Priorité/ }).click();
await page.getByRole("menuitem", { name: "Urgente" }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${shots}/panel.png` });
const cardText = await page.locator("article", { hasText: "Tâche E2E 1" }).innerText();
check("modification du panneau visible sur la carte", cardText.includes("Urgente"));
await page.keyboard.press("Escape");

for (const tab of ["Liste", "Calendrier", "Chronologie", "Tableau de bord", "Vue d'ensemble"]) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/tab-${tab.replace(/\W+/g, "_")}.png` });
}
const listText = await (async () => { await page.getByRole("tab", { name: "Liste", exact: true }).click(); await page.waitForTimeout(500); return page.locator('[role="grid"]').innerText(); })();
check("modification du panneau visible en liste", listText.includes("Urgente"));
check("deux tâches en liste", (await page.locator("[data-row-id]").count()) === 2);

// Corbeille : suppression douce depuis la liste, restauration depuis /tasks/trash.
const row2 = page.locator("[data-row-id]", { has: page.locator('input[aria-label="Nom de la tâche"][value="Tâche E2E 2"]') });
await row2.focus();
await page.keyboard.press("Delete");
await page.getByRole("button", { name: "Mettre à la corbeille" }).click();
await page.waitForTimeout(1200);
check("tâche retirée de la liste", (await page.locator("[data-row-id]").count()) === 1);
await page.goto(`${BASE}/tasks/trash`);
const trashed = page.locator("li", { hasText: "Tâche E2E 2" });
await trashed.waitFor({ timeout: 10000 });
check("tâche présente dans la corbeille", (await trashed.count()) === 1);
check("suppression définitive proposée au propriétaire", (await trashed.getByRole("button", { name: "Supprimer définitivement" }).count()) === 1);
await page.screenshot({ path: `${shots}/trash.png` });
await trashed.getByRole("button", { name: "Restaurer" }).click();
await page.waitForTimeout(1200);
await page.goto(projectUrl + "?view=list");
await page.locator("[data-row-id]").first().waitFor();
await page.waitForTimeout(600);
check("tâche restaurée dans son projet", (await page.locator("[data-row-id]").count()) === 2);

// Projet : mise à la corbeille puis restauration, avec ses tâches.
await page.goto(projectUrl + "?view=list");
await page.locator("[data-row-id]").first().waitFor();
await page.getByRole("button", { name: "Actions du projet" }).click();
await page.getByRole("menuitem", { name: "Mettre le projet à la corbeille" }).click();
await page.getByRole("button", { name: "Mettre à la corbeille" }).click();
await page.waitForURL(/\/tasks\/projects$/);
await page.waitForTimeout(800);
check("projet supprimé : absent de la liste des projets", !(await page.locator("main").innerText()).includes(name));
// Page 404 de Next (rendue en flux : le statut HTTP reste 200, comme pour un
// projet privé illisible).
await page.goto(projectUrl);
await page.waitForTimeout(800);
check("projet supprimé : introuvable par son adresse", (await page.locator("body").innerText()).includes("could not be found"));
await page.goto(`${BASE}/tasks/trash`);
const trashedProject = page.getByRole("region", { name: "Projets dans la corbeille" }).locator("li", { hasText: name });
await trashedProject.waitFor({ timeout: 10000 });
check("projet dans la corbeille avec ses tâches", (await trashedProject.innerText()).includes("2 tâche(s) avec lui"));
check("tâches du projet absentes de la corbeille des tâches", (await page.locator("li", { hasText: "Tâche E2E 1" }).count()) === 0);
await page.screenshot({ path: `${shots}/trash-project.png` });
await trashedProject.getByRole("button", { name: "Restaurer le projet" }).click();
await page.waitForTimeout(1200);
check("projet restauré : retiré de la corbeille", (await page.locator("li", { hasText: name }).count()) === 0);
await page.goto(projectUrl + "?view=list");
await page.locator("[data-row-id]").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
check("projet restauré avec ses deux tâches", (await page.locator("[data-row-id]").count()) === 2);
await page.getByRole("tab", { name: "Tableau", exact: true }).click();
await page.locator('section[aria-label="En cours"]').waitFor();
check("tâche restaurée dans sa section", (await page.locator('section[aria-label="En cours"]').innerText()).includes("Tâche E2E 1"));

// Suppression définitive d'un projet : aperçu, annulation, confirmation explicite,
// tâche partagée conservée.
await page.goto(`${BASE}/tasks/projects`);
await page.getByRole("button", { name: "Nouveau projet" }).first().click();
const purgeName = `Purge E2E ${Date.now() % 100000}`;
await page.getByLabel("Nom du projet").fill(purgeName);
await page.getByRole("button", { name: "Créer le projet" }).click();
await page.waitForURL(/tasks\/projects\/[0-9a-f-]{36}/);
const quickPurge = page.getByLabel("Ajouter une tâche…").first();
await quickPurge.click();
await quickPurge.fill("Exclusive purge");
await quickPurge.press("Enter");
await quickPurge.fill("Partagée purge");
await quickPurge.press("Enter");
const sharedRow = page.locator("[data-row-id]", { has: page.locator('input[aria-label="Nom de la tâche"][value="Partagée purge"]') });
await sharedRow.waitFor();
await page.waitForTimeout(800);
await sharedRow.click({ button: "right" });
await page.getByRole("menuitem", { name: "Ajouter à un autre projet…" }).click();
await page.getByPlaceholder("Rechercher un projet").fill(name);
await page.getByRole("button", { name }).click();
await page.getByRole("button", { name: "Sans section" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Actions du projet" }).click();
await page.getByRole("menuitem", { name: "Mettre le projet à la corbeille" }).click();
await page.getByRole("button", { name: "Mettre à la corbeille" }).click();
await page.waitForURL(/\/tasks\/projects$/);

await page.goto(`${BASE}/tasks/trash`);
const purgeRow = page.getByRole("region", { name: "Projets dans la corbeille" }).locator("li", { hasText: purgeName });
await purgeRow.waitFor();
await purgeRow.getByRole("button", { name: "Supprimer définitivement" }).click();
const purgeDialog = page.getByRole("dialog", { name: "Supprimer définitivement le projet ?" });
await purgeDialog.getByTestId("purge-preview").waitFor();
const purgeText = await purgeDialog.innerText();
check("purge : nom du projet présenté", purgeText.includes(`« ${purgeName} »`));
check("purge : tâches et sous-tâches effacées comptées", purgeText.includes("1 tâche principale et 0 sous-tâche"));
check("purge : tâche partagée conservée annoncée", purgeText.includes("1 tâche partagée"));
check("purge : commentaires, pièces jointes, historique mentionnés", /commentaire.*pièce jointe.*historique/s.test(purgeText));
check("purge : caractère irréversible affiché", purgeText.includes("irréversible"));
const confirmPurge = purgeDialog.getByRole("button", { name: "Supprimer définitivement" });
check("purge : confirmation désactivée sans case cochée", await confirmPurge.isDisabled());
await page.screenshot({ path: `${shots}/purge-dialog.png` });
await purgeDialog.getByRole("button", { name: "Annuler" }).click();
await page.waitForTimeout(500);
check("purge annulée : dialogue fermé", (await page.getByRole("dialog").count()) === 0);
check("purge annulée : projet toujours dans la corbeille", (await purgeRow.count()) === 1);

await purgeRow.getByRole("button", { name: "Supprimer définitivement" }).click();
await purgeDialog.getByTestId("purge-preview").waitFor();
await purgeDialog.getByRole("checkbox").check();
check("purge : confirmation activée après la case", await confirmPurge.isEnabled());
await confirmPurge.click();
await page.waitForTimeout(1500);
check("purge confirmée : projet retiré de la corbeille", (await page.locator("li", { hasText: purgeName }).count()) === 0);
await page.goto(projectUrl + "?view=list");
await page.locator("[data-row-id]").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
check("purge : tâche partagée conservée dans l'autre projet", (await page.locator('input[aria-label="Nom de la tâche"][value="Partagée purge"]').count()) === 1);
check("purge : tâche exclusive effacée", (await page.locator('input[aria-label="Nom de la tâche"][value="Exclusive purge"]').count()) === 0);

// Périmètre modifié entre l'aperçu et la confirmation (deux onglets) : nouvelle
// confirmation exigée.
async function newProjectWithTask(projectName, taskTitle) {
  await page.goto(`${BASE}/tasks/projects`);
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.getByLabel("Nom du projet").fill(projectName);
  await page.getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/tasks\/projects\/[0-9a-f-]{36}/);
  const url = page.url().split("?")[0];
  if (taskTitle) {
    const q = page.getByLabel("Ajouter une tâche…").first();
    await q.click();
    await q.fill(taskTitle);
    await q.press("Enter");
    await page.locator(`input[aria-label="Nom de la tâche"][value="${taskTitle}"]`).waitFor();
    await page.waitForTimeout(800);
  }
  return url;
}
async function trashCurrentProject(url) {
  await page.goto(url + "?view=list");
  await page.getByRole("button", { name: "Actions du projet" }).click();
  await page.getByRole("menuitem", { name: "Mettre le projet à la corbeille" }).click();
  await page.getByRole("button", { name: "Mettre à la corbeille" }).click();
  await page.waitForURL(/\/tasks\/projects$/);
}
const stamp = Date.now() % 100000;
const qName = `Scope Q ${stamp}`;
const pName = `Scope P ${stamp}`;
const qUrl = await newProjectWithTask(qName, null);
const pUrl = await newProjectWithTask(pName, "Liée P et Q");
const linked = page.locator("[data-row-id]", { has: page.locator('input[aria-label="Nom de la tâche"][value="Liée P et Q"]') });
await linked.click({ button: "right" });
await page.getByRole("menuitem", { name: "Ajouter à un autre projet…" }).click();
await page.getByPlaceholder("Rechercher un projet").fill(qName);
await page.getByRole("button", { name: qName }).click();
await page.getByRole("button", { name: "Sans section" }).click();
await page.waitForTimeout(1200);
await trashCurrentProject(qUrl); // la tâche reste active dans P
await trashCurrentProject(pUrl); // elle part à la corbeille avec P (Q est déjà dans la corbeille)

await page.goto(`${BASE}/tasks/trash`);
const pRow = page.getByRole("region", { name: "Projets dans la corbeille" }).locator("li", { hasText: pName });
await pRow.getByRole("button", { name: "Supprimer définitivement" }).click();
const scopeDialog = page.getByRole("dialog", { name: "Supprimer définitivement le projet ?" });
await scopeDialog.getByTestId("purge-preview").waitFor();
check("périmètre initial : la tâche liée à Q (en corbeille) est conservée", (await scopeDialog.innerText()).includes("0 tâche principale") && (await scopeDialog.innerText()).includes("1 tâche partagée"));
await scopeDialog.getByRole("checkbox").check();

// Second onglet : Q est supprimé définitivement ; la tâche ne dépend plus que de P.
// Même session, autre onglet (contexte distinct partageant le cookie).
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.addCookies(await page.context().cookies());
const tab2 = await ctx2.newPage();
await tab2.goto(`${BASE}/tasks/trash`);
const qRow = tab2.getByRole("region", { name: "Projets dans la corbeille" }).locator("li", { hasText: qName });
await qRow.getByRole("button", { name: "Supprimer définitivement" }).click();
const qDialog = tab2.getByRole("dialog", { name: "Supprimer définitivement le projet ?" });
await qDialog.getByTestId("purge-preview").waitFor();
await qDialog.getByRole("checkbox").check();
await qDialog.getByRole("button", { name: "Supprimer définitivement" }).click();
await tab2.waitForTimeout(1500);
await ctx2.close();

await scopeDialog.getByRole("button", { name: "Supprimer définitivement" }).click();
await scopeDialog.getByRole("alert").waitFor({ timeout: 10000 });
const changedText = await scopeDialog.innerText();
check("périmètre modifié : avertissement affiché", changedText.includes("Le périmètre a changé"));
check("périmètre modifié : nouveau décompte présenté", changedText.includes("1 tâche principale") && changedText.includes("0 tâche partagée"));
check("périmètre modifié : nouvelle confirmation exigée", !(await scopeDialog.getByRole("checkbox").isChecked()) && (await scopeDialog.getByRole("button", { name: "Supprimer définitivement" }).isDisabled()));
check("périmètre modifié : projet toujours dans la corbeille", (await pRow.count()) === 1);
await page.screenshot({ path: `${shots}/purge-scope-changed.png` });
await scopeDialog.getByRole("checkbox").check();
await scopeDialog.getByRole("button", { name: "Supprimer définitivement" }).click();
await page.waitForTimeout(1500);
check("nouvelle confirmation : projet supprimé définitivement", (await page.locator("li", { hasText: pName }).count()) === 0);

// Cockpit : filtre « Mes tâches / Toutes les tâches accessibles ».
await page.goto(`${BASE}/today`);
const scope = page.getByRole("navigation", { name: "Portée des tâches" });
check("filtre par défaut : toutes les tâches accessibles", (await scope.getByRole("link", { name: "Toutes les tâches accessibles" }).getAttribute("aria-current")) === "page");
await scope.getByRole("link", { name: "Mes tâches" }).click();
await page.waitForURL(/t=mine/);
check("filtre « Mes tâches » actif", (await page.getByRole("navigation", { name: "Portée des tâches" }).getByRole("link", { name: "Mes tâches" }).getAttribute("aria-current")) === "page");
await page.screenshot({ path: `${shots}/today-mine.png` });

// Charge : période, capacité, colonnes séparées.
await page.goto(`${BASE}/tasks/workload?weeks=4`);
await page.getByRole("navigation", { name: "Période" }).waitFor();
check("charge : capacité personnelle modifiable", (await page.getByLabel("Ma capacité hebdomadaire en heures").count()) === 1);
check("charge : période de 4 semaines", (await page.getByLabel("Nombre de semaines").inputValue()) === "4");

for (const path of ["/tasks", "/tasks/notifications", "/tasks/search", "/tasks/portfolio", "/tasks/workload", "/tasks/settings", "/tasks/favorites", "/tasks/trash", "/today"]) {
  await page.goto(BASE + path);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/page${path.replace(/\W+/g, "_")}.png` });
}
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.context().addCookies(await page.context().cookies());
await mobile.goto(projectUrl + "?view=list");
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${shots}/mobile-list.png` });
check("aucune erreur JavaScript", errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
process.exit(failures.length ? 1 : 0);
