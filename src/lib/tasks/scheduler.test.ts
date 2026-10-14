import { describe, expect, it } from "vitest";

import { schedulerEnabled, schedulerIntervalMs } from "./scheduler";

describe("réglages de l'ordonnanceur", () => {
  it("activé par défaut, désactivable", () => {
    expect(schedulerEnabled(undefined)).toBe(true);
    expect(schedulerEnabled("on")).toBe(true);
    for (const off of ["off", "false", "0", "no", " OFF "]) expect(schedulerEnabled(off)).toBe(false);
  });

  it("période bornée, 5 minutes par défaut", () => {
    expect(schedulerIntervalMs(undefined)).toBe(5 * 60_000);
    expect(schedulerIntervalMs("1")).toBe(60_000);
    expect(schedulerIntervalMs("0")).toBe(5 * 60_000);
    expect(schedulerIntervalMs("abc")).toBe(5 * 60_000);
    expect(schedulerIntervalMs("600")).toBe(5 * 60_000);
  });
});
