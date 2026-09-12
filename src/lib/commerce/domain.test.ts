import { describe, expect, it } from "vitest";

import {
  isTransitionAllowed,
  isOpenStatus,
  isClosedStatus,
  statusVariant,
} from "./domain";

/**
 * Tests unitaires du cœur métier Commerce.
 *
 * Ces tests vérifient la machine à états et les fonctions pures sans base de données.
 */

describe("isTransitionAllowed — machine à états", () => {
  // ── Transitions de fermeture nominales ───────────────────────────────────
  it("PROPOSITION -> PERDUE : autorisé", () => {
    expect(isTransitionAllowed("PROPOSITION", "PERDUE")).toBe(true);
  });

  it("PROPOSITION -> GAGNEE : autorisé", () => {
    expect(isTransitionAllowed("PROPOSITION", "GAGNEE")).toBe(true);
  });

  it("A_QUALIFIER -> PERDUE : autorisé", () => {
    expect(isTransitionAllowed("A_QUALIFIER", "PERDUE")).toBe(true);
  });

  it("EN_DISCUSSION -> PERDUE : autorisé", () => {
    expect(isTransitionAllowed("EN_DISCUSSION", "PERDUE")).toBe(true);
  });

  // ── Réouvertures (statuts terminaux → ouverts) ───────────────────────────
  it("PERDUE -> A_QUALIFIER : autorisé (réouverture)", () => {
    expect(isTransitionAllowed("PERDUE", "A_QUALIFIER")).toBe(true);
  });

  it("GAGNEE -> EN_DISCUSSION : autorisé (réouverture)", () => {
    expect(isTransitionAllowed("GAGNEE", "EN_DISCUSSION")).toBe(true);
  });

  // ── Transitions identiques (no-op attendu en couche action) ──────────────
  // Ces transitions ne sont PAS dans ALLOWED_TRANSITIONS ; le garde idempotent
  // de la Server Action les court-circuite avant que isTransitionAllowed soit appelé.
  // On documente ici que la fonction elle-même les refuse (comportement stable).
  it("PERDUE -> PERDUE : refusé par isTransitionAllowed (guard idempotent au-dessus)", () => {
    expect(isTransitionAllowed("PERDUE", "PERDUE")).toBe(false);
  });

  it("GAGNEE -> GAGNEE : refusé par isTransitionAllowed (guard idempotent au-dessus)", () => {
    expect(isTransitionAllowed("GAGNEE", "GAGNEE")).toBe(false);
  });

  // ── Transitions croisées entre statuts terminaux : toujours refusées ─────
  it("PERDUE -> GAGNEE : refusé", () => {
    expect(isTransitionAllowed("PERDUE", "GAGNEE")).toBe(false);
  });

  it("GAGNEE -> PERDUE : refusé", () => {
    expect(isTransitionAllowed("GAGNEE", "PERDUE")).toBe(false);
  });
});

describe("isOpenStatus / isClosedStatus", () => {
  it("A_QUALIFIER est un statut ouvert", () => {
    expect(isOpenStatus("A_QUALIFIER")).toBe(true);
    expect(isClosedStatus("A_QUALIFIER")).toBe(false);
  });

  it("GAGNEE est un statut fermé", () => {
    expect(isClosedStatus("GAGNEE")).toBe(true);
    expect(isOpenStatus("GAGNEE")).toBe(false);
  });

  it("PERDUE est un statut fermé", () => {
    expect(isClosedStatus("PERDUE")).toBe(true);
    expect(isOpenStatus("PERDUE")).toBe(false);
  });
});

describe("statusVariant", () => {
  it("GAGNEE → won", () => expect(statusVariant("GAGNEE")).toBe("won"));
  it("PERDUE → lost", () => expect(statusVariant("PERDUE")).toBe("lost"));
  it("A_QUALIFIER → neutral", () => expect(statusVariant("A_QUALIFIER")).toBe("neutral"));
  it("EN_DISCUSSION → active", () => expect(statusVariant("EN_DISCUSSION")).toBe("active"));
  it("PROPOSITION → active", () => expect(statusVariant("PROPOSITION")).toBe("active"));
});
