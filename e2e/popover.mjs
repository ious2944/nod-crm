#!/usr/bin/env node
/**
 * Test de non-régression du panneau « Reporter ».
 *
 * Le défaut d'origine n'était pas cosmétique. Reproduction historique :
 *
 *   carte     : y=265  hauteur=162
 *   item menu : y=494  → dépassait de 101 px sous la carte
 *   elementFromPoint au centre de « +1 sem. » → renvoyait le VOILE de fermeture
 *
 * La carte portait `overflow-hidden` : la partie débordante du panneau n'était
 * plus peinte, tandis que le voile — en `position: fixed`, donc non découpé —
 * restait par-dessus. Cliquer une option fermait le menu au lieu de reporter.
 * Le menu était visible et inopérant.
 *
 *   BASE_URL=… E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e:popover
 */
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

if (!EMAIL || !PASSWORD) {
  console.error("E2E_EMAIL et E2E_PASSWORD sont obligatoires.");
  process.exit(1);
}

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });

async function signedInPage(options = {}) {
  const context = await browser.newContext({ baseURL: BASE_URL, ...options });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/follow-ups", { timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
}

/** Crée un suivi dont l'échéance est dans `days` jours, et renvoie son titre. */
async function createFollowUp(page, days) {
  const title = `Popover ${days}j ${Date.now()}`;
  const due = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  await page.getByRole("button", { name: "Nouveau suivi" }).click();
  await page.fill("#title", title);
  await page.fill("#dueDate", due);
  await page.getByRole("button", { name: "Créer le suivi" }).click();
  await page.waitForSelector(`text=${title}`, { timeout: 15000 });
  return title;
}

const dueLabel = async (page, title) =>
  (await page.locator("article", { hasText: title }).innerText()).match(/Dans (\d+) j/)?.[1] ?? null;

try {
  // ---------------------------------------------------------------- desktop
  section("1. Chaque option applique bien le report qu'elle annonce");
  const page = await signedInPage({ viewport: { width: 1280, height: 900 } });

  for (const { option, days } of [
    { option: "+1 j", days: 1 },
    { option: "+3 j", days: 3 },
    { option: "+1 sem.", days: 7 },
  ]) {
    const title = await createFollowUp(page, 10);
    const before = Number(await dueLabel(page, title));

    await page.locator("article", { hasText: title }).getByRole("button", { name: "Reporter" }).click();
    await page.getByRole("button", { name: option, exact: true }).click();
    await page.waitForTimeout(1500);

    const after = Number(await dueLabel(page, title));
    check(`« ${option} » décale l'échéance de ${days} jour(s)`, after - before === days, `${before} → ${after}`);
  }

  section("2. Empilement et interception — le défaut d'origine");
  const target = await createFollowUp(page, 10);
  const card = page.locator("article", { hasText: target });
  await card.getByRole("button", { name: "Reporter" }).click();
  await page.waitForTimeout(400);

  const item = page.getByRole("button", { name: "+1 sem.", exact: true });
  check("le panneau est rendu hors de la carte (portail)",
    await item.evaluate((el) => el.closest("article") === null));

  const box = await item.boundingBox();
  const topmost = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.textContent?.trim() ?? "null";
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  check("aucune interception : l'option est l'élément au premier plan", topmost === "+1 sem.", topmost);

  const overNext = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // Un point du panneau qui recouvre la carte suivante doit renvoyer le panneau.
    const under = document.elementsFromPoint(r.x + 5, r.y + r.height - 2);
    return under.length > 0 && el.contains(under[0]);
  });
  check("le panneau passe devant la carte voisine", overNext);

  const heightBefore = await page.evaluate(() => document.body.scrollHeight);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const heightAfter = await page.evaluate(() => document.body.scrollHeight);
  check("l'ouverture ne modifie pas la hauteur du document", heightBefore === heightAfter,
    `${heightBefore} vs ${heightAfter}`);

  section("3. Clavier");
  await card.getByRole("button", { name: "Reporter" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Entrée ouvre le panneau et y place le focus",
    (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "+1 j");
  await page.keyboard.press("ArrowDown");
  check("Flèche bas navigue",
    (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "+3 j");
  await page.keyboard.press("ArrowUp");
  check("Flèche haut navigue en sens inverse",
    (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "+1 j");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Échap referme", (await page.getByRole("button", { name: "+1 j", exact: true }).count()) === 0);
  check("et rend le focus au déclencheur",
    (await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")).startsWith("Reporter"));

  section("4. Fermeture au clic extérieur");
  await card.getByRole("button", { name: "Reporter" }).click();
  await page.waitForTimeout(400);
  await page.locator("h1").click();
  await page.waitForTimeout(400);
  check("un clic ailleurs referme le panneau",
    (await page.getByRole("button", { name: "+1 j", exact: true }).count()) === 0);
  check("sans appliquer de report", Number(await dueLabel(page, target)) === 10);

  section("5. Carte en bas de fenêtre : bascule vers le haut");
  const cards = page.locator("article");
  const last = cards.nth((await cards.count()) - 1);
  await last.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await last.getByRole("button", { name: "Reporter" }).click();
  await page.waitForTimeout(400);
  const lastBox = await page.getByRole("button", { name: "+1 j", exact: true }).boundingBox();
  const trigger = await last.getByRole("button", { name: "Reporter" }).boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  check("le panneau reste entièrement dans la fenêtre",
    lastBox.y >= 0 && lastBox.y + lastBox.height <= viewportHeight,
    `y=${Math.round(lastBox.y)} h=${Math.round(lastBox.height)} vh=${viewportHeight}`);
  check("il a basculé au-dessus du déclencheur", lastBox.y < trigger.y,
    `panneau=${Math.round(lastBox.y)} déclencheur=${Math.round(trigger.y)}`);
  await page.keyboard.press("Escape");

  // ----------------------------------------------------------------- mobile
  section("6. Mobile 320 px");
  const mobile = await signedInPage({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const mobileCard = mobile.locator("article").first();
  await mobileCard.getByRole("button", { name: "Reporter" }).click();
  await mobile.waitForTimeout(400);
  const mobileBox = await mobile.getByRole("button", { name: "+1 sem.", exact: true }).boundingBox();
  const viewportWidth = await mobile.evaluate(() => window.innerWidth);
  check("le panneau tient dans la largeur",
    mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= viewportWidth,
    `x=${Math.round(mobileBox.x)} w=${Math.round(mobileBox.width)} vw=${viewportWidth}`);
  const mobileTop = await mobile.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim(),
    [mobileBox.x + mobileBox.width / 2, mobileBox.y + mobileBox.height / 2]);
  check("et reste cliquable au doigt", mobileTop === "+1 sem.", mobileTop);
  check("aucun débordement horizontal du document",
    (await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) === 0);

  // ------------------------------------------------------------- dark mode
  section("7. Thème sombre");
  const dark = await signedInPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await dark.locator("article").first().getByRole("button", { name: "Reporter" }).click();
  await dark.waitForTimeout(400);
  const panel = await dark.getByRole("button", { name: "+1 j", exact: true })
    .evaluate((el) => {
      const group = el.closest("[role=group]");
      const style = getComputedStyle(group);
      return { background: style.backgroundColor, border: style.borderTopColor };
    });
  check("le panneau a un fond opaque", panel.background !== "rgba(0, 0, 0, 0)", panel.background);
  check("et une bordure visible", panel.border !== "rgba(0, 0, 0, 0)", panel.border);
} finally {
  await browser.close();
}

console.log(`\n${passed} vérification(s) réussie(s), ${failures.length} échec(s).`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
