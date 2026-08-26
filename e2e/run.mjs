#!/usr/bin/env node
/**
 * Parcours de bout en bout NOD CRM.
 *
 * Pilote un vrai navigateur contre un build de production. Il couvre le chemin
 * fonctionnel complet *et* les propriétés de sécurité observables côté client
 * (redirection sans session, drapeaux du cookie, en-têtes, refus d'un mauvais
 * mot de passe, invalidation au logout).
 *
 *   BASE_URL=http://127.0.0.1:3000 \
 *   E2E_EMAIL=you@example.com E2E_PASSWORD='…' \
 *   npm run test:e2e
 *
 * Le mot de passe vient de l'environnement : il n'est jamais écrit dans le dépôt.
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

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function sessionCookie(context) {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name.endsWith("nod_session"));
}

const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });
const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  section("1. Accès sans session");
  const anonymous = await page.goto("/follow-ups", { waitUntil: "networkidle" });
  check("/follow-ups redirige vers /login", new URL(page.url()).pathname === "/login", page.url());
  check("la page de connexion répond 200", anonymous?.status() === 200);
  check("aucun suivi n'est rendu", (await page.locator("article").count()) === 0);

  section("2. En-têtes de sécurité");
  const headers = (await page.goto("/login", { waitUntil: "networkidle" }))?.headers() ?? {};
  check("Content-Security-Policy présent", Boolean(headers["content-security-policy"]));
  check(
    "CSP interdit le framing",
    (headers["content-security-policy"] ?? "").includes("frame-ancestors 'none'"),
  );
  check("X-Content-Type-Options: nosniff", headers["x-content-type-options"] === "nosniff");
  check("Referrer-Policy présent", Boolean(headers["referrer-policy"]));
  check("Permissions-Policy présent", Boolean(headers["permissions-policy"]));

  section("3. Mauvais mot de passe");
  await page.fill("#email", EMAIL);
  await page.fill("#password", "mot-de-passe-manifestement-faux");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // `form [role=alert]` : Next injecte lui aussi une région live vide dans la page.
  const alert = page.locator("form [role=alert]");
  await alert.waitFor({ timeout: 10000 });
  const errorText = await alert.innerText();
  check("le refus est affiché", errorText.length > 0, errorText);
  check("aucune session n'est ouverte", (await sessionCookie(context)) === undefined);
  check("on reste sur /login", new URL(page.url()).pathname === "/login");

  section("4. Connexion");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Depuis la V0.4, la connexion mène au cockpit « Aujourd'hui », pas à la
  // liste des suivis.
  await page.waitForURL("**/today", { timeout: 15000 });
  check("redirection vers /today", new URL(page.url()).pathname === "/today");

  const cookie = await sessionCookie(context);
  check("cookie de session posé", Boolean(cookie));
  check("cookie HttpOnly", cookie?.httpOnly === true);
  check("cookie SameSite=Lax", cookie?.sameSite === "Lax", String(cookie?.sameSite));
  check("cookie Path=/", cookie?.path === "/");
  check("cookie avec expiration explicite", (cookie?.expires ?? -1) > 0);
  if (BASE_URL.startsWith("https://")) {
    check("cookie Secure", cookie?.secure === true);
    check("préfixe __Host-", cookie?.name.startsWith("__Host-") === true, cookie?.name);
  } else {
    console.log("  · cookie Secure/__Host- non vérifiable en HTTP local");
  }

  section("5. Parcours Follow-up");
  await page.getByRole("link", { name: "Suivis", exact: true }).first().click();
  await page.waitForURL("**/follow-ups", { timeout: 15000 });
  check("la navigation mène à la liste des suivis", new URL(page.url()).pathname === "/follow-ups");

  const title = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nouveau suivi" }).click();
  await page.fill("#title", title);
  // Le sélecteur de contact n'est plus une liste déroulante : il cherche côté
  // serveur. On passe donc par son champ de recherche puis par l'option de
  // création rapide, qui fait réapparaître les champs prénom / nom.
  await page.getByPlaceholder("Rechercher un contact...").click();
  await page.getByRole("option", { name: "+ Créer un contact" }).click();
  await page.fill("#newContactFirstName", "Camille");
  await page.fill("#newContactLastName", "Durand");
  await page.fill("#dueDate", "2020-01-01");
  await page.getByRole("button", { name: "Créer le suivi" }).click();
  await page.waitForSelector(`text=${title}`, { timeout: 15000 });
  const card = page.locator("article", { hasText: title });
  check("création d'un suivi + contact", (await card.count()) === 1);

  await card.getByRole("button", { name: "Relancer" }).click();
  await page.waitForTimeout(1200);
  check("relance enregistrée", (await card.innerText()).includes("Relancé 1 fois"));

  await card.getByRole("button", { name: "Reçu" }).click();
  await page.waitForTimeout(1200);
  check("la balle revient chez moi", (await card.innerText()).includes("Chez moi"));

  await card.getByRole("button", { name: "Balle envoyée" }).click();
  await page.waitForTimeout(1200);
  check("la balle repart chez eux", (await card.innerText()).includes("Chez Camille"));

  await card.getByRole("button", { name: "Reporter" }).click();
  // Le panneau est rendu dans un portail : il est volontairement HORS de la
  // carte. Le chercher dans `card` reviendrait à réintroduire la version
  // découpée par `overflow-hidden`, qui était visible mais inopérante.
  const snooze = page.getByRole("button", { name: "+1 sem." });
  await snooze.waitFor({ timeout: 10000 });
  check(
    "le panneau de report sort de la carte",
    await snooze.evaluate((el) => el.closest("article") === null),
  );
  check(
    "et il est bien au premier plan",
    await snooze.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(top) || el === top;
    }),
  );
  await snooze.click();
  await page.waitForTimeout(1200);
  check("report appliqué", (await card.innerText()).includes("Dans "));

  for (const filter of ["À relancer", "Chez moi", "Chez eux", "Terminés", "Tous"]) {
    await page.getByRole("link", { name: filter, exact: true }).click();
    await page.waitForTimeout(500);
  }
  check("les cinq filtres répondent", new URL(page.url()).searchParams.get("f") === "all");

  await card.getByRole("button", { name: "Terminer" }).click();
  await page.waitForTimeout(1200);
  check("terminé : retiré de la liste ouverte", (await card.count()) === 0);

  await page.getByRole("link", { name: "Terminés", exact: true }).click();
  await page.waitForTimeout(800);
  const done = page.locator("article", { hasText: title });
  check("présent dans Terminés", (await done.count()) === 1);

  await done.getByRole("button", { name: "Rouvrir" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: "Tous", exact: true }).click();
  await page.waitForTimeout(800);
  check("rouvert", (await page.locator("article", { hasText: title }).count()) === 1);

  await page.locator("article", { hasText: title }).getByRole("button", { name: "Abandonner" }).click();
  await page.waitForTimeout(1200);
  check("abandonné", (await page.locator("article", { hasText: title }).count()) === 0);

  section("6. Parcours Tâches");
  const taskTitle = `Tâche E2E ${Date.now()}`;
  await page.getByRole("link", { name: "Tâches", exact: true }).first().click();
  await page.waitForURL("**/tasks", { timeout: 15000 });
  check("la navigation mène aux tâches", new URL(page.url()).pathname === "/tasks");

  // 1. Créer une tâche indépendante, due aujourd'hui (valeur par défaut).
  await page.getByRole("button", { name: "Nouvelle tâche" }).click();
  await page.fill("#taskTitle", taskTitle);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.waitForSelector(`text=${taskTitle}`, { timeout: 15000 });
  const taskRow = page.locator("article", { hasText: taskTitle });
  check("création d'une tâche indépendante", (await taskRow.count()) === 1);
  check("elle est due aujourd'hui", (await taskRow.innerText()).includes("Aujourd'hui"));

  // 2. Elle apparaît dans le cockpit.
  await page.getByRole("link", { name: "Aujourd'hui", exact: true }).first().click();
  await page.waitForURL("**/today", { timeout: 15000 });
  check(
    "la tâche du jour est dans le feed Aujourd'hui",
    (await page.locator("article", { hasText: taskTitle }).count()) === 1,
  );

  // 3. La terminer depuis le cockpit, 4. vérifier sa disparition.
  await page.locator("article", { hasText: taskTitle }).getByRole("button", { name: "Terminer" }).click();
  await page.waitForTimeout(1500);
  check(
    "terminée : elle quitte le feed immédiatement",
    (await page.locator("article", { hasText: taskTitle }).count()) === 0,
  );

  await page.goto("/tasks?f=done", { waitUntil: "networkidle" });
  check(
    "elle est retrouvable dans « Terminées »",
    (await page.locator("article", { hasText: taskTitle }).count()) === 1,
  );

  // 5. Créer une tâche liée à un contact — le contact vient du module Contacts,
  //    sans qu'aucun suivi ne soit créé au passage.
  const linkedTitle = `Tâche liée E2E ${Date.now()}`;
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouvelle tâche" }).click();
  await page.fill("#taskTitle", linkedTitle);
  await page.getByPlaceholder("Rechercher un contact...").click();
  await page.getByRole("option", { name: "Camille Durand" }).first().click();
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.waitForSelector(`text=${linkedTitle}`, { timeout: 15000 });
  const linkedRow = page.locator("article", { hasText: linkedTitle });
  check("création d'une tâche liée à un contact", (await linkedRow.count()) === 1);
  check("le contact est affiché sur la ligne", (await linkedRow.innerText()).includes("Camille"));
  check(
    "le contact mène à sa fiche",
    (await linkedRow.getByRole("link", { name: "Camille Durand" }).count()) === 1,
  );

  // 6. Reporter : la tâche quitte le feed du jour mais reste dans Tâches.
  await linkedRow.getByRole("button", { name: "Reporter" }).click();
  const snoozeTomorrow = page.getByRole("button", { name: "Demain", exact: true });
  await snoozeTomorrow.waitFor({ timeout: 10000 });
  await snoozeTomorrow.click();
  await page.waitForTimeout(1500);
  check("report appliqué", (await linkedRow.innerText()).includes("Demain"));

  await page.goto("/today", { waitUntil: "networkidle" });
  check(
    "reportée à demain : hors du feed Aujourd'hui",
    (await page.locator("article", { hasText: linkedTitle }).count()) === 0,
  );
  await page.goto("/tasks", { waitUntil: "networkidle" });
  check(
    "mais toujours présente dans Tâches",
    (await page.locator("article", { hasText: linkedTitle }).count()) === 1,
  );

  // 7. Responsive : aucun débordement horizontal, actions atteignables.
  for (const width of [1440, 1280, 1024, 430, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tasks", { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    check(`aucun défilement horizontal à ${width} px`, !overflow);
    check(
      `l'action « Terminer » reste utilisable à ${width} px`,
      await page
        .locator("article", { hasText: linkedTitle })
        .getByRole("button", { name: "Terminer" })
        .isVisible(),
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  section("7. Module Contacts");
  const contactName = `Contact E2E ${Date.now()}`;
  await page.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await page.waitForURL("**/contacts", { timeout: 15000 });
  check("la sidebar mène au module Contacts", new URL(page.url()).pathname === "/contacts");

  await page.getByRole("button", { name: "Nouveau contact" }).click();
  await page.fill("#firstName", contactName);
  await page.fill("#lastName", "Durand");
  await page.fill("#organizationName", "E2E Corp");
  await page.fill("#email", "e2e@example.test");
  await page.getByRole("button", { name: "Créer le contact" }).click();
  await page.waitForSelector(`text=${contactName}`, { timeout: 15000 });
  check("contact créé et listé", (await page.locator("article", { hasText: contactName }).count()) === 1);

  // La recherche passe par l'URL : c'est PostgreSQL qui filtre, pas le navigateur.
  await page.getByPlaceholder("Rechercher un contact...").fill(contactName);
  await page.waitForFunction(
    (value) => new URL(window.location.href).searchParams.get("q") === value,
    contactName,
    { timeout: 10000 },
  );
  check("la recherche est portée par l'URL", new URL(page.url()).searchParams.get("q") === contactName);
  check("le contact est retrouvé", (await page.locator("article", { hasText: contactName }).count()) === 1);

  await page.getByPlaceholder("Rechercher un contact...").fill("aucune-correspondance-possible");
  await page.waitForSelector("text=Aucun contact ne correspond", { timeout: 10000 });
  check("une recherche sans résultat le dit", true);

  await page.goto(`/contacts?q=${encodeURIComponent(contactName)}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: contactName }).click();
  await page.waitForSelector("text=Follow-Ups", { timeout: 15000 });
  check("la fiche contact s'ouvre", new URL(page.url()).pathname.startsWith("/contacts/"));
  check(
    "elle annonce l'absence de suivi",
    (await page.locator("text=Aucun suivi pour ce contact.").count()) === 1,
  );

  section("8. Déconnexion");
  await page.getByRole("button", { name: "Déconnexion" }).first().click();
  await page.waitForURL("**/login", { timeout: 15000 });
  check("redirection vers /login", new URL(page.url()).pathname === "/login");
  check("cookie supprimé", (await sessionCookie(context)) === undefined);

  for (const path of ["/follow-ups", "/tasks", "/today"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    check(`${path} est bien reprotégé`, new URL(page.url()).pathname === "/login");
  }

  section("9. Hygiène");
  check("aucune erreur JavaScript", consoleErrors.length === 0, consoleErrors.join(" | "));
  const html = await page.content();
  check(
    "aucun secret dans la page",
    !/AUTH_SECRET|DATABASE_URL|password_hash|argon2/i.test(html),
  );
} finally {
  await browser.close();
}

console.log(`\n${passed} vérification(s) réussie(s), ${failures.length} échec(s).`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
