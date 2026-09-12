import { describe, expect, it, vi } from "vitest";

const getHeader = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: getHeader }),
}));

import { resolveRequestId } from "./request-context";

describe("resolveRequestId", () => {
  it("reprend l'en-tête x-request-id quand il a la forme d'un UUID", async () => {
    getHeader.mockReturnValue("550e8400-e29b-41d4-a716-446655440000");

    await expect(resolveRequestId()).resolves.toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("ignore un en-tête présent mais qui n'est pas un UUID, et en génère un", async () => {
    getHeader.mockReturnValue("not-a-uuid");

    const result = await resolveRequestId();
    expect(result).not.toBe("not-a-uuid");
    expect(result).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("génère un identifiant quand l'en-tête est absent", async () => {
    getHeader.mockReturnValue(null);

    const result = await resolveRequestId();
    expect(result).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("ne lève jamais, même si headers() échoue (hors contexte de requête)", async () => {
    vi.mocked(getHeader).mockImplementation(() => {
      throw new Error("no request context");
    });

    // `headers()` elle-même rejette dans ce scénario, pas seulement `.get()` —
    // on simule ça en remplaçant le mock du module pour cet appel.
    vi.doMock("next/headers", () => ({
      headers: async () => {
        throw new Error("no request context");
      },
    }));
    vi.resetModules();
    const { resolveRequestId: resolveWithBrokenHeaders } = await import("./request-context");

    await expect(resolveWithBrokenHeaders()).resolves.toMatch(/^[0-9a-f-]{36}$/i);
  });
});
