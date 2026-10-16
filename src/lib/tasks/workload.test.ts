import { describe, expect, it } from "vitest";

import { computeWorkload, loadLevel, remainingMinutes, workdaysBetween, type WorkloadTask } from "./workload";

// 2026-10-12 est un lundi.
const WEEKS = ["2026-10-12", "2026-10-19"];
const task = (over: Partial<WorkloadTask>): WorkloadTask => ({
  id: "t",
  assigneeId: "u1",
  status: "TODO",
  startDate: null,
  dueDate: "2026-10-14",
  estimatedMinutes: 60,
  spentMinutes: 0,
  ...over,
});

describe("computeWorkload", () => {
  it("compte l'estimation restante la semaine de l'échéance", () => {
    const [row] = computeWorkload({ tasks: [task({ spentMinutes: 15 })], weekStarts: WEEKS, capacities: {} });
    expect(row.weeks).toEqual([45, 0]);
    expect(row.capacityMinutes).toBe(35 * 60);
  });

  it("répartit sur les jours ouvrés entre début et échéance, et borne à la période", () => {
    // Du jeudi 15 au mercredi 21 : 5 jours ouvrés (jeu, ven, lun, mar, mer).
    const [row] = computeWorkload({ tasks: [task({ startDate: "2026-10-15", dueDate: "2026-10-21", estimatedMinutes: 500 })], weekStarts: WEEKS, capacities: {} });
    expect(row.weeks).toEqual([200, 300]);
    // Une seule semaine affichée : la part hors période n'est pas comptée.
    const [only] = computeWorkload({ tasks: [task({ startDate: "2026-10-15", dueDate: "2026-10-21", estimatedMinutes: 500 })], weekStarts: [WEEKS[0]], capacities: {} });
    expect(only.weeks).toEqual([200]);
  });

  it("isole le retard, les tâches sans date et sans estimation", () => {
    const rows = computeWorkload({
      tasks: [
        task({ id: "late", dueDate: "2026-10-01", estimatedMinutes: 90 }),
        task({ id: "nodate", dueDate: null }),
        task({ id: "noest", estimatedMinutes: null }),
        task({ id: "done", status: "DONE" }),
        task({ id: "nobody", assigneeId: null }),
        task({ id: "after", dueDate: "2026-12-01" }),
      ],
      weekStarts: WEEKS,
      capacities: { u1: 600 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ overdueMinutes: 90, overdueTasks: ["late"], undated: ["nodate"], unestimated: ["noest"], weeks: [0, 0], capacityMinutes: 600 });
  });

  it("utilise la capacité de chacun et signale le dépassement", () => {
    const rows = computeWorkload({
      tasks: [task({ id: "a", assigneeId: "u1", estimatedMinutes: 700 }), task({ id: "b", assigneeId: "u2", estimatedMinutes: 700 })],
      weekStarts: WEEKS,
      capacities: { u1: 600, u2: null },
    });
    const byUser = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(loadLevel(byUser.u1.weeks[0], byUser.u1.capacityMinutes)).toBe("over");
    expect(loadLevel(byUser.u2.weeks[0], byUser.u2.capacityMinutes)).toBe("ok");
  });

  it("outils de calcul", () => {
    expect(workdaysBetween("2026-10-17", "2026-10-18")).toEqual(["2026-10-18"]); // week-end : le jour d'échéance
    expect(workdaysBetween("2026-10-16", "2026-10-19")).toEqual(["2026-10-16", "2026-10-19"]);
    expect(remainingMinutes({ estimatedMinutes: 30, spentMinutes: 90 })).toBe(0);
  });
});
