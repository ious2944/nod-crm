import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction, createFollowUp } from "@/app/(app)/follow-ups/actions";
import { initialCreateState } from "@/lib/follow-ups/create-state";
import { parseFilter } from "@/lib/follow-ups/filters";
import { getFollowUpBoard } from "@/lib/follow-ups/queries";
import { prisma } from "@/lib/prisma";

import {
  createFollowUpRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/** Toutes les entrées viennent du client : aucune n'est prise pour argent comptant. */
describe("validation des entrées", () => {
  let user: TestUser;
  let followUpId: string;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("validation-ws");
    await signIn(user);
    followUpId = await createFollowUpRecord(user.workspaceId);
  });

  const invalidCreations: Array<[string, Record<string, string>]> = [
    ["sujet vide", { title: "   ", dueDate: "2026-05-01", ballOwner: "THEM" }],
    ["sujet trop long", { title: "x".repeat(161), dueDate: "2026-05-01", ballOwner: "THEM" }],
    ["échéance absente", { title: "Sujet", ballOwner: "THEM" }],
    ["échéance malformée", { title: "Sujet", dueDate: "01/05/2026", ballOwner: "THEM" }],
    ["échéance impossible", { title: "Sujet", dueDate: "2026-02-31", ballOwner: "THEM" }],
    ["échéance hors bornes", { title: "Sujet", dueDate: "9999-12-31", ballOwner: "THEM" }],
    ["côté de balle inconnu", { title: "Sujet", dueDate: "2026-05-01", ballOwner: "SOMEONE" }],
    [
      "contact non-UUID",
      { title: "Sujet", dueDate: "2026-05-01", ballOwner: "THEM", contactId: "42" },
    ],
    [
      "création rapide sans nom",
      { title: "Sujet", dueDate: "2026-05-01", ballOwner: "THEM", contactId: "new" },
    ],
    [
      "description trop longue",
      {
        title: "Sujet",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
        description: "x".repeat(2001),
      },
    ],
  ];

  it.each(invalidCreations)("refuse la création : %s", async (_label, fields) => {
    const result = await createFollowUp(initialCreateState, formData(fields));

    expect(result.status).toBe("error");
    expect(await prisma.followUp.count()).toBe(1);
  });

  const invalidActions: Array<[string, Record<string, string | number>]> = [
    ["intention inconnue", { id: "PLACEHOLDER", intent: "delete_everything" }],
    ["intention absente", { id: "PLACEHOLDER" }],
    ["identifiant absent", { intent: "complete" }],
    ["identifiant non-UUID", { id: "../../etc/passwd", intent: "complete" }],
    ["report négatif", { id: "PLACEHOLDER", intent: "snooze", days: -5 }],
    ["report démesuré", { id: "PLACEHOLDER", intent: "snooze", days: 9999 }],
    ["report non numérique", { id: "PLACEHOLDER", intent: "snooze", days: "beaucoup" }],
  ];

  it.each(invalidActions)("refuse l'action rapide : %s", async (_label, fields) => {
    const payload = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        value === "PLACEHOLDER" ? followUpId : value,
      ]),
    ) as Record<string, string | number>;

    await expect(applyQuickAction(formData(payload))).rejects.toThrow(/invalide/i);
  });

  it("nettoie les espaces superflus plutôt que de les stocker", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({ title: "   Sujet espacé   ", dueDate: "2026-05-01", ballOwner: "THEM" }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.followUp.findFirstOrThrow({ where: { title: "Sujet espacé" } });
    expect(created.title).toBe("Sujet espacé");
  });

  it("stocke le contenu tel quel, sans l'interpréter", async () => {
    // Le rendu React échappe : on veut vérifier qu'on ne mutile pas la donnée
    // à l'écriture, et qu'aucune interpolation SQL n'a lieu.
    const hostile = "<script>alert(1)</script> ' OR 1=1 --";
    const result = await createFollowUp(
      initialCreateState,
      formData({ title: hostile, dueDate: "2026-05-01", ballOwner: "THEM" }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.followUp.findFirstOrThrow({ where: { title: hostile } });
    expect(created.title).toBe(hostile);
    expect(await prisma.followUp.count()).toBe(2);
  });

  it("ramène un filtre inconnu au filtre par défaut", async () => {
    expect(parseFilter("nawak")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
    expect(parseFilter(["done", "me"])).toBe("done");
    expect(parseFilter("../../admin")).toBe("all");

    // Et la requête n'explose pas sur une valeur inattendue.
    await expect(getFollowUpBoard(parseFilter("nawak"))).resolves.toBeDefined();
  });
});


/** Caractères qui passent la validation « longueur » mais cassent ailleurs. */
describe("caractères hostiles dans le texte", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("texte-ws");
    await signIn(user);
  });

  it("refuse un sujet fait uniquement d'espaces invisibles", async () => {
    // U+200B (espace sans chasse), U+00A0 (insécable) et U+FEFF ne sont pas
    // retirés par `String.prototype.trim()` : un titre visuellement vide
    // passerait le `min(1)` et créerait un suivi sans sujet lisible.
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "\u200b\u00a0\ufeff",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
      }),
    );

    expect(result.status).toBe("error");
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("neutralise l'octet NUL, que PostgreSQL ne sait pas stocker", async () => {
    // Sans garde, Prisma transmettait la chaîne telle quelle et PostgreSQL
    // renvoyait « unsupported Unicode escape sequence » : une erreur 500
    // déclenchable par n'importe quel utilisateur authentifié.
    // Le caractère est retiré plutôt que la saisie refusée : aucun humain ne
    // tape un NUL, et un message d'erreur à son sujet serait incompréhensible.
    const result = await createFollowUp(
      initialCreateState,
      formData({
        title: "Sujet\u0000injecte",
        dueDate: "2026-05-01",
        ballOwner: "THEM",
      }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.followUp.findFirstOrThrow();
    expect(created.title).toBe("Sujetinjecte");
  });

  it("accepte les accents, les emojis et les alphabets non latins", async () => {
    const title = "Réunion 会議 🏓 Ελλάδα";
    const result = await createFollowUp(
      initialCreateState,
      formData({ title, dueDate: "2026-05-01", ballOwner: "THEM" }),
    );

    expect(result.status).toBe("success");
    expect(await prisma.followUp.findFirstOrThrow({ where: { title } })).toBeTruthy();
  });

  it("borne la longueur même en présence d'emojis", async () => {
    const result = await createFollowUp(
      initialCreateState,
      formData({ title: "🏓".repeat(160), dueDate: "2026-05-01", ballOwner: "THEM" }),
    );

    expect(result.status).toBe("error");
  });
});
