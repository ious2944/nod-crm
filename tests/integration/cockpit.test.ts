import { beforeEach, describe, expect, it } from "vitest";

import { applyQuickAction } from "@/app/(app)/follow-ups/actions";
import { STAGNATION_DAYS, UPCOMING_WINDOW_DAYS } from "@/lib/cockpit/domain";
import { getCockpit } from "@/lib/cockpit/queries";
import { APP_TIME_ZONE } from "@/lib/config";
import { shiftDueDate, startOfDay, dayKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";

import {
  createContactRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Cockpit « Aujourd'hui » — lecture réelle, base réelle.
 *
 * Les règles de priorisation sont couvertes en unitaire
 * (`src/lib/cockpit/domain.test.ts`). Ce fichier vérifie ce que seul un vrai
 * PostgreSQL peut prouver : que la requête ne sort jamais du workspace de la
 * session, que `updated_at` porte bien la stagnation, et que les compteurs
 * annoncent exactement ce que leur filtre montre.
 */

/** Crée un suivi à une échéance relative, en jours de `APP_TIME_ZONE`. */
async function createFollowUp(
  workspaceId: string,
  options: {
    title: string;
    dueInDays: number;
    ballOwner?: "ME" | "THEM";
    status?: "OPEN" | "COMPLETED";
    /** Ancienneté forcée du dernier mouvement, en jours. */
    idleDays?: number;
    contactId?: string;
  },
): Promise<string> {
  const now = new Date();
  const followUp = await prisma.followUp.create({
    data: {
      workspaceId,
      contactId: options.contactId ?? null,
      title: options.title,
      ballOwner: options.ballOwner ?? "THEM",
      status: options.status ?? "OPEN",
      dueAt: shiftDueDate(now, options.dueInDays, APP_TIME_ZONE),
      completedAt: options.status === "COMPLETED" ? now : null,
    },
    select: { id: true },
  });

  if (options.idleDays !== undefined) {
    // `updated_at` est géré par Prisma (`@updatedAt`) : pour simuler un suivi
    // figé depuis des semaines, on le réécrit en SQL brut — le seul moyen de
    // poser une date de dernier mouvement dans le passé.
    await prisma.$executeRaw`
      UPDATE follow_ups
      SET updated_at = ${shiftDueDate(now, -options.idleDays, APP_TIME_ZONE)}
      WHERE id = ${followUp.id}::uuid
    `;
  }

  return followUp.id;
}

describe("cockpit — isolation des workspaces", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    alice = await createWorkspaceWithUser("alice-cockpit");
    bob = await createWorkspaceWithUser("bob-cockpit");

    // Bob remplit chaque zone du cockpit. Aucune ne doit fuir chez Alice.
    await createFollowUp(bob.workspaceId, { title: "Retard de Bob", dueInDays: -9 });
    await createFollowUp(bob.workspaceId, { title: "Jour de Bob", dueInDays: 0 });
    await createFollowUp(bob.workspaceId, { title: "À venir de Bob", dueInDays: 2 });
    await createFollowUp(bob.workspaceId, {
      title: "Figé chez Bob",
      dueInDays: 30,
      idleDays: 40,
    });

    await signIn(alice);
  });

  it("ne montre rien à Alice quand tout appartient à Bob", async () => {
    const cockpit = await getCockpit("all");

    expect(cockpit.openTotal).toBe(0);
    expect(cockpit.counters).toEqual({ late: 0, today: 0, upcoming: 0, waiting: 0 });
    expect(cockpit.feed.items).toEqual([]);
    expect(cockpit.feed.total).toBe(0);
    expect(cockpit.upcoming.items).toEqual([]);
    expect(cockpit.waiting.items).toEqual([]);
  });

  it("ne montre à Alice que ses propres suivis, dans chaque zone", async () => {
    await createFollowUp(alice.workspaceId, { title: "Retard d'Alice", dueInDays: -3 });
    await createFollowUp(alice.workspaceId, { title: "À venir d'Alice", dueInDays: 2 });

    const cockpit = await getCockpit("all");
    const titles = [
      ...cockpit.feed.items,
      ...cockpit.upcoming.items,
      ...cockpit.waiting.items,
    ].map((item) => item.title);

    expect(titles.every((title) => title.includes("Alice"))).toBe(true);
    expect(cockpit.openTotal).toBe(2);
  });

  it("ne fuit pas non plus sous un filtre explicite", async () => {
    for (const filter of ["late", "today", "upcoming", "waiting"] as const) {
      const cockpit = await getCockpit(filter);
      expect(cockpit.feed.items).toEqual([]);
    }
  });

  it("ne laisse pas Alice agir sur un suivi de Bob depuis le cockpit", async () => {
    const bobFollowUp = await createFollowUp(bob.workspaceId, {
      title: "Intouchable",
      dueInDays: -1,
    });

    await expect(
      applyQuickAction(formData({ id: bobFollowUp, intent: "complete" })),
    ).rejects.toThrow("Suivi introuvable.");

    const untouched = await prisma.followUp.findUniqueOrThrow({
      where: { id: bobFollowUp },
      select: { status: true },
    });
    expect(untouched.status).toBe("OPEN");
  });
});

describe("cockpit — groupes et compteurs", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("cockpit-ws");
    await signIn(user);
  });

  it("range chaque suivi dans le bon groupe", async () => {
    await createFollowUp(user.workspaceId, { title: "Très en retard", dueInDays: -11 });
    await createFollowUp(user.workspaceId, { title: "Un peu en retard", dueInDays: -2 });
    await createFollowUp(user.workspaceId, { title: "Aujourd'hui", dueInDays: 0 });
    await createFollowUp(user.workspaceId, { title: "Demain", dueInDays: 1 });
    await createFollowUp(user.workspaceId, { title: "Dans 5 jours", dueInDays: 5 });

    const cockpit = await getCockpit("all");

    expect(cockpit.counters.late).toBe(2);
    expect(cockpit.counters.today).toBe(1);
    expect(cockpit.counters.upcoming).toBe(2);
    expect(cockpit.feed.items.map((item) => item.title)).toEqual([
      "Très en retard",
      "Un peu en retard",
      "Aujourd'hui",
      "Demain",
      "Dans 5 jours",
    ]);
  });

  it("exclut les suivis terminés et abandonnés de toutes les zones", async () => {
    await createFollowUp(user.workspaceId, {
      title: "Terminé",
      dueInDays: -20,
      status: "COMPLETED",
    });
    await createFollowUp(user.workspaceId, { title: "Ouvert", dueInDays: -1 });

    const cockpit = await getCockpit("all");

    expect(cockpit.openTotal).toBe(1);
    expect(cockpit.counters.late).toBe(1);
    expect(cockpit.feed.items.map((item) => item.title)).toEqual(["Ouvert"]);
  });

  it("écarte du feed par défaut les échéances au-delà de la fenêtre", async () => {
    await createFollowUp(user.workspaceId, {
      title: "Lointain",
      dueInDays: UPCOMING_WINDOW_DAYS + 5,
    });

    const cockpit = await getCockpit("all");

    expect(cockpit.openTotal).toBe(1);
    expect(cockpit.counters.upcoming).toBe(0);
    expect(cockpit.feed.items).toEqual([]);
    expect(cockpit.upcoming.items).toEqual([]);
    // Il reste néanmoins « chez eux » : il n'est pas perdu, juste pas urgent.
    expect(cockpit.counters.waiting).toBe(1);
    expect(cockpit.waiting.items.map((item) => item.title)).toEqual(["Lointain"]);
  });

  it("fait dire au compteur exactement ce que son filtre montre", async () => {
    await createFollowUp(user.workspaceId, { title: "R1", dueInDays: -4 });
    await createFollowUp(user.workspaceId, { title: "R2", dueInDays: -1 });
    await createFollowUp(user.workspaceId, { title: "J", dueInDays: 0, ballOwner: "ME" });
    await createFollowUp(user.workspaceId, { title: "V", dueInDays: 3, ballOwner: "ME" });

    const { counters } = await getCockpit("all");

    for (const [key, expected] of Object.entries(counters)) {
      const filtered = await getCockpit(key as "late" | "today" | "upcoming" | "waiting");
      expect(filtered.feed.total, `filtre ${key}`).toBe(expected);
    }
  });
});

describe("cockpit — stagnation", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("stagnation-ws");
    await signIn(user);
  });

  it("remonte un suivi figé alors même qu'il n'est pas en retard", async () => {
    await createFollowUp(user.workspaceId, {
      title: "Devis en attente",
      dueInDays: 20,
      idleDays: STAGNATION_DAYS + 7,
    });

    const cockpit = await getCockpit("all");
    const [item] = cockpit.feed.items;

    expect(item.title).toBe("Devis en attente");
    expect(item.reason).toBe("stagnant");
    expect(item.idleDays).toBe(STAGNATION_DAYS + 7);
    expect(item.stagnationLabel).toBe(`Sans mouvement depuis ${STAGNATION_DAYS + 7} j`);
  });

  it("n'alerte pas sur un suivi dont la balle est chez moi", async () => {
    await createFollowUp(user.workspaceId, {
      title: "À moi de jouer",
      dueInDays: 20,
      ballOwner: "ME",
      idleDays: 40,
    });

    const cockpit = await getCockpit("all");

    expect(cockpit.feed.items).toEqual([]);
    expect(cockpit.waiting.items).toEqual([]);
  });

  it("remet le compteur à zéro dès qu'une action touche le suivi", async () => {
    const id = await createFollowUp(user.workspaceId, {
      title: "Relance à faire",
      dueInDays: 20,
      idleDays: 30,
    });

    expect((await getCockpit("all")).feed.items[0].idleDays).toBe(30);

    // La relance passe par la Server Action du module Follow-up : c'est elle
    // qui réécrit `updated_at`, donc le cockpit n'a rien de spécial à faire.
    await applyQuickAction(formData({ id, intent: "nudge" }));

    const after = await getCockpit("all");
    expect(after.feed.items[0].idleDays).toBe(0);
    expect(after.feed.items[0].stagnationLabel).toBeNull();
    expect(after.feed.items[0].nudgeLabel).toBe("Relancé 1 fois");
  });

  it("trie « en attente chez eux » de la plus longue attente à la plus courte", async () => {
    await createFollowUp(user.workspaceId, { title: "3 jours", dueInDays: 4, idleDays: 3 });
    await createFollowUp(user.workspaceId, { title: "21 jours", dueInDays: 4, idleDays: 21 });
    await createFollowUp(user.workspaceId, { title: "9 jours", dueInDays: 4, idleDays: 9 });

    const cockpit = await getCockpit("all");

    expect(cockpit.waiting.items.map((item) => item.title)).toEqual([
      "21 jours",
      "9 jours",
      "3 jours",
    ]);
  });
});

describe("cockpit — contacts et fuseau", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("cockpit-tz");
    await signIn(user);
  });

  it("porte le contact et son organisation jusqu'à la ligne", async () => {
    const contactId = await createContactRecord(user.workspaceId, {
      firstName: "Arnaud",
      lastName: "Dupont",
      organizationName: "Carrefour",
    });
    await createFollowUp(user.workspaceId, {
      title: "Relancer proposition",
      dueInDays: -11,
      contactId,
    });

    const [item] = (await getCockpit("all")).feed.items;

    expect(item.contact.name).toBe("Arnaud Dupont");
    expect(item.contact.href).toBe(`/contacts/${contactId}`);
    expect(item.contact.organizationName).toBe("Carrefour");
    expect(item.ballLabel).toBe("Chez Arnaud");
    expect(item.dueLabel).toBe("J+11");
  });

  it("considère « aujourd'hui » à l'échelle de la journée parisienne", async () => {
    // Échéance posée à minuit heure de Paris pour la date du jour : elle est
    // stockée à 22 h UTC la veille (heure d'été). Une comparaison naïve en UTC
    // la déclarerait en retard.
    const todayKey = dayKey(new Date(), APP_TIME_ZONE);
    await prisma.followUp.create({
      data: {
        workspaceId: user.workspaceId,
        title: "Dû aujourd'hui",
        ballOwner: "THEM",
        dueAt: startOfDay(todayKey, APP_TIME_ZONE),
      },
    });

    const cockpit = await getCockpit("all");

    expect(cockpit.counters.today).toBe(1);
    expect(cockpit.counters.late).toBe(0);
    expect(cockpit.feed.items[0].dueLabel).toBe("Aujourd'hui");
  });
});
