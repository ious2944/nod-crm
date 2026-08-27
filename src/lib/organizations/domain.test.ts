import { describe, expect, it } from "vitest";

import {
  isOrganizationSelectable,
  normalizeOrgName,
  sortOrganizationsByName,
  toOrganizationPickerLabel,
} from "./domain";

describe("normalizeOrgName", () => {
  it("convertit en minuscules", () => {
    expect(normalizeOrgName("ACME Corp")).toBe("acme corp");
  });

  it("compacte les espaces multiples", () => {
    expect(normalizeOrgName("ACME  Corp")).toBe("acme corp");
  });

  it("retire les espaces de bord", () => {
    expect(normalizeOrgName("  ACME  ")).toBe("acme");
  });

  it("retourne une chaîne vide pour une chaîne vide", () => {
    expect(normalizeOrgName("")).toBe("");
  });
});

describe("sortOrganizationsByName", () => {
  it("trie par ordre alphabétique insensible à la casse", () => {
    const input = [
      { name: "Zebra Inc." },
      { name: "acme Corp" },
      { name: "BETA Ltd." },
    ];
    const sorted = sortOrganizationsByName(input);
    expect(sorted.map((o) => o.name)).toEqual(["acme Corp", "BETA Ltd.", "Zebra Inc."]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const input = [{ name: "B" }, { name: "A" }];
    sortOrganizationsByName(input);
    expect(input[0].name).toBe("B");
  });

  it("gère un tableau vide", () => {
    expect(sortOrganizationsByName([])).toEqual([]);
  });
});

describe("isOrganizationSelectable", () => {
  it("retourne true si non archivée", () => {
    expect(isOrganizationSelectable({ archivedAt: null })).toBe(true);
  });

  it("retourne false si archivée", () => {
    expect(isOrganizationSelectable({ archivedAt: new Date() })).toBe(false);
  });
});

describe("toOrganizationPickerLabel", () => {
  it("retourne le nom seul sans site web", () => {
    expect(toOrganizationPickerLabel({ name: "ACME Corp", website: null })).toBe("ACME Corp");
  });

  it("ajoute le domaine entre parenthèses si site web présent", () => {
    expect(
      toOrganizationPickerLabel({ name: "ACME Corp", website: "https://www.acme.com" }),
    ).toBe("ACME Corp (acme.com)");
  });

  it("gère un URL sans protocole", () => {
    expect(
      toOrganizationPickerLabel({ name: "BETA Ltd.", website: "beta.io" }),
    ).toBe("BETA Ltd. (beta.io)");
  });

  it("retourne le nom seul si l'URL est invalide", () => {
    expect(
      toOrganizationPickerLabel({ name: "Weird Corp", website: "not a url ¡" }),
    ).toBe("Weird Corp");
  });
});
