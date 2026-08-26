import { describe, expect, it } from "vitest";

import { startOfDay } from "@/lib/date";
import {
  compareFeed,
  compareUpcoming,
  compareWaiting,
  computeIdleDays,
  feedReason,
  greetingName,
  idleLabel,
  isStagnant,
  reasonLabel,
  stagnationLabel,
  STAGNATION_DAYS,
  UPCOMING_WINDOW_DAYS,
  type CockpitSignals,
} from "./domain";
import { belongsToFeed, matchesCockpitFilter, parseCockpitFilter } from "./filters";
import { toCockpitItem, todayLabel, type CockpitRecord } from "./view";

const PARIS = "Europe/Paris";
/** Mercredi 10 juin 2026, 9 h à Paris. */
const NOW = new Date("2026-06-10T09:00:00+02:00");

function signals(overrides: Partial<CockpitSignals> = {}): CockpitSignals {
  return {
    status: "OPEN",
    ballOwner: "THEM",
    overdueDays: 0,
    idleDays: 0,
    ...overrides,
  };
}

function record(overrides: Partial<CockpitRecord> = {}): CockpitRecord {
  return {
    id: "id-1",
    title: "Relancer proposition",
    description: null,
    status: "OPEN",
    ballOwner: "THEM",
    dueAt: startOfDay("2026-06-10", PARIS),
    nudgeCount: 0,
    lastNudgedAt: null,
    isDemo: false,
    createdAt: startOfDay("2026-06-01", PARIS),
    updatedAt: startOfDay("2026-06-10", PARIS),
    completedAt: null,
    contact: null,
    ...overrides,
  };
}

describe("computeIdleDays", () => {
  it("compte les jours calendaires depuis le dernier mouvement", () => {
    expect(computeIdleDays(startOfDay("2026-06-01", PARIS), NOW, PARIS)).toBe(9);
    expect(computeIdleDays(startOfDay("2026-06-10", PARIS), NOW, PARIS)).toBe(0);
  });

  it("ne descend jamais sous zéro, même si l'horloge a reculé", () => {
    expect(computeIdleDays(startOfDay("2026-06-12", PARIS), NOW, PARIS)).toBe(0);
  });
});

describe("stagnation", () => {
  it("ne concerne que les suivis ouverts dont la balle est chez eux", () => {
    const idle = { idleDays: STAGNATION_DAYS };

    expect(isStagnant(signals({ ballOwner: "THEM", ...idle }))).toBe(true);
    expect(isStagnant(signals({ ballOwner: "ME", ...idle }))).toBe(false);
    expect(isStagnant(signals({ status: "COMPLETED", ...idle }))).toBe(false);
  });

  it("ne se déclenche qu'au seuil, pas avant", () => {
    expect(isStagnant(signals({ idleDays: STAGNATION_DAYS - 1 }))).toBe(false);
    expect(stagnationLabel(STAGNATION_DAYS - 1)).toBeNull();
    expect(stagnationLabel(14)).toBe("Sans mouvement depuis 14 j");
  });

  it("sait dire l'ancienneté même sous le seuil", () => {
    expect(idleLabel(0)).toBe("Mouvement aujourd'hui");
    expect(idleLabel(1)).toBe("Sans mouvement depuis 1 j");
    expect(idleLabel(3)).toBe("Sans mouvement depuis 3 j");
    // Même unité que l'alerte de stagnation : les deux cohabitent dans la
    // section « En attente chez eux ».
    expect(idleLabel(26)).toBe(stagnationLabel(26));
  });
});

describe("feedReason", () => {
  it("classe le retard, la journée, la stagnation, puis l'à-venir", () => {
    expect(feedReason(signals({ overdueDays: 11 }))).toBe("late");
    expect(feedReason(signals({ overdueDays: 1 }))).toBe("late");
    expect(feedReason(signals({ overdueDays: 0 }))).toBe("today");
    expect(feedReason(signals({ overdueDays: -3, idleDays: 20 }))).toBe("stagnant");
    expect(feedReason(signals({ overdueDays: -3, idleDays: 0 }))).toBe("upcoming");
    expect(feedReason(signals({ overdueDays: -UPCOMING_WINDOW_DAYS }))).toBe("upcoming");
  });

  it("écarte du feed ce qui est lointain et ce qui est clos", () => {
    expect(feedReason(signals({ overdueDays: -UPCOMING_WINDOW_DAYS - 1 }))).toBe("later");
    expect(feedReason(signals({ status: "COMPLETED", overdueDays: 5 }))).toBeNull();
    expect(feedReason(signals({ status: "ABANDONED", overdueDays: 5 }))).toBeNull();
  });

  it("fait passer le retard avant la stagnation", () => {
    // Un suivi peut être les deux à la fois : c'est le retard qui prime.
    const both = signals({ overdueDays: 4, idleDays: 30 });
    expect(isStagnant(both)).toBe(true);
    expect(feedReason(both)).toBe("late");
  });

  it("nomme chaque motif en clair", () => {
    expect(reasonLabel("late")).toBe("En retard");
    expect(reasonLabel("stagnant")).toBe("Sans mouvement");
  });
});

describe("ordre du feed", () => {
  const items = [
    record({ id: "e", dueAt: startOfDay("2026-06-11", PARIS) }),
    record({ id: "g", dueAt: startOfDay("2026-06-30", PARIS) }),
    record({ id: "a", dueAt: startOfDay("2026-06-04", PARIS) }),
    record({ id: "c", dueAt: startOfDay("2026-06-10", PARIS) }),
    record({
      id: "d",
      dueAt: startOfDay("2026-06-13", PARIS),
      updatedAt: startOfDay("2026-05-25", PARIS),
    }),
    record({ id: "b", dueAt: startOfDay("2026-05-29", PARIS) }),
    record({ id: "f", dueAt: startOfDay("2026-06-15", PARIS) }),
  ].map((entry) => toCockpitItem(entry, NOW, PARIS));

  it("descend du plus en retard vers le plus lointain", () => {
    expect([...items].sort(compareFeed).map((item) => item.id)).toEqual([
      "b", // en retard de 12 jours
      "a", // en retard de 6 jours
      "c", // dû aujourd'hui
      "d", // sans mouvement depuis 16 jours
      "e", // demain
      "f", // dans 5 jours
      "g", // au-delà de la fenêtre : hors feed par défaut
    ]);
  });

  it("ne garde dans le feed par défaut que ce qui appelle une action aujourd'hui", () => {
    const feed = items
      .filter((item) => belongsToFeed("all", item))
      .sort(compareFeed)
      .map((item) => item.id);

    // Retards, journée et stagnation. Ni « e »/« f » (échéances proches, que
    // la section « Prochainement » affiche déjà), ni « g » (lointain).
    expect(feed).toEqual(["b", "a", "c", "d"]);
  });

  it("laisse « À venir » et « Chez eux » rattraper ce que le feed écarte", () => {
    const upcoming = items.filter((item) => belongsToFeed("upcoming", item));
    expect(upcoming.map((item) => item.id).sort()).toEqual(["d", "e", "f"]);
  });

  it("range l'attente la plus longue en premier", () => {
    const waiting = [...items].sort(compareWaiting);
    expect(waiting[0].id).toBe("d");
    expect(waiting[0].idleDays).toBe(16);
  });

  it("range les échéances à venir de la plus proche à la plus lointaine", () => {
    const upcoming = items
      .filter((item) => matchesCockpitFilter("upcoming", item))
      .sort(compareUpcoming)
      .map((item) => item.id);
    expect(upcoming).toEqual(["e", "d", "f"]);
  });

  it("garde un ordre stable quand tout est à égalité", () => {
    const tied = ["z", "a", "m"].map((id) =>
      toCockpitItem(record({ id, dueAt: startOfDay("2026-06-10", PARIS) }), NOW, PARIS),
    );
    expect([...tied].sort(compareFeed).map((item) => item.id)).toEqual(["a", "m", "z"]);
  });
});

describe("filtres et compteurs", () => {
  const late = signals({ overdueDays: 3, ballOwner: "THEM" });
  const today = signals({ overdueDays: 0, ballOwner: "ME" });
  const upcoming = signals({ overdueDays: -2, ballOwner: "ME" });
  const later = signals({ overdueDays: -30, ballOwner: "THEM" });
  const closed = signals({ status: "COMPLETED", overdueDays: 3 });

  it("découpe le temps sans recouvrement", () => {
    expect(matchesCockpitFilter("late", late)).toBe(true);
    expect(matchesCockpitFilter("today", late)).toBe(false);
    expect(matchesCockpitFilter("today", today)).toBe(true);
    expect(matchesCockpitFilter("upcoming", upcoming)).toBe(true);
    expect(matchesCockpitFilter("upcoming", later)).toBe(false);
  });

  it("compte « chez eux » transversalement", () => {
    // Un retard dont la balle est chez eux compte dans les deux indicateurs :
    // ce sont deux questions différentes, pas deux fois la même.
    expect(matchesCockpitFilter("waiting", late)).toBe(true);
    expect(matchesCockpitFilter("late", late)).toBe(true);
    expect(matchesCockpitFilter("waiting", later)).toBe(true);
    expect(matchesCockpitFilter("waiting", today)).toBe(false);
  });

  it("exclut systématiquement les suivis clos", () => {
    for (const filter of ["all", "late", "today", "upcoming", "waiting"] as const) {
      expect(matchesCockpitFilter(filter, closed)).toBe(false);
    }
  });

  it("montre sous un filtre explicite ce que le feed par défaut cache", () => {
    const item = { ...later, reason: feedReason(later) };
    expect(belongsToFeed("all", item)).toBe(false);
    expect(belongsToFeed("waiting", item)).toBe(true);
  });

  it("retombe sur « tout » devant un paramètre inconnu ou absent", () => {
    expect(parseCockpitFilter(undefined)).toBe("all");
    expect(parseCockpitFilter("late")).toBe("late");
    expect(parseCockpitFilter("../../etc/passwd")).toBe("all");
    expect(parseCockpitFilter(["waiting", "late"])).toBe("waiting");
  });

  it("laisse un espace vide à zéro partout", () => {
    const empty: never[] = [];
    for (const filter of ["late", "today", "upcoming", "waiting"] as const) {
      expect(empty.filter((item) => matchesCockpitFilter(filter, item))).toHaveLength(0);
    }
  });
});

describe("frontières de journée", () => {
  const due = startOfDay("2026-06-10", PARIS);

  it("reste « aujourd'hui » jusqu'à minuit heure de Paris", () => {
    // 23 h 30 à Paris — mais déjà 21 h 30 en UTC le même jour.
    const lateEvening = new Date("2026-06-10T23:30:00+02:00");
    expect(toCockpitItem(record({ dueAt: due }), lateEvening, PARIS).reason).toBe("today");
  });

  it("bascule en retard dès minuit passé, alors qu'UTC est encore la veille", () => {
    // 00 h 30 le 11 à Paris = 22 h 30 le 10 en UTC. Une comparaison naïve en
    // UTC dirait encore « aujourd'hui » ; le cockpit dit « J+1 ».
    const justAfterMidnight = new Date("2026-06-11T00:30:00+02:00");
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-06-10");

    const item = toCockpitItem(record({ dueAt: due }), justAfterMidnight, PARIS);
    expect(item.reason).toBe("late");
    expect(item.overdueDays).toBe(1);
    expect(item.dueLabel).toBe("J+1");
  });

  it("compte la stagnation en jours de Paris, pas en tranches de 24 h", () => {
    const updatedAt = new Date("2026-06-09T23:00:00+02:00");
    const item = toCockpitItem(
      record({ updatedAt }),
      new Date("2026-06-10T01:00:00+02:00"),
      PARIS,
    );
    // Deux heures se sont écoulées, mais on a changé de jour : 1 jour.
    expect(item.idleDays).toBe(1);
  });

  it("date l'en-tête dans le fuseau de l'application", () => {
    expect(todayLabel(new Date("2026-06-10T23:30:00+02:00"), PARIS)).toBe("mercredi 10 juin");
    // Le même instant, lu en UTC, est encore le 10 à 21 h 30 : c'est plus loin
    // dans la nuit que la bascule se voit.
    expect(todayLabel(new Date("2026-06-11T00:30:00+02:00"), PARIS)).toBe("jeudi 11 juin");
    expect(todayLabel(new Date("2026-06-11T00:30:00+02:00"), "UTC")).toBe("mercredi 10 juin");
  });
});

describe("toCockpitItem", () => {
  it("rend le contact cliquable vers sa fiche", () => {
    const item = toCockpitItem(
      record({
        contact: {
          id: "c-1",
          firstName: "Arnaud",
          lastName: "Dupont",
          email: null,
          organizationName: "Carrefour",
          archivedAt: null,
        },
      }),
      NOW,
      PARIS,
    );

    expect(item.contact.name).toBe("Arnaud Dupont");
    expect(item.contact.initials).toBe("AD");
    expect(item.contact.href).toBe("/contacts/c-1");
    expect(item.contact.organizationName).toBe("Carrefour");
    // L'entreprise n'est pas encore une entité : la place est prête, vide.
    expect(item.contact.organizationHref).toBeNull();
    expect(item.contact.archived).toBe(false);
  });

  it("signale un contact archivé plutôt que de le faire disparaître", () => {
    const item = toCockpitItem(
      record({
        contact: {
          id: "c-2",
          firstName: "Marie",
          lastName: "Blanc",
          email: null,
          organizationName: null,
          archivedAt: new Date("2026-05-01T00:00:00Z"),
        },
      }),
      NOW,
      PARIS,
    );

    expect(item.contact.archived).toBe(true);
    expect(item.contact.href).toBe("/contacts/c-2");
  });

  it("supporte un suivi sans contact", () => {
    const item = toCockpitItem(record(), NOW, PARIS);

    expect(item.contact.id).toBeNull();
    expect(item.contact.href).toBeNull();
    expect(item.contact.name).toBe("Sans contact");
  });

  it("n'alerte sur la stagnation que si la balle est chez eux", () => {
    const stale = { updatedAt: startOfDay("2026-05-01", PARIS) };

    expect(toCockpitItem(record({ ...stale }), NOW, PARIS).stagnationLabel).toBe(
      "Sans mouvement depuis 40 j",
    );
    expect(
      toCockpitItem(record({ ...stale, ballOwner: "ME" }), NOW, PARIS).stagnationLabel,
    ).toBeNull();
  });
});

describe("greetingName", () => {
  it("préfère le prénom du nom affiché", () => {
    expect(greetingName("Arnaud Dupont", "arnaud@nod-lab.fr")).toBe("Arnaud");
    expect(greetingName("  Marie  ", "m@nod-lab.fr")).toBe("Marie");
  });

  it("retombe sur l'e-mail quand aucun nom n'est renseigné", () => {
    expect(greetingName(null, "arnaud@nod-lab.fr")).toBe("arnaud");
    expect(greetingName("   ", "arnaud@nod-lab.fr")).toBe("arnaud");
  });
});
