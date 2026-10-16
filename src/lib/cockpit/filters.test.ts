import { describe, expect, it } from "vitest";

import { parseTaskScope, todayHref } from "./filters";

describe("portée des tâches du cockpit", () => {
  it("par défaut : toutes les tâches accessibles (comportement historique)", () => {
    expect(parseTaskScope(undefined)).toBe("all");
    expect(parseTaskScope("nimporte")).toBe("all");
    expect(parseTaskScope("mine")).toBe("mine");
    expect(parseTaskScope(["mine", "all"])).toBe("mine");
  });

  it("les liens conservent filtre d'attention et portée", () => {
    expect(todayHref("all", "all")).toBe("/today");
    expect(todayHref("late", "all")).toBe("/today?f=late");
    expect(todayHref("all", "mine")).toBe("/today?t=mine");
    expect(todayHref("today", "mine")).toBe("/today?f=today&t=mine");
  });
});
