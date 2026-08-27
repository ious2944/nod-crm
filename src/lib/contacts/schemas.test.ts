import { describe, expect, it } from "vitest";

import { createContactSchema, updateContactSchema, IDENTITY_MESSAGE } from "./schemas";

/**
 * Tests de la validation de schéma du module Contacts.
 *
 * Focus sur `requireIdentity` : la règle métier qui exige qu'un contact soit
 * identifiable. Depuis V0.5, `organizationId` (posté par `OrganizationPicker`)
 * satisfait cette règle au même titre que prénom, nom, email ou organizationName.
 */

describe("createContactSchema — requireIdentity", () => {
  it("accepte un contact avec un prénom uniquement", () => {
    const result = createContactSchema.safeParse({ firstName: "Alice" });
    expect(result.success).toBe(true);
  });

  it("accepte un contact avec un nom uniquement", () => {
    const result = createContactSchema.safeParse({ lastName: "Dupont" });
    expect(result.success).toBe(true);
  });

  it("accepte un contact avec un email uniquement", () => {
    const result = createContactSchema.safeParse({ email: "alice@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepte un contact avec organizationName uniquement (champ texte legacy)", () => {
    const result = createContactSchema.safeParse({ organizationName: "Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("accepte un contact avec organizationId uniquement (sélecteur V0.5)", () => {
    // C'est le cas clé : OrganizationPicker poste organizationId mais pas
    // organizationName. Sans ce test, un contact identifié uniquement par org
    // picker serait rejeté par requireIdentity.
    const result = createContactSchema.safeParse({
      organizationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un contact sans aucun champ identificateur", () => {
    const result = createContactSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(IDENTITY_MESSAGE);
    }
  });

  it("rejette un contact dont organizationId est un UUID invalide (traité comme null)", () => {
    // Un UUID malformé est silencieusement transformé en null par le schéma :
    // si aucun autre champ identifiant n'est fourni, requireIdentity doit rejeter.
    const result = createContactSchema.safeParse({
      organizationId: "pas-un-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepte téléphone + notes sans champ identifiant (non — règle identity)", () => {
    // Téléphone et notes ne satisfont pas requireIdentity.
    const result = createContactSchema.safeParse({
      phone: "+33 6 12 34 56 78",
      notes: "Rencontré à la conférence",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateContactSchema — requireIdentity", () => {
  const VALID_UUID = "00000000-0000-4000-8000-000000000001";

  it("accepte la mise à jour avec organizationId uniquement", () => {
    const result = updateContactSchema.safeParse({
      id: VALID_UUID,
      organizationId: "00000000-0000-4000-8000-000000000002",
    });
    expect(result.success).toBe(true);
  });

  it("rejette la mise à jour sans aucun champ identifiant", () => {
    const result = updateContactSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(false);
  });
});
