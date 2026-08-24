import { describe, expect, it } from "vitest";

import {
  buildContactListHref,
  escapeLikePattern,
  MAX_SEARCH_TOKENS,
  parseContactFollowUpFilter,
  parseContactListParams,
  parseContactSort,
  parsePage,
  searchTokens,
} from "./filters";

describe("parseContactSort", () => {
  it("accepte les tris connus et refuse le reste", () => {
    expect(parseContactSort("name-desc")).toBe("name-desc");
    expect(parseContactSort("updated")).toBe("updated");
    expect(parseContactSort("created_at DESC; DROP TABLE contacts")).toBe("name-asc");
    expect(parseContactSort(undefined)).toBe("name-asc");
  });
});

describe("parseContactFollowUpFilter", () => {
  it("retombe sur « tous » pour une valeur inconnue", () => {
    expect(parseContactFollowUpFilter("active")).toBe("active");
    expect(parseContactFollowUpFilter("peut-être")).toBe("any");
  });
});

describe("parsePage", () => {
  it("refuse toute page qui ne peut pas exister", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it("plafonne les valeurs absurdes plutôt que de les passer à OFFSET", () => {
    expect(parsePage("99999999")).toBe(10_000);
  });
});

describe("escapeLikePattern", () => {
  it("neutralise les jokers de LIKE", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
    expect(escapeLikePattern("john_doe")).toBe("john\\_doe");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("laisse le reste intact", () => {
    expect(escapeLikePattern("Doussot")).toBe("Doussot");
    expect(escapeLikePattern("julien@example.com")).toBe("julien@example.com");
  });
});

describe("searchTokens", () => {
  it("découpe en mots, pour retrouver « prénom + nom »", () => {
    expect(searchTokens("Julien Doussot")).toEqual(["Julien", "Doussot"]);
    expect(searchTokens("  julien   easylab ")).toEqual(["julien", "easylab"]);
  });

  it("ignore une saisie vide", () => {
    expect(searchTokens("   ")).toEqual([]);
  });

  it("borne le nombre de mots : chacun coûte une clause SQL", () => {
    expect(searchTokens("a b c d e f g h")).toHaveLength(MAX_SEARCH_TOKENS);
  });
});

describe("parseContactListParams", () => {
  it("lit une URL complète", () => {
    expect(
      parseContactListParams({
        q: " Doussot ",
        org: "EASYLAB",
        fu: "active",
        sort: "recent",
        page: "2",
      }),
    ).toEqual({
      search: "Doussot",
      organization: "EASYLAB",
      followUp: "active",
      sort: "recent",
      page: 2,
    });
  });

  it("ne fait confiance à rien", () => {
    expect(
      parseContactListParams({ fu: "../../etc/passwd", sort: "1=1", page: "-1" }),
    ).toEqual({
      search: "",
      organization: "",
      followUp: "any",
      sort: "name-asc",
      page: 1,
    });
  });
});

describe("buildContactListHref", () => {
  it("n'écrit dans l'URL que ce qui s'écarte du défaut", () => {
    expect(buildContactListHref({})).toBe("/contacts");
    expect(buildContactListHref({ search: "julien" })).toBe("/contacts?q=julien");
    expect(buildContactListHref({ page: 3, sort: "updated" })).toBe(
      "/contacts?sort=updated&page=3",
    );
  });

  it("échappe ce qui doit l'être", () => {
    expect(buildContactListHref({ organization: "A & B" })).toBe("/contacts?org=A+%26+B");
  });
});
