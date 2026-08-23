import { describe, expect, it } from "vitest";

import { addDaysToKey, dayKey, daysBetween, shiftDueDate, startOfDay } from "./date";

const PARIS = "Europe/Paris";

describe("dayKey", () => {
  it("utilise le fuseau de l'application, pas celui du serveur", () => {
    // 22h00 UTC = déjà le lendemain à Paris (UTC+2 en été).
    expect(dayKey(new Date("2026-06-10T22:00:00Z"), PARIS)).toBe("2026-06-11");
    expect(dayKey(new Date("2026-06-10T22:00:00Z"), "UTC")).toBe("2026-06-10");
  });
});

describe("daysBetween", () => {
  it("compte des jours calendaires, pas des tranches de 24 h", () => {
    const due = new Date("2026-06-10T00:00:00+02:00");
    const now = new Date("2026-06-13T08:30:00+02:00");
    expect(daysBetween(due, now, PARIS)).toBe(3);
  });

  it("renvoie 0 le jour de l'échéance", () => {
    const due = new Date("2026-06-10T00:00:00+02:00");
    const now = new Date("2026-06-10T23:59:00+02:00");
    expect(daysBetween(due, now, PARIS)).toBe(0);
  });

  it("renvoie une valeur négative avant l'échéance", () => {
    const due = new Date("2026-06-15T00:00:00+02:00");
    const now = new Date("2026-06-10T12:00:00+02:00");
    expect(daysBetween(due, now, PARIS)).toBe(-5);
  });
});

describe("startOfDay", () => {
  it("cale l'échéance sur minuit local", () => {
    expect(startOfDay("2026-06-10", PARIS).toISOString()).toBe("2026-06-09T22:00:00.000Z");
    expect(startOfDay("2026-01-10", PARIS).toISOString()).toBe("2026-01-09T23:00:00.000Z");
  });

  it("fait l'aller-retour avec dayKey", () => {
    for (const key of ["2026-01-01", "2026-03-29", "2026-10-25", "2026-12-31"]) {
      expect(dayKey(startOfDay(key, PARIS), PARIS)).toBe(key);
    }
  });

  it("refuse une date invalide", () => {
    expect(() => startOfDay("pas-une-date", PARIS)).toThrow();
  });
});

describe("addDaysToKey", () => {
  it("traverse les fins de mois", () => {
    expect(addDaysToKey("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("shiftDueDate", () => {
  it("reste calé sur minuit local malgré le passage à l'heure d'hiver", () => {
    // 25 octobre 2026 : la France repasse en UTC+1.
    const before = startOfDay("2026-10-24", PARIS);
    const after = shiftDueDate(before, 3, PARIS);
    expect(dayKey(after, PARIS)).toBe("2026-10-27");
    expect(after.toISOString()).toBe("2026-10-26T23:00:00.000Z");
  });
});
