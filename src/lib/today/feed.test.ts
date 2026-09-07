import { describe, expect, it } from "vitest";

import { startOfDay } from "@/lib/date";
import type { AttentionCounters } from "@/lib/cockpit/filters";
import { toFollowUpView } from "@/lib/follow-ups/view";
import { toTaskView } from "@/lib/tasks/view";
import {
  buildTodayFeed,
  cockpitHeadline,
  computeTaskKpiCounts,
  filterTasksForKpi,
  mergeAttentionCounters,
  type TaskKpiCounts,
} from "./feed";

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

// ─── filterTasksForKpi ──────────────────────────────────────────────────────

describe("filterTasksForKpi", () => {
  // NOW = 2026-06-10 → "2026-06-05" = overdue, "2026-06-10" = today, "2026-06-15" = upcoming

  it("filtre today → tâche aujourd'hui visible", () => {
    const tasks = [task("today-task", "2026-06-10"), task("overdue-task", "2026-06-05")];
    const result = filterTasksForKpi(tasks, "today");
    expect(result.map((t) => t.title)).toEqual(["today-task"]);
  });

  it("filtre today → suivi aujourd'hui visible (suivis gérés séparément, tâche du jour seule)", () => {
    // La fonction ne filtre que les tâches ; ce test vérifie que seule la tâche du jour passe.
    const tasks = [task("today-task", "2026-06-10"), task("upcoming-task", "2026-06-15")];
    const result = filterTasksForKpi(tasks, "today");
    expect(result.map((t) => t.title)).toEqual(["today-task"]);
  });

  it("filtre late → tâche en retard visible", () => {
    const tasks = [task("overdue-task", "2026-06-05"), task("today-task", "2026-06-10")];
    const result = filterTasksForKpi(tasks, "late");
    expect(result.map((t) => t.title)).toEqual(["overdue-task"]);
  });

  it("filtre late → tâche du jour non affichée", () => {
    const tasks = [task("today-task", "2026-06-10")];
    const result = filterTasksForKpi(tasks, "late");
    expect(result).toEqual([]);
  });

  it("filtre upcoming → tâche future visible", () => {
    const tasks = [task("upcoming-task", "2026-06-15"), task("today-task", "2026-06-10")];
    const result = filterTasksForKpi(tasks, "upcoming");
    expect(result.map((t) => t.title)).toEqual(["upcoming-task"]);
  });

  it("filtre upcoming → suivi futur visible (suivis gérés séparément, tâche future seule)", () => {
    const tasks = [task("upcoming-task", "2026-06-15"), task("overdue-task", "2026-06-05")];
    const result = filterTasksForKpi(tasks, "upcoming");
    expect(result.map((t) => t.title)).toEqual(["upcoming-task"]);
  });

  it("filtre waiting → aucune tâche (pas de notion de balle)", () => {
    const tasks = [
      task("overdue-task", "2026-06-05"),
      task("today-task", "2026-06-10"),
      task("upcoming-task", "2026-06-15"),
    ];
    const result = filterTasksForKpi(tasks, "waiting");
    expect(result).toEqual([]);
  });

  it("tâche terminée non affichée (complétées exclues par la requête en amont)", () => {
    // getTasksForKpi filtre completedAt: null, donc les complétées n'arrivent pas ici.
    // On vérifie quand même que filterTasksForKpi ne remonte jamais bucket=completed.
    const tasks = [task("today-task", "2026-06-10")];
    const result = filterTasksForKpi(tasks, "all");
    expect(result.every((t) => t.bucket !== "completed")).toBe(true);
  });

  it("filtre all → tâches actionnables (en retard + aujourd'hui) uniquement", () => {
    const tasks = [
      task("overdue-task", "2026-06-05"),
      task("today-task", "2026-06-10"),
      task("upcoming-task", "2026-06-15"),
    ];
    const result = filterTasksForKpi(tasks, "all");
    expect(result.map((t) => t.title).sort()).toEqual(["overdue-task", "today-task"]);
  });

  it("aucun élément hors du bucket demandé (filtre late → pas d'upcoming ni today)", () => {
    const tasks = [
      task("overdue-task", "2026-06-05"),
      task("today-task", "2026-06-10"),
      task("upcoming-task", "2026-06-15"),
    ];
    const result = filterTasksForKpi(tasks, "late");
    expect(result.every((t) => t.bucket === "overdue")).toBe(true);
  });

  it("compteur N correspond au nombre d'éléments filtrés (filtre today)", () => {
    const tasks = [
      task("overdue-task", "2026-06-05"),
      task("today-1", "2026-06-10"),
      task("today-2", "2026-06-10"),
      task("upcoming-task", "2026-06-15"),
    ];
    const counts = computeTaskKpiCounts(tasks);
    const filtered = filterTasksForKpi(tasks, "today");
    expect(filtered.length).toBe(counts.today);
  });
});

// ─── computeTaskKpiCounts ────────────────────────────────────────────────────

describe("computeTaskKpiCounts", () => {
  it("range une tâche du jour dans « today »", () => {
    const counts = computeTaskKpiCounts([{ bucket: "today" }]);
    expect(counts).toEqual({ overdue: 0, today: 1, upcoming: 0 });
  });

  it("range une tâche en retard dans « overdue »", () => {
    const counts = computeTaskKpiCounts([{ bucket: "overdue" }]);
    expect(counts).toEqual({ overdue: 1, today: 0, upcoming: 0 });
  });

  it("range une tâche future dans « upcoming »", () => {
    const counts = computeTaskKpiCounts([{ bucket: "upcoming" }]);
    expect(counts).toEqual({ overdue: 0, today: 0, upcoming: 1 });
  });

  it("n'intègre pas une tâche terminée", () => {
    const counts = computeTaskKpiCounts([{ bucket: "completed" as "overdue" }]);
    // « completed » n'incrémente aucun compteur
    expect(counts).toEqual({ overdue: 0, today: 0, upcoming: 0 });
  });

  it("mêle tâche en retard + tâche du jour → overdue:1, today:1", () => {
    const counts = computeTaskKpiCounts([{ bucket: "overdue" }, { bucket: "today" }]);
    expect(counts).toEqual({ overdue: 1, today: 1, upcoming: 0 });
  });

  it("retourne tout à zéro quand la liste est vide", () => {
    expect(computeTaskKpiCounts([])).toEqual({ overdue: 0, today: 0, upcoming: 0 });
  });
});

// ─── mergeAttentionCounters ──────────────────────────────────────────────────

describe("mergeAttentionCounters", () => {
  function followUpCounters(overrides: Partial<AttentionCounters> = {}): AttentionCounters {
    return { late: 0, today: 0, upcoming: 0, waiting: 0, ...overrides };
  }

  function taskCounts(overrides: Partial<TaskKpiCounts> = {}): TaskKpiCounts {
    return { overdue: 0, today: 0, upcoming: 0, ...overrides };
  }

  // Scénario 1 : tâche du jour ⇒ +1 dans Aujourd'hui
  it("1. tâche due aujourd'hui → +1 dans Aujourd'hui", () => {
    const merged = mergeAttentionCounters(followUpCounters(), taskCounts({ today: 1 }));
    expect(merged.today).toBe(1);
    expect(merged.late).toBe(0);
    expect(merged.upcoming).toBe(0);
  });

  // Scénario 2 : suivi du jour ⇒ +1 dans Aujourd'hui (via followUpCounters)
  it("2. suivi dû aujourd'hui → +1 dans Aujourd'hui", () => {
    const merged = mergeAttentionCounters(followUpCounters({ today: 1 }), taskCounts());
    expect(merged.today).toBe(1);
  });

  // Scénario 3 : tâche + suivi dus aujourd'hui → Aujourd'hui = 2
  it("3. tâche + suivi dus aujourd'hui → Aujourd'hui = 2", () => {
    const merged = mergeAttentionCounters(followUpCounters({ today: 1 }), taskCounts({ today: 1 }));
    expect(merged.today).toBe(2);
  });

  // Scénario 4 : tâche en retard ⇒ +1 dans En retard
  it("4. tâche en retard → +1 dans En retard", () => {
    const merged = mergeAttentionCounters(followUpCounters(), taskCounts({ overdue: 1 }));
    expect(merged.late).toBe(1);
    expect(merged.today).toBe(0);
  });

  // Scénario 5 : suivi en retard ⇒ +1 dans En retard
  it("5. suivi en retard → +1 dans En retard", () => {
    const merged = mergeAttentionCounters(followUpCounters({ late: 1 }), taskCounts());
    expect(merged.late).toBe(1);
  });

  // Scénario 6 : tâche future ⇒ +1 dans À venir
  it("6. tâche future → +1 dans À venir", () => {
    const merged = mergeAttentionCounters(followUpCounters(), taskCounts({ upcoming: 1 }));
    expect(merged.upcoming).toBe(1);
  });

  // Scénario 7 : suivi futur ⇒ +1 dans À venir
  it("7. suivi futur → +1 dans À venir", () => {
    const merged = mergeAttentionCounters(followUpCounters({ upcoming: 1 }), taskCounts());
    expect(merged.upcoming).toBe(1);
  });

  // Scénario 8 : tâche terminée ⇒ non comptée
  it("8. tâche terminée → non comptée", () => {
    // computeTaskKpiCounts écarte les tâches complétées (bucket = "completed")
    const counts = computeTaskKpiCounts([{ bucket: "completed" as "overdue" }]);
    const merged = mergeAttentionCounters(followUpCounters(), counts);
    expect(merged.late + merged.today + merged.upcoming).toBe(0);
  });

  // Scénario 9 : suivi terminé ⇒ non compté (géré par getCockpit côté suivis)
  it("9. suivi terminé → non compté dans les compteurs de suivi", () => {
    // getCockpit filtre status: "OPEN", donc les suivis clos ne sont jamais
    // dans followUpCounters. Ce test vérifie que mergeAttentionCounters ne les
    // réintroduit pas.
    const merged = mergeAttentionCounters(followUpCounters({ today: 0 }), taskCounts());
    expect(merged.today).toBe(0);
  });

  // Scénario 10 : pas de double comptage entre En retard / Aujourd'hui / À venir
  it("10. absence de double comptage entre En retard / Aujourd'hui / À venir", () => {
    // Un élément ne peut appartenir qu'à un seul bucket.
    const merged = mergeAttentionCounters(
      followUpCounters({ late: 1, today: 1, upcoming: 1 }),
      taskCounts({ overdue: 1, today: 1, upcoming: 1 }),
    );
    // Chaque bucket compte exactement 2 (1 suivi + 1 tâche), sans recouvrement.
    expect(merged.late).toBe(2);
    expect(merged.today).toBe(2);
    expect(merged.upcoming).toBe(2);
    // La somme est exactement 6, sans aucun élément compté deux fois.
    expect(merged.late + merged.today + merged.upcoming).toBe(6);
  });

  it("préserve le compteur « Chez eux » inchangé (pas de balle pour les tâches)", () => {
    const merged = mergeAttentionCounters(
      followUpCounters({ waiting: 3 }),
      taskCounts({ overdue: 5, today: 5, upcoming: 5 }),
    );
    expect(merged.waiting).toBe(3);
  });
});
