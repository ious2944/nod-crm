import { describe, expect, it } from "vitest";

import { updateFollowUpSchema } from "./schemas";
import { parseSearchQuery, buildFollowUpHref } from "./filters";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";
const CONTACT_UUID = "00000000-0000-4000-8000-000000000002";

// ────────────────────────────────────────────────────────────────────────────
// updateFollowUpSchema
// ────────────────────────────────────────────────────────────────────────────

describe("updateFollowUpSchema", () => {
  const VALID_BASE = {
    id: VALID_UUID,
    title: "Contrat Acme",
    dueDate: "2026-09-01",
  };

  it("accepte un suivi complet avec contact", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      description: "À envoyer avant la réunion.",
      contactId: CONTACT_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Contrat Acme");
      expect(result.data.contactId).toBe(CONTACT_UUID);
      expect(result.data.description).toBe("À envoyer avant la réunion.");
    }
  });

  it("accepte un suivi sans contact (contactId vide → '')", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      contactId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactId).toBe("");
    }
  });

  it("accepte un suivi sans contactId fourni (valeur par défaut '')", () => {
    const result = updateFollowUpSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactId).toBe("");
    }
  });

  it("rejette un UUID de suivi invalide", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      id: "pas-un-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un sujet vide", () => {
    const result = updateFollowUpSchema.safeParse({ ...VALID_BASE, title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Le sujet est obligatoire.");
    }
  });

  it("rejette un sujet trop long (> 160 caractères)", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      title: "a".repeat(161),
    });
    expect(result.success).toBe(false);
  });

  it("rejette une échéance invalide", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      dueDate: "pas-une-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un contactId qui n'est pas un UUID valide", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      contactId: "pas-un-uuid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Contact invalide.");
    }
  });

  it("n'accepte pas 'new' comme valeur de contactId (contrairement à createFollowUpSchema)", () => {
    // L'édition ne crée pas de contact à la volée : seul un UUID existant est valide.
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      contactId: "new",
    });
    expect(result.success).toBe(false);
  });

  it("transforme description vide en null", () => {
    const result = updateFollowUpSchema.safeParse({ ...VALID_BASE, description: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("trim les espaces autour du titre", () => {
    const result = updateFollowUpSchema.safeParse({
      ...VALID_BASE,
      title: "  Contrat Acme  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Contrat Acme");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// parseSearchQuery
// ────────────────────────────────────────────────────────────────────────────

describe("parseSearchQuery", () => {
  it("retourne '' pour undefined", () => {
    expect(parseSearchQuery(undefined)).toBe("");
  });

  it("retourne '' pour une chaîne vide", () => {
    expect(parseSearchQuery("")).toBe("");
  });

  it("retourne la valeur trimmée", () => {
    expect(parseSearchQuery("  acme  ")).toBe("acme");
  });

  it("plafonne à 120 caractères", () => {
    const long = "a".repeat(200);
    expect(parseSearchQuery(long)).toHaveLength(120);
  });

  it("accepte le premier élément d'un tableau", () => {
    expect(parseSearchQuery(["acme", "globex"])).toBe("acme");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildFollowUpHref
// ────────────────────────────────────────────────────────────────────────────

describe("buildFollowUpHref", () => {
  it("retourne '/follow-ups' pour all + query vide", () => {
    expect(buildFollowUpHref({ filter: "all", query: "" })).toBe("/follow-ups");
  });

  it("inclut ?f= quand le filtre n'est pas 'all'", () => {
    const href = buildFollowUpHref({ filter: "me", query: "" });
    expect(href).toBe("/follow-ups?f=me");
  });

  it("inclut ?q= quand une recherche est active", () => {
    const href = buildFollowUpHref({ filter: "all", query: "acme" });
    expect(href).toBe("/follow-ups?q=acme");
  });

  it("combine ?f= et ?q=", () => {
    const href = buildFollowUpHref({ filter: "me", query: "acme" });
    expect(href).toContain("f=me");
    expect(href).toContain("q=acme");
  });

  it("encode les caractères spéciaux dans la recherche", () => {
    const href = buildFollowUpHref({ filter: "all", query: "test & co" });
    expect(href).toContain("q=test%20%26%20co");
  });

  it("permet de changer le filtre tout en gardant la recherche (override)", () => {
    const href = buildFollowUpHref(
      { filter: "all", query: "acme" },
      { filter: "nudge" },
    );
    expect(href).toContain("f=nudge");
    expect(href).toContain("q=acme");
  });

  it("permet de changer la recherche tout en gardant le filtre (override)", () => {
    const href = buildFollowUpHref(
      { filter: "me", query: "acme" },
      { query: "globex" },
    );
    expect(href).toContain("f=me");
    expect(href).toContain("q=globex");
  });
});
