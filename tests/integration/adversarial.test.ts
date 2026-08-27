import { beforeEach, describe, expect, it } from "vitest";

import { applyTaskAction } from "@/app/(app)/tasks/actions";
import { applyQuickAction } from "@/app/(app)/follow-ups/actions";
import { login } from "@/app/login/actions";
import { initialLoginState } from "@/lib/auth/schemas";
import { readSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { headerJar, TestRedirect } from "./cookie-jar";
import {
  createFollowUpRecord,
  createTaskRecord,
  createWorkspaceWithUser,
  formData,
  resetDatabase,
  signIn,
  type TestUser,
} from "./fixtures";

/**
 * Tests adversariaux : ils ne vérifient pas que l'application marche, ils
 * cherchent à la casser. Chacun correspond à une attaque ou à un abus concret.
 */

describe("machine à états des suivis", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("etat-ws");
    await signIn(user);
  });

  it("refuse de rouvrir un suivi déjà ouvert (l'échéance ne doit pas être écrasée)", async () => {
    const id = await createFollowUpRecord(user.workspaceId);
    const before = await prisma.followUp.findUniqueOrThrow({ where: { id } });

    await expect(applyQuickAction(formData({ id, intent: "reopen" }))).rejects.toThrow();

    const after = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(after.dueAt).toEqual(before.dueAt);
  });

  it.each(["nudge", "handoff", "received", "snooze"])(
    "refuse l'action « %s » sur un suivi terminé",
    async (intent) => {
      const id = await createFollowUpRecord(user.workspaceId);
      await prisma.followUp.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const before = await prisma.followUp.findUniqueOrThrow({ where: { id } });

      await expect(
        applyQuickAction(formData({ id, intent, days: 3 })),
      ).rejects.toThrow();

      const after = await prisma.followUp.findUniqueOrThrow({ where: { id } });
      expect(after).toEqual(before);
    },
  );

  it("refuse de terminer deux fois (la date de clôture ne doit pas bouger)", async () => {
    const id = await createFollowUpRecord(user.workspaceId);
    await applyQuickAction(formData({ id, intent: "complete" }));
    const first = await prisma.followUp.findUniqueOrThrow({ where: { id } });

    await expect(applyQuickAction(formData({ id, intent: "complete" }))).rejects.toThrow();

    const second = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(second.completedAt).toEqual(first.completedAt);
  });

  it("refuse d'abandonner un suivi déjà terminé", async () => {
    const id = await createFollowUpRecord(user.workspaceId);
    await applyQuickAction(formData({ id, intent: "complete" }));

    await expect(applyQuickAction(formData({ id, intent: "abandon" }))).rejects.toThrow();

    const after = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("COMPLETED");
  });

  it("autorise la séquence métier normale", async () => {
    const id = await createFollowUpRecord(user.workspaceId);

    await applyQuickAction(formData({ id, intent: "nudge" }));
    await applyQuickAction(formData({ id, intent: "received" }));
    await applyQuickAction(formData({ id, intent: "handoff" }));
    await applyQuickAction(formData({ id, intent: "snooze", days: 7 }));
    await applyQuickAction(formData({ id, intent: "complete" }));
    await applyQuickAction(formData({ id, intent: "reopen" }));
    await applyQuickAction(formData({ id, intent: "abandon" }));

    const final = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(final.status).toBe("ABANDONED");
    expect(final.nudgeCount).toBe(1);
  });
});

describe("concurrence", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("concurrence-ws");
    await signIn(user);
  });

  it("ne termine qu'une fois malgré deux appels simultanés", async () => {
    const id = await createFollowUpRecord(user.workspaceId);

    const results = await Promise.allSettled([
      applyQuickAction(formData({ id, intent: "complete" })),
      applyQuickAction(formData({ id, intent: "complete" })),
    ]);

    // Exactement une des deux doit aboutir : la garde de statut est atomique.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("COMPLETED");
  });

  it("ne peut pas terminer et abandonner en même temps", async () => {
    const id = await createFollowUpRecord(user.workspaceId);

    const results = await Promise.allSettled([
      applyQuickAction(formData({ id, intent: "complete" })),
      applyQuickAction(formData({ id, intent: "abandon" })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("ne termine qu'une fois une tâche malgré deux appels simultanés", async () => {
    const id = await createTaskRecord(user.workspaceId);

    const results = await Promise.allSettled([
      applyTaskAction(formData({ id, intent: "complete" })),
      applyTaskAction(formData({ id, intent: "complete" })),
    ]);

    // La garde est la même que pour les suivis : l'`UPDATE` conditionnel ne
    // trouve la ligne dans l'état lu qu'une seule fois.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(after.completedAt).not.toBeNull();
  });

  it("ne termine pas une tâche pendant qu'on la reporte", async () => {
    const id = await createTaskRecord(user.workspaceId);

    const results = await Promise.allSettled([
      applyTaskAction(formData({ id, intent: "complete" })),
      applyTaskAction(formData({ id, intent: "snooze", days: 3 })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("contournement de la limitation de débit", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("bypass-ws");
    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10" });
  });

  const attempt = (email: string) =>
    login(initialLoginState, formData({ email, password: "faux-mot-de-passe" }));

  it("ne se contourne pas en changeant la casse de l'email", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(user.email);

    // Même compte, casse différente : le compteur doit être le même.
    const blocked = await attempt(user.email.toUpperCase());
    expect(blocked.message).toMatch(/Trop de tentatives/);
  });

  it("ne se contourne pas en ajoutant des espaces autour de l'email", async () => {
    for (let i = 0; i < 5; i += 1) await attempt(user.email);

    const blocked = await attempt(`   ${user.email}   `);
    expect(blocked.message).toMatch(/Trop de tentatives/);
  });

  it("ignore un X-Forwarded-For fourni par le client", async () => {
    // Nginx écrase toujours X-Real-IP. Un client qui envoie son propre
    // X-Forwarded-For ne doit pas pouvoir se choisir une identité réseau.
    headerJar.setAll({
      "user-agent": "vitest",
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "1.2.3.4, 203.0.113.10",
    });

    await attempt("cible-a@exemple.test");

    const attempts = await prisma.loginAttempt.findMany({ where: { scope: { startsWith: "ip:" } } });
    expect(attempts).toHaveLength(1);

    // La même IP réelle avec un XFF différent doit compter sur la même clé.
    headerJar.setAll({
      "user-agent": "vitest",
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "9.9.9.9, 203.0.113.10",
    });
    await attempt("cible-b@exemple.test");

    const after = await prisma.loginAttempt.findMany({ where: { scope: { startsWith: "ip:" } } });
    const distinctScopes = new Set(after.map((a) => a.scope));
    expect(distinctScopes.size).toBe(1);
  });

  it("n'accepte aucune IP quand seul un en-tête falsifiable est présent", async () => {
    // Sans X-Real-IP (donc hors du reverse proxy attendu), on ne doit pas
    // faire confiance à X-Forwarded-For pour identifier un client.
    headerJar.setAll({ "user-agent": "vitest", "x-forwarded-for": "1.2.3.4" });

    await attempt("sans-real-ip@exemple.test");

    const ipScoped = await prisma.loginAttempt.count({ where: { scope: { startsWith: "ip:" } } });
    expect(ipScoped).toBe(0);
  });
});

describe("hygiène des sessions", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("sessions-ws");
    headerJar.setAll({ "user-agent": "vitest", "x-real-ip": "203.0.113.10" });
  });

  it("n'accumule pas les sessions à chaque reconnexion", async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(
        login(initialLoginState, formData({ email: user.email, password: user.password })),
      ).rejects.toThrow(TestRedirect);
    }

    // Trois connexions depuis le même navigateur ne doivent pas laisser
    // trois sessions vivantes derrière elles.
    expect(await prisma.session.count({ where: { userId: user.userId } })).toBe(1);
  });

  it("produit des jetons de session distincts et de forte entropie", async () => {
    const hashes = new Set<string>();

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login(initialLoginState, formData({ email: user.email, password: user.password })),
      ).rejects.toThrow(TestRedirect);
      const session = await prisma.session.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
        select: { tokenHash: true },
      });
      hashes.add(session.tokenHash);
    }

    expect(hashes.size).toBe(5);
  });

  it("ne prolonge jamais l'inactivité au-delà de l'expiration absolue", async () => {
    await expect(
      login(initialLoginState, formData({ email: user.email, password: user.password })),
    ).rejects.toThrow(TestRedirect);

    // Session dont l'expiration absolue est proche : le rafraîchissement
    // d'inactivité ne doit pas la faire vivre plus longtemps.
    const soon = new Date(Date.now() + 60_000);
    await prisma.session.updateMany({
      data: { expiresAt: soon, lastUsedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await readSession();

    const session = await prisma.session.findFirstOrThrow();
    expect(session.idleExpiresAt.getTime()).toBeLessThanOrEqual(soon.getTime());
  });
});

describe("entrées hostiles", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await createWorkspaceWithUser("hostile-ws");
    await signIn(user);
  });

  it("résiste à un formulaire sans aucun champ", async () => {
    await expect(applyQuickAction(new FormData())).rejects.toThrow(/invalide/i);
  });

  it("résiste à un champ envoyé plusieurs fois", async () => {
    const id = await createFollowUpRecord(user.workspaceId);
    const data = new FormData();
    data.append("id", id);
    data.append("intent", "complete");
    data.append("intent", "reopen");

    // `Object.fromEntries` ne garde que la dernière valeur : le comportement
    // doit rester déterministe et sûr, jamais l'union des deux intentions.
    await expect(applyQuickAction(data)).rejects.toThrow();
    const after = await prisma.followUp.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("OPEN");
  });

  it("ne fuite aucun détail interne dans les messages d'erreur", async () => {
    const id = await createFollowUpRecord(user.workspaceId);
    await prisma.followUp.delete({ where: { id } });

    const error = await applyQuickAction(formData({ id, intent: "complete" })).catch((e) => e);

    const message = String(error?.message ?? "");
    expect(message).not.toMatch(/prisma|postgres|select|from |\/home\/|at Object/i);
  });
});
