import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
  },
}));

vi.mock("./request-context", () => ({
  resolveRequestId: vi.fn(async () => "11111111-1111-1111-1111-111111111111"),
}));

import { logAudit, recordAudit } from "./log";
import { AUDIT_ENTITY_TYPES } from "./types";

const BASE_EVENT = {
  workspaceId: "ws-1",
  userId: "user-1",
  action: "CREATE" as const,
  entityType: AUDIT_ENTITY_TYPES.CONTACT,
  entityId: "contact-1",
};

describe("logAudit", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("écrit exactement les champs minimaux — rien de plus", async () => {
    auditLogCreate.mockResolvedValue({});

    await logAudit({ ...BASE_EVENT, requestId: "req-1" });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-1",
        userId: "user-1",
        action: "CREATE",
        entityType: AUDIT_ENTITY_TYPES.CONTACT,
        entityId: "contact-1",
        requestId: "req-1",
      },
    });
  });

  it("normalise entityId et requestId absents en null plutôt qu'en undefined", async () => {
    auditLogCreate.mockResolvedValue({});

    await logAudit({
      workspaceId: "ws-1",
      userId: null,
      action: "EXPORT",
      entityType: AUDIT_ENTITY_TYPES.CONTACT,
    });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-1",
        userId: null,
        action: "EXPORT",
        entityType: AUDIT_ENTITY_TYPES.CONTACT,
        entityId: null,
        requestId: null,
      },
    });
  });

  it("n'importe jamais aucune valeur métier : seuls les champs de AuditEvent partent en base", async () => {
    auditLogCreate.mockResolvedValue({});

    await logAudit({ ...BASE_EVENT, requestId: "req-1" });

    const [{ data }] = auditLogCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(Object.keys(data).sort()).toEqual(
      ["action", "entityId", "entityType", "requestId", "userId", "workspaceId"].sort(),
    );
  });

  it("avale l'erreur si l'écriture échoue — la mutation appelante ne doit jamais le voir", async () => {
    auditLogCreate.mockRejectedValue(new Error("connection refusée : postgresql://user:secret@host/db"));

    await expect(logAudit({ ...BASE_EVENT, requestId: "req-1" })).resolves.toBeUndefined();
  });

  it("ne journalise jamais le message d'erreur brut (risque de fuite de secret)", async () => {
    auditLogCreate.mockRejectedValue(new Error("connection refusée : postgresql://user:secret@host/db"));
    const errorSpy = vi.spyOn(console, "error");

    await logAudit({ ...BASE_EVENT, requestId: "req-1" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedText = errorSpy.mock.calls[0].map((part) => JSON.stringify(part)).join(" ");
    expect(loggedText).not.toContain("secret");
    expect(loggedText).not.toContain("postgresql://");
  });
});

describe("recordAudit", () => {
  beforeEach(() => {
    auditLogCreate.mockReset();
    auditLogCreate.mockResolvedValue({});
  });

  it("résout le requestId puis délègue à logAudit", async () => {
    await recordAudit(BASE_EVENT);

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-1",
        userId: "user-1",
        action: "CREATE",
        entityType: AUDIT_ENTITY_TYPES.CONTACT,
        entityId: "contact-1",
        requestId: "11111111-1111-1111-1111-111111111111",
      },
    });
  });
});
