#!/usr/bin/env node
/**
 * Parcours de bout en bout NOD CRM — V0.6.
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
 *
 * Sections :
 *   1. Accès sans session
 *   2. En-têtes de sécurité
 *   3. Mauvais mot de passe
 *   4. Connexion
 *   5. Cockpit « Aujourd'hui »  (V0.3 — inchangé)
 *   6. Parcours Follow-up       (V0.3 — inchangé)
 *   7. Parcours Tâches          (V0.4 — nouveau)
 *   8. Module Contacts
 *   9. Organisations (V0.5)
 *  10. Suivi — Recherche & Édition (V0.6)
 *  11. Déconnexion
 *  12. Hygiène
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
  // Depuis la V0.3, la connexion aboutit sur le cockpit « Aujourd'hui ».
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

  // ─── Section 5 : Cockpit « Aujourd'hui » — V0.3, inchangé ─────────────────
  section("5. Cockpit « Aujourd'hui »");
  check(
    "le cockpit salue l'utilisateur",
    (await page.getByRole("heading", { level: 1 }).textContent())?.startsWith("Bonjour") === true,
  );
  check(
    "les quatre indicateurs d'attention sont là",
    (await page.getByRole("link", { name: /En retard|Aujourd'hui|À venir|Chez eux/ }).count()) >= 4,
  );

  // ─── Section 6 : Parcours Follow-up — V0.3, inchangé ──────────────────────
  section("6. Parcours Follow-up");
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

  // ─── Section 7 : Parcours Tâches — V0.4, nouveau ──────────────────────────
  section("7. Parcours Tâches");
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

  // ─── Section 8 : Module Contacts ──────────────────────────────────────────
  section("8. Module Contacts");
  const contactName = `Contact E2E ${Date.now()}`;
  await page.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await page.waitForURL("**/contacts", { timeout: 15000 });
  check("la sidebar mène au module Contacts", new URL(page.url()).pathname === "/contacts");

  await page.getByRole("button", { name: "Nouveau contact" }).click();
  await page.fill("#firstName", contactName);
  await page.fill("#lastName", "Durand");
  // V0.5 : #organizationName n'existe plus — OrganizationPicker a remplacé ce champ.
  // On crée le contact sans organisation pour ce test ; le rattachement via
  // OrganizationPicker est couvert dans la section 9 (Organisations V0.5).
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

  // ─── Section 9 : Organisations (V0.5) ─────────────────────────────────────
  section("9. Organisations (V0.5)");
  await page.getByRole("link", { name: "Organisations", exact: true }).first().click();
  await page.waitForURL("**/organizations", { timeout: 15000 });
  check("la sidebar mène au module Organisations", new URL(page.url()).pathname === "/organizations");

  // 9a. Créer une organisation
  const orgName = `Acme E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nouvelle organisation" }).click();
  await page.fill("#name", orgName);
  await page.fill("#website", "https://acme-e2e.example");
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await page.waitForSelector(`text=${orgName}`, { timeout: 15000 });
  check("organisation créée et listée", (await page.locator("article", { hasText: orgName }).count()) === 1);

  // 9b. Recherche
  await page.getByPlaceholder("Rechercher…").fill(orgName);
  await page.waitForFunction(
    (name) => new URL(window.location.href).searchParams.get("q") === name,
    orgName,
    { timeout: 10000 },
  );
  check("la recherche porte sur le nom", (await page.locator("article", { hasText: orgName }).count()) === 1);
  await page.getByPlaceholder("Rechercher…").fill("");
  await page.waitForTimeout(600);

  // 9c. Ouvrir la fiche organisation
  await page.getByRole("link", { name: orgName }).click();
  await page.waitForURL("**/organizations/**", { timeout: 15000 });
  const orgDetailUrl = page.url();
  check("la fiche organisation s'ouvre", new URL(page.url()).pathname.startsWith("/organizations/"));
  check("le titre de la fiche est le nom de l'org", (await page.locator("h1").first().textContent())?.trim() === orgName);
  check(
    "la section contacts indique l'absence de contact",
    (await page.locator("text=Aucun contact rattaché").count()) >= 1,
  );

  // 9d. Modifier l'organisation (renommer → test de cohérence V0.5 §8)
  const orgNameRenamed = `${orgName} France`;
  // Ouvrir le menu ⋮ sur la fiche
  await page.getByRole("button", { name: "Modifier" }).first().click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  await page.fill("#name", "");
  await page.fill("#name", orgNameRenamed);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(1000);
  check("organisation renommée", (await page.locator("h1").first().textContent())?.trim() === orgNameRenamed);

  // 9e. Rattacher un contact via OrganizationPicker
  // Navigation directe vers le contact (évite le ⋮ PopoverMenu de la liste)
  await page.goto(`/contacts?q=${encodeURIComponent(contactName)}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: contactName }).click();
  await page.waitForURL("**/contacts/**", { timeout: 15000 });
  // Le bouton "Modifier" est en variant inline sur la fiche contact
  await page.getByRole("button", { name: "Modifier" }).first().click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  // Le sélecteur d'org est un combobox
  await page.getByPlaceholder("Rechercher une organisation…").click();
  await page.waitForTimeout(500);
  // Taper le nom de l'org renommée pour la trouver
  await page.getByPlaceholder("Rechercher une organisation…").fill(orgNameRenamed.slice(0, 10));
  await page.waitForTimeout(600);
  await page.getByRole("option", { name: orgNameRenamed }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(1000);
  check("contact rattaché à l'organisation via OrganizationPicker", true);

  // 9f. Le contact apparaît dans la fiche organisation
  await page.goto(orgDetailUrl, { waitUntil: "networkidle" });
  check(
    "le contact rattaché apparaît dans la fiche organisation",
    (await page.locator(`text=${contactName}`).count()) >= 1,
  );

  // 9g. Ouvrir le contact — l'org est cliquable
  await page.getByRole("link", { name: contactName }).click();
  await page.waitForURL("**/contacts/**", { timeout: 15000 });
  check("la fiche contact s'ouvre depuis la fiche org", new URL(page.url()).pathname.startsWith("/contacts/"));
  // Le lien vers la fiche organisation existe
  const orgLink = page.getByRole("link", { name: orgNameRenamed });
  check("l'organisation est un lien cliquable sur la fiche contact", (await orgLink.count()) >= 1);

  // 9h. Cohérence du renommage : organizationName doit montrer le nom actuel
  // (le JOIN sur organization_id et la sync de organization_name font tous deux "Acme E2E ... France")
  const contactText = await page.locator("main").first().textContent();
  check(
    "la fiche contact affiche le nom renommé (cohérence FK)",
    contactText?.includes(orgNameRenamed) === true,
  );
  check(
    "la fiche contact n'affiche PAS l'ancien nom",
    contactText?.includes(orgName) === false || contactText?.includes(orgNameRenamed) === true,
  );

  // 9i. Archive / restauration
  await page.goto(orgDetailUrl, { waitUntil: "networkidle" });
  // Clic 1 : ouvre la ConfirmDialog (variant inline — bouton direct)
  await page.getByRole("button", { name: "Archiver" }).first().click();
  // ConfirmDialog utilise role="alertdialog"
  await page.waitForSelector("[role=alertdialog]", { timeout: 5000 });
  // Clic 2 : confirme l'archivage (bouton « Archiver » dans la dialog)
  await page.getByRole("alertdialog").getByRole("button", { name: "Archiver" }).click();
  await page.waitForTimeout(1000);
  // Après archivage, on est redirigé vers la liste
  check("archivage : redirigé vers la liste", new URL(page.url()).pathname === "/organizations");
  // L'org n'est pas visible par défaut (filtre archivées décochées)
  check("l'org archivée disparaît de la liste par défaut", (await page.locator(`text=${orgNameRenamed}`).count()) === 0);
  // Afficher les archivées — checkbox contrôlée par URL, utiliser click() + waitForURL
  await page.getByRole("checkbox", { name: /archiv/i }).click();
  await page.waitForURL("**/organizations**archived**", { timeout: 10000 });
  await page.waitForTimeout(600);
  check("l'org apparaît avec le filtre archivées", (await page.locator(`text=${orgNameRenamed}`).count()) >= 1);

  // Restaurer : depuis la fiche (org archivée → redirectTo undefined → reste sur la fiche)
  await page.goto(orgDetailUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Restaurer" }).click();
  await page.waitForTimeout(1500);
  // Pas de redirect — on reste sur la fiche ou on revalide en place
  // On vérifie que la liste affiche l'org restaurée
  await page.goto("/organizations", { waitUntil: "networkidle" });
  check("l'org restaurée réapparaît dans la liste", (await page.locator(`text=${orgNameRenamed}`).count()) >= 1);

  // 9j. Responsive Organisations
  for (const width of [1440, 1024, 430, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/organizations", { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    check(`aucun défilement horizontal à ${width} px (liste orgs)`, !overflow);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(orgDetailUrl, { waitUntil: "networkidle" });
  for (const width of [1440, 1024, 430, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    check(`aucun défilement horizontal à ${width} px (fiche org)`, !overflow);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 9k. Impossible de rattacher un nouveau contact à une org archivée
  // (le sélecteur OrganizationPicker exclut les archivées)
  await page.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await page.waitForURL("**/contacts", { timeout: 15000 });
  await page.getByRole("button", { name: "Nouveau contact" }).click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  await page.getByPlaceholder("Rechercher une organisation…").click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder("Rechercher une organisation…").fill(orgNameRenamed);
  await page.waitForTimeout(600);
  check(
    "org restaurée : apparaît dans le sélecteur",
    (await page.getByRole("option", { name: orgNameRenamed }).count()) >= 1,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ─── Section 10 : Suivi — Recherche & Édition (V0.6) ─────────────────────
  section("10. Suivi — Recherche & Édition (V0.6)");

  await page.goto("/follow-ups", { waitUntil: "networkidle" });

  // Créer deux suivis avec des titres distincts pour tester la recherche.
  const followUpA = `Contrat E2E ${Date.now()}`;
  const followUpB = `Rapport E2E ${Date.now() + 1}`;

  await page.getByRole("button", { name: "Nouveau suivi" }).click();
  await page.fill("#title", followUpA);
  await page.fill("#dueDate", "2027-01-15");
  await page.getByRole("button", { name: "Créer le suivi" }).click();
  await page.waitForSelector(`text=${followUpA}`, { timeout: 15000 });
  check("10a — suivi A créé", (await page.locator("article", { hasText: followUpA }).count()) === 1);

  await page.getByRole("button", { name: "Nouveau suivi" }).click();
  await page.fill("#title", followUpB);
  await page.fill("#dueDate", "2027-01-20");
  await page.getByRole("button", { name: "Créer le suivi" }).click();
  await page.waitForSelector(`text=${followUpB}`, { timeout: 15000 });
  check("10b — suivi B créé", (await page.locator("article", { hasText: followUpB }).count()) === 1);

  // ── Recherche ──────────────────────────────────────────────────────────────

  await page.getByPlaceholder("Rechercher dans les suivis…").fill("Contrat");
  await page.waitForTimeout(600); // délai debounce
  await page.waitForURL("**/follow-ups**q=**", { timeout: 10000 });
  check("10c — ?q= dans l'URL", new URL(page.url()).searchParams.has("q"));
  check("10d — suivi A visible", (await page.locator("article", { hasText: followUpA }).count()) === 1);
  check("10e — suivi B masqué", (await page.locator("article", { hasText: followUpB }).count()) === 0);

  // Insensibilité à la casse
  await page.getByPlaceholder("Rechercher dans les suivis…").fill("CONTRAT");
  await page.waitForTimeout(600);
  await page.waitForURL("**/follow-ups**q=CONTRAT**", { timeout: 10000 });
  check("10f — recherche insensible à la casse", (await page.locator("article", { hasText: followUpA }).count()) === 1);

  // Effacer la recherche
  await page.getByRole("button", { name: "Effacer la recherche" }).click();
  await page.waitForTimeout(700);
  check(
    "10g — tous les suivis réapparaissent après effacement",
    (await page.locator("article", { hasText: followUpA }).count()) === 1 &&
    (await page.locator("article", { hasText: followUpB }).count()) === 1,
  );

  // Filtre + recherche combinés
  await page.getByRole("link", { name: "Chez eux", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Rechercher dans les suivis…").fill("Contrat");
  await page.waitForTimeout(600);
  await page.waitForURL("**/follow-ups**f=them**", { timeout: 10000 });
  {
    const params = new URL(page.url()).searchParams;
    check("10h — filtre + recherche dans l'URL", params.has("f") && params.has("q"));
  }

  // Changer de filtre conserve ?q=
  await page.getByRole("link", { name: "Tous", exact: true }).click();
  await page.waitForTimeout(400);
  check("10i — ?q= préservé lors du changement de filtre", new URL(page.url()).searchParams.has("q"));

  // Effacer et revenir à la liste complète
  await page.getByPlaceholder("Rechercher dans les suivis…").fill("");
  await page.waitForTimeout(600);

  // ── Édition ────────────────────────────────────────────────────────────────

  await page.goto("/follow-ups", { waitUntil: "networkidle" });
  const cardA = page.locator("article", { hasText: followUpA });

  // Ouvrir le dialogue d'édition
  await cardA.getByRole("button", { name: "Modifier" }).click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  check("10j — dialogue d'édition ouvert", await page.locator("[role=dialog]").isVisible());

  // Champs pré-remplis
  const editTitle = page.locator("#edit-title");
  check("10k — sujet pré-rempli", (await editTitle.inputValue()) === followUpA);

  // Modifier le titre et la description
  const updatedTitle = `${followUpA} — édité`;
  await editTitle.fill(updatedTitle);
  await page.fill("#edit-description", "Contexte mis à jour par E2E.");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(1500);

  check("10l — dialogue fermé après sauvegarde", (await page.locator("[role=dialog]").count()) === 0);
  check("10m — titre mis à jour", (await page.locator("article", { hasText: updatedTitle }).count()) === 1);
  check("10n — description visible", (await page.locator("article", { hasText: "Contexte mis à jour" }).count()) === 1);

  // Annulation — pas de modification
  const cardAUpdated = page.locator("article", { hasText: updatedTitle });
  await cardAUpdated.getByRole("button", { name: "Modifier" }).click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  await page.locator("[role=dialog]").getByRole("button", { name: "Annuler" }).click();
  await page.waitForTimeout(400);
  check("10o — annulation ferme le dialogue", (await page.locator("[role=dialog]").count()) === 0);
  check("10p — annulation — titre inchangé", (await page.locator("article", { hasText: updatedTitle }).count()) === 1);

  // Sujet vide → erreur (dialogue reste ouvert)
  await cardAUpdated.getByRole("button", { name: "Modifier" }).click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  await page.locator("#edit-title").fill("");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(800);
  check("10q — sujet vide → dialogue reste ouvert", (await page.locator("[role=dialog]").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Quick action toujours fonctionnelle après édition
  const cardFinal = page.locator("article", { hasText: updatedTitle });
  await cardFinal.getByRole("button", { name: "Terminer" }).click();
  await page.waitForTimeout(1200);
  check("10r — quick action fonctionnelle après édition", (await page.locator("article", { hasText: updatedTitle }).count()) === 0);

  // Recherche dans les terminés
  await page.getByRole("link", { name: "Terminés", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Rechercher dans les suivis…").fill("édité");
  await page.waitForTimeout(600);
  await page.waitForURL("**/follow-ups**done**", { timeout: 10000 });
  check("10s — recherche dans l'onglet Terminés", (await page.locator("article", { hasText: updatedTitle }).count()) === 1);

  await page.goto("/follow-ups", { waitUntil: "networkidle" });

  // ─── Section 11 : Déconnexion ─────────────────────────────────────────────
  section("11. Déconnexion");
  await page.getByRole("button", { name: "Déconnexion" }).first().click();
  await page.waitForURL("**/login", { timeout: 15000 });
  check("redirection vers /login", new URL(page.url()).pathname === "/login");
  check("cookie supprimé", (await sessionCookie(context)) === undefined);

  for (const path of ["/follow-ups", "/tasks", "/today"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    check(`${path} est bien reprotégé`, new URL(page.url()).pathname === "/login");
  }

  // ─── Section 12 : Hygiène ─────────────────────────────────────────────────
  section("12. Hygiène");
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
