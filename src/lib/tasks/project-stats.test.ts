import { describe, expect, it } from "vitest";

import { computeStats } from "./project-stats";
import type { TaskItem } from "./types";

const item = (over: Partial<TaskItem>): TaskItem => ({ id: "x", parentId: null, status: "TODO", dueDate: null, openBlockerCount: 0, estimatedMinutes: null, spentMinutes: 0, ...over }) as TaskItem;

describe("computeStats", () => {
  it("progression sur les tâches principales non supprimées, sans double compte des sous-tâches", () => {
    const stats = computeStats(
      [
        item({ id: "a", status: "DONE" }),
        item({ id: "b" }),
        item({ id: "a1", parentId: "a" }),
        item({ id: "a2", parentId: "a" }),
        item({ id: "c", status: "DONE", deleted: true } as Partial<TaskItem>),
      ],
      "2026-10-14",
    );
    expect(stats.top.map((t) => t.id)).toEqual(["a", "b"]);
    expect(stats.progress).toBe(0.5);
  });
});
