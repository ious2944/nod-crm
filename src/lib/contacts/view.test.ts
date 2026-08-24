import { describe, expect, it } from "vitest";

import {
  contactDisplayName,
  contactInitials,
  contactPhotoUrl,
  contactSubtitle,
  followUpLabel,
} from "./view";

const BASE = {
  firstName: "",
  lastName: "",
  email: null,
  organizationName: null,
};

describe("contactDisplayName", () => {
  it("préfère le nom complet", () => {
    expect(contactDisplayName({ ...BASE, firstName: "Julien", lastName: "Doussot" })).toBe(
      "Julien Doussot",
    );
  });

  it("se contente d'un seul des deux", () => {
    expect(contactDisplayName({ ...BASE, firstName: "Julien" })).toBe("Julien");
    expect(contactDisplayName({ ...BASE, lastName: "Doussot" })).toBe("Doussot");
  });

  it("retombe sur l'email puis sur l'organisation", () => {
    expect(contactDisplayName({ ...BASE, email: "j@example.com" })).toBe("j@example.com");
    expect(contactDisplayName({ ...BASE, organizationName: "EASYLAB" })).toBe("EASYLAB");
  });

  it("n'affiche jamais une ligne vide", () => {
    expect(contactDisplayName(BASE)).toBe("Contact sans nom");
  });
});

describe("contactInitials", () => {
  it("prend la première lettre de chaque nom", () => {
    expect(contactInitials({ ...BASE, firstName: "julien", lastName: "doussot" })).toBe("JD");
  });

  it("se rabat sur ce qui est affiché quand il n'y a pas de nom", () => {
    expect(contactInitials({ ...BASE, email: "julien@example.com" })).toBe("J");
    expect(contactInitials(BASE)).toBe("C");
  });
});

describe("contactPhotoUrl", () => {
  it("ne produit rien sans photo", () => {
    expect(contactPhotoUrl("abc", null)).toBeNull();
  });

  it("porte un jeton de version, pour ne pas servir l'ancienne image", () => {
    const url = contactPhotoUrl("abc", "contacts/11111111-2222-4333-8444-555555555555.png");
    expect(url).toBe("/api/contacts/abc/photo?v=11111111-2222-4333-8444-555555555555");
  });
});

describe("followUpLabel", () => {
  it("compte les suivis actifs", () => {
    expect(followUpLabel(1, 0)).toBe("1 suivi actif");
    expect(followUpLabel(2, 0)).toBe("2 suivis actifs");
  });

  it("distingue « jamais eu de suivi » de « tout est clos »", () => {
    expect(followUpLabel(0, 0)).toBe("Aucun suivi");
    expect(followUpLabel(0, 3)).toBe("Aucun suivi actif");
  });
});

describe("contactSubtitle", () => {
  it("assemble organisation et fonction", () => {
    expect(contactSubtitle("EASYLAB", "Responsable commercial")).toBe(
      "EASYLAB · Responsable commercial",
    );
    expect(contactSubtitle("EASYLAB", null)).toBe("EASYLAB");
    expect(contactSubtitle(null, "Direction")).toBe("Direction");
    expect(contactSubtitle(null, null)).toBeNull();
  });
});
