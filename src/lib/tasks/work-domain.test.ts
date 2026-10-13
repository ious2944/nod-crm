import { describe, expect, it } from "vitest";

import { startOfDay, dayKey } from "@/lib/date";

import { conditionsMatch, loopGuard, triggerMatches } from "./automation-model";
import { escapeCell, mapHeader, parseCsv, parseCsvDate, parseCsvMinutes } from "./csv";
import { cascadeShift, dateConflicts, positionBetween, wouldCreateCycle } from "./graph";
import { DEFAULT_VIEW, groupTasks, matchesFilters, runQuery } from "./query-engine";
import { describeRecurrence, nextOccurrence } from "./recurrence";
import { extractMentions, isSafeHref, parseInline, parseRichText, toggleChecklistItem } from "./rich-text";
import type { TaskItem } from "./types";

const task = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: over.id ?? "t1",
  title: "Tâche",
  status: "TODO",
  priority: "NORMAL",
  assigneeId: null,
  createdById: null,
  dueDate: null,
  dueTime: null,
  startDate: null,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  parentId: null,
  subtaskPosition: 0,
  isMilestone: false,
  isApproval: false,
  approvalStatus: null,
  estimatedMinutes: null,
  spentMinutes: 0,
  tagIds: [],
  custom: {},
  memberships: [],
  subtaskCount: 0,
  subtaskDoneCount: 0,
  commentCount: 0,
  attachmentCount: 0,
  blockedByIds: [],
  blockingIds: [],
  openBlockerCount: 0,
  recurrence: null,
  hasDescription: false,
  excerpt: "",
  contactId: null,
  organizationId: null,
  opportunityId: null,
  followUpId: null,
  version: 1,
  canEdit: true,
  ...over,
});

describe("récurrence", () => {
  it("calcule les occurrences sur le calendrier", () => {
    expect(nextOccurrence({ freq: "DAILY", interval: 2 }, "2026-10-30")).toBe("2026-11-01");
    expect(nextOccurrence({ freq: "WEEKLY", interval: 1 }, "2026-10-13")).toBe("2026-10-20");
    // Mardi → jeudi de la même semaine, puis lundi de la semaine suivante.
    expect(nextOccurrence({ freq: "WEEKLY", interval: 1, weekdays: [1, 4] }, "2026-10-13")).toBe("2026-10-15");
    expect(nextOccurrence({ freq: "WEEKLY", interval: 2, weekdays: [1, 4] }, "2026-10-15")).toBe("2026-10-26");
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1 }, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1, monthDay: 31 }, "2026-02-28")).toBe("2026-03-31");
    expect(nextOccurrence({ freq: "YEARLY", interval: 1 }, "2028-02-29")).toBe("2029-02-28");
  });

  it("reste à minuit local au passage à l'heure d'hiver", () => {
    const next = nextOccurrence({ freq: "DAILY", interval: 1 }, "2026-10-24");
    const instant = startOfDay(next, "Europe/Paris");
    expect(dayKey(instant, "Europe/Paris")).toBe("2026-10-25");
    expect(instant.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDay("2026-10-26", "Europe/Paris").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("décrit la règle en français", () => {
    expect(describeRecurrence({ freq: "WEEKLY", interval: 2, weekdays: [1, 4] })).toBe("Toutes les 2 semaines (lun., jeu.)");
    expect(describeRecurrence(null)).toBe("Ne se répète pas");
  });
});

describe("dépendances et positions", () => {
  it("détecte les cycles, directs et transitifs", () => {
    const edges = [
      { blockingId: "a", blockedId: "b" },
      { blockingId: "b", blockedId: "c" },
    ];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
  });

  it("insère entre deux positions et demande une renumérotation si l'écart est épuisé", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(5, 5 + 1e-9)).toBeNull();
  });

  it("signale les incohérences et propose un décalage seulement à la demande", () => {
    const blocker = { id: "a", startDate: "2026-10-01", dueDate: "2026-10-10" };
    const blocked = { id: "b", startDate: "2026-10-05", dueDate: "2026-10-12" };
    expect(dateConflicts(blocked, [blocker])).toEqual(["a"]);
    const moves = cascadeShift(new Map([["a", blocker], ["b", blocked]]), [{ blockingId: "a", blockedId: "b" }], "a");
    expect(moves.get("b")).toEqual({ startDate: "2026-10-11", dueDate: "2026-10-18" });
  });
});

describe("texte enrichi", () => {
  it("n'accepte que des liens sûrs", () => {
    expect(isSafeHref("https://exemple.fr")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    const nodes = parseInline("[clic](javascript:alert(1))");
    expect(nodes.every((n) => n.type === "text")).toBe(true);
  });

  it("ne produit jamais de HTML : les balises restent du texte", () => {
    const blocks = parseRichText("<img src=x onerror=alert(1)> **gras**");
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(blocks)).toContain("<img src=x onerror=alert(1)>");
  });

  it("extrait les mentions et bascule les cases à cocher", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(extractMentions(`Salut @[Bob](${id}) et @[Bob](${id})`)).toEqual([id]);
    expect(toggleChecklistItem("- [ ] a\n- [ ] b", 1)).toBe("- [ ] a\n- [x] b");
  });
});

describe("CSV", () => {
  it("lit séparateurs, guillemets et dates françaises", () => {
    expect(parseCsv('Nom;Note\n"A; b";"dit ""oui"""\n')).toEqual([["Nom", "Note"], ["A; b", 'dit "oui"']]);
    expect(mapHeader(["Nom", "Échéance", "Priorité"])).toEqual({ title: 0, dueDate: 1, priority: 2 });
    expect(parseCsvDate("31/12/2026")).toBe("2026-12-31");
    expect(parseCsvDate("31/02/2026")).toBeNull();
    expect(parseCsvMinutes("1h30")).toBe(90);
  });

  it("neutralise les formules", () => {
    expect(escapeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCell("-2")).toBe("'-2");
  });
});

describe("filtres, tris, regroupements", () => {
  const ctx = { today: "2026-10-13", meId: "me", fields: new Map() };

  it("combine les filtres", () => {
    const t = task({ assigneeId: "me", priority: "URGENT", dueDate: "2026-10-10" });
    expect(matchesFilters(t, { assigneeIds: ["me"], priorities: ["URGENT"], due: "overdue" }, ctx)).toBe(true);
    expect(matchesFilters(t, { assigneeIds: ["none"] }, ctx)).toBe(false);
    expect(matchesFilters(task({ status: "DONE" }), {}, ctx)).toBe(false);
    expect(matchesFilters(task({ status: "DONE" }), { completion: "all" }, ctx)).toBe(true);
  });

  it("groupe Mes tâches par échéance", () => {
    const groups = groupTasks(
      [task({ id: "a", dueDate: "2026-10-01" }), task({ id: "b", dueDate: "2026-10-13" }), task({ id: "c", dueDate: "2026-10-15" }), task({ id: "d" })],
      "due",
      ctx,
    );
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]));
    expect(byKey).toMatchObject({ overdue: ["a"], today: ["b"], upcoming: ["c"], none: ["d"] });
  });

  it("ordonne par position dans la section du projet courant", () => {
    const sections = [{ id: "s1", projectId: "p", name: "S1", position: 1 }];
    const groups = runQuery(
      [task({ id: "x", memberships: [{ projectId: "p", sectionId: "s1", position: 20 }] }), task({ id: "y", memberships: [{ projectId: "p", sectionId: "s1", position: 10 }] })],
      DEFAULT_VIEW,
      { ...ctx, projectId: "p", sections },
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["y", "x"]);
  });
});

describe("règles", () => {
  it("vérifie déclencheur, conditions et garde anti-boucle", () => {
    expect(triggerMatches({ trigger: "PRIORITY_CHANGED", triggerConfig: { priority: "URGENT" } }, { type: "PRIORITY_CHANGED", to: "URGENT" })).toBe(true);
    expect(triggerMatches({ trigger: "PRIORITY_CHANGED", triggerConfig: { priority: "URGENT" } }, { type: "PRIORITY_CHANGED", to: "HIGH" })).toBe(false);
    expect(conditionsMatch([{ kind: "assignee_set" }], task({ assigneeId: "u" }), null)).toBe(true);
    expect(loopGuard("r1", { depth: 0, chain: ["r1"] })).toMatch(/Boucle/);
    expect(loopGuard("r1", { depth: 3, chain: [] })).toMatch(/Profondeur/);
    expect(loopGuard("r1", { depth: 1, chain: ["r2"] })).toBeNull();
  });
});
