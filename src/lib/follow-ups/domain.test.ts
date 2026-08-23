import { describe, expect, it } from "vitest";

import { startOfDay } from "@/lib/date";
import {
  attentionHeadline,
  computeTiming,
  dueLabel,
  urgencyLevel,
  type FollowUpStatus,
} from "./domain";
import { matchesOpenFilter } from "./filters";
import { ballLabel } from "./view";

const PARIS = "Europe/Paris";
const NOW = new Date("2026-06-10T09:00:00+02:00");

function timingFor(dueDate: string, status: FollowUpStatus = "OPEN") {
  return computeTiming(
    {
      status,
      dueAt: startOfDay(dueDate, PARIS),
      createdAt: startOfDay("2026-06-01", PARIS),
    },
    NOW,
    PARIS,
  );
}

describe("urgencyLevel", () => {
  it("monte progressivement avec le retard", () => {
    expect(urgencyLevel(-5)).toBe("calm");
    expect(urgencyLevel(-1)).toBe("soon");
    expect(urgencyLevel(0)).toBe("today");
    expect(urgencyLevel(3)).toBe("late");
    expect(urgencyLevel(7)).toBe("critical");
    expect(urgencyLevel(30)).toBe("critical");
  });
});

describe("dueLabel", () => {
  it("reste lisible d'un coup d'œil", () => {
    expect(dueLabel(6)).toBe("J+6");
    expect(dueLabel(0)).toBe("Aujourd'hui");
    expect(dueLabel(-1)).toBe("Demain");
    expect(dueLabel(-4)).toBe("Dans 4 j");
  });
});

describe("computeTiming", () => {
  it("marque comme « à traiter » ce qui est dû aujourd'hui ou en retard", () => {
    expect(timingFor("2026-06-04").needsAttention).toBe(true);
    expect(timingFor("2026-06-10").needsAttention).toBe(true);
    expect(timingFor("2026-06-11").needsAttention).toBe(false);
  });

  it("calcule le retard et l'ancienneté en jours", () => {
    const timing = timingFor("2026-06-04");
    expect(timing.overdueDays).toBe(6);
    expect(timing.ageDays).toBe(9);
    expect(timing.dueLabel).toBe("J+6");
    expect(timing.level).toBe("late");
  });

  it("neutralise l'urgence d'un suivi terminé, même en retard", () => {
    const timing = timingFor("2026-05-01", "COMPLETED");
    expect(timing.level).toBe("done");
    expect(timing.dueLabel).toBe("Terminé");
    expect(timing.needsAttention).toBe(false);
  });
});

describe("matchesOpenFilter", () => {
  const overdueThem = { ballOwner: "THEM" as const, timing: { needsAttention: true } };
  const futureThem = { ballOwner: "THEM" as const, timing: { needsAttention: false } };
  const overdueMe = { ballOwner: "ME" as const, timing: { needsAttention: true } };

  it("« à relancer » ne retient que ce qui traîne chez les autres", () => {
    expect(matchesOpenFilter("nudge", overdueThem)).toBe(true);
    expect(matchesOpenFilter("nudge", futureThem)).toBe(false);
    expect(matchesOpenFilter("nudge", overdueMe)).toBe(false);
  });

  it("sépare les deux camps de la balle", () => {
    expect(matchesOpenFilter("me", overdueMe)).toBe(true);
    expect(matchesOpenFilter("me", overdueThem)).toBe(false);
    expect(matchesOpenFilter("them", futureThem)).toBe(true);
  });

  it("« tous » garde tout, « terminés » est servi à part", () => {
    expect(matchesOpenFilter("all", futureThem)).toBe(true);
    expect(matchesOpenFilter("done", futureThem)).toBe(false);
  });
});

describe("ballLabel", () => {
  it("nomme la personne quand on la connaît", () => {
    expect(ballLabel("THEM", "Patrick")).toBe("Chez Patrick");
    expect(ballLabel("THEM", null)).toBe("Chez eux");
    expect(ballLabel("ME", "Patrick")).toBe("Chez moi");
  });
});

describe("attentionHeadline", () => {
  it("récompense le zéro", () => {
    expect(attentionHeadline(0)).toBe("Tout est sous contrôle.");
    expect(attentionHeadline(1)).toBe("1 sujet nécessite ton attention.");
    expect(attentionHeadline(5)).toBe("5 sujets nécessitent ton attention.");
  });
});
