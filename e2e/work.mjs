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
