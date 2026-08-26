import { describe, expect, it } from "vitest";

import { startOfDay } from "@/lib/date";
import { toFollowUpView } from "@/lib/follow-ups/view";
import { toTaskView } from "@/lib/tasks/view";
import { buildTodayFeed, cockpitHeadline } from "./feed";

const PARIS = "Europe/Paris";
const NOW = new Date("2026-06-10T09:00:00+02:00");

function followUp(title: string, dueDate: string) {
  return toFollowUpView(
    {
      id: `fu-${title}`,
      title,
      description: null,
      status: "OPEN",
      ballOwner: "THEM",
      dueAt: startOfDay(dueDate, PARIS),
      nudgeCount: 0,
      lastNudgedAt: null,
      isDemo: false,
      createdAt: startOfDay("2026-06-01", PARIS),
      completedAt: null,
      contact: null,
    },
    NOW,
    PARIS,
  );
}

function task(title: string, dueDate: string) {
  return toTaskView(
    {
      id: `task-${title}`,
      title,
      notes: null,
      dueAt: startOfDay(dueDate, PARIS),
      completedAt: null,
      isDemo: false,
      createdAt: startOfDay("2026-06-01", PARIS),
      contact: null,
      followUp: null,
    },
    NOW,
    PARIS,
  );
}

describe("buildTodayFeed", () => {
  it("mêle suivis et tâches, de la plus vieille échéance à la plus récente", () => {
    const feed = buildTodayFeed(
      [followUp("suivi en retard", "2026-06-05"), followUp("suivi du jour", "2026-06-10")],
      [task("tâche du jour", "2026-06-10"), task("tâche très en retard", "2026-06-01")],
    );

    expect(feed.map((item) => item.title)).toEqual([
      "tâche très en retard",
      "suivi en retard",
      "suivi du jour",
      "tâche du jour",
    ]);
  });

  it("garde chaque objet dans sa nature", () => {
    const feed = buildTodayFeed([followUp("suivi", "2026-06-10")], [task("tâche", "2026-06-10")]);

    const [first, second] = feed;
    expect(first.kind).toBe("follow-up");
    expect(second.kind).toBe("task");
    // Un suivi garde sa balle, une tâche n'en a jamais eu.
    if (first.kind === "follow-up") expect(first.followUp.ballLabel).toBe("Chez eux");
    if (second.kind === "task") expect(second.task.completed).toBe(false);
  });

  it("place le suivi avant la tâche à échéance identique", () => {
    const feed = buildTodayFeed(
      [followUp("zzz suivi", "2026-06-10")],
      [task("aaa tâche", "2026-06-10")],
    );

    expect(feed.map((item) => item.kind)).toEqual(["follow-up", "task"]);
  });

  it("reste vide quand rien ne réclame d'action", () => {
    expect(buildTodayFeed([], [])).toEqual([]);
  });
});

describe("cockpitHeadline", () => {
  it("compte le travail actionnable du jour, suivis et tâches confondus", () => {
    expect(cockpitHeadline(0)).toBe("Tout est sous contrôle.");
    expect(cockpitHeadline(1)).toBe("1 élément à traiter aujourd'hui.");
    expect(cockpitHeadline(5)).toBe("5 éléments à traiter aujourd'hui.");
  });
});
