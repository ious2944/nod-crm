import { describe, expect, it } from "vitest";

import { startOfDay } from "@/lib/date";
import {
  compareTasks,
  computeTaskTiming,
  taskBucket,
  taskHeadline,
  TASK_SNOOZE_OPTIONS,
} from "./domain";
import { parseTaskFilter } from "./filters";
import { followUpLinkLabel, toTaskView } from "./view";

const PARIS = "Europe/Paris";
const NOW = new Date("2026-06-10T09:00:00+02:00");

function timingFor(dueDate: string, completedAt: Date | null = null) {
  return computeTaskTiming({ dueAt: startOfDay(dueDate, PARIS), completedAt }, NOW, PARIS);
}

describe("taskBucket", () => {
  it("range une tâche non terminée selon son échéance", () => {
    expect(taskBucket(4)).toBe("overdue");
    expect(taskBucket(1)).toBe("overdue");
    expect(taskBucket(0)).toBe("today");
    expect(taskBucket(-1)).toBe("upcoming");
    expect(taskBucket(-30)).toBe("upcoming");
  });
});

describe("computeTaskTiming", () => {
  it("marque en retard ce qui a dépassé son échéance", () => {
    const timing = timingFor("2026-06-06");

    expect(timing.overdueDays).toBe(4);
    expect(timing.bucket).toBe("overdue");
    expect(timing.level).toBe("late");
    expect(timing.dueLabel).toBe("J+4");
    expect(timing.isActionable).toBe(true);
  });

  it("marque actionnable ce qui est dû aujourd'hui", () => {
    const timing = timingFor("2026-06-10");

    expect(timing.overdueDays).toBe(0);
    expect(timing.bucket).toBe("today");
    expect(timing.level).toBe("today");
    expect(timing.dueLabel).toBe("Aujourd'hui");
    expect(timing.isActionable).toBe(true);
  });

  it("laisse demain et après hors du feed", () => {
    expect(timingFor("2026-06-11").isActionable).toBe(false);
    expect(timingFor("2026-06-11").dueLabel).toBe("Demain");
    expect(timingFor("2026-06-20").isActionable).toBe(false);
    expect(timingFor("2026-06-20").dueLabel).toBe("Dans 10 j");
    expect(timingFor("2026-06-20").bucket).toBe("upcoming");
  });

  it("sort du feed dès qu'elle est terminée, même très en retard", () => {
    const timing = timingFor("2026-05-01", new Date("2026-06-09T10:00:00+02:00"));

    expect(timing.bucket).toBe("completed");
    expect(timing.level).toBe("done");
    expect(timing.dueLabel).toBe("Terminée");
    expect(timing.isActionable).toBe(false);
  });

  it("reste actionnable jusqu'à la fin de la journée locale", () => {
    // 23 h 30 à Paris : le lendemain en UTC, mais toujours « aujourd'hui » ici.
    const lateEvening = new Date("2026-06-10T23:30:00+02:00");
    const timing = computeTaskTiming(
      { dueAt: startOfDay("2026-06-10", PARIS), completedAt: null },
      lateEvening,
      PARIS,
    );

    expect(timing.isActionable).toBe(true);
    expect(timing.bucket).toBe("today");
  });
});

describe("compareTasks", () => {
  it("trie de la plus en retard à la plus lointaine", () => {
    const items = [
      { title: "demain", dueAt: startOfDay("2026-06-11", PARIS), createdAt: NOW },
      { title: "très en retard", dueAt: startOfDay("2026-06-01", PARIS), createdAt: NOW },
      { title: "aujourd'hui", dueAt: startOfDay("2026-06-10", PARIS), createdAt: NOW },
    ];

    expect([...items].sort(compareTasks).map((item) => item.title)).toEqual([
      "très en retard",
      "aujourd'hui",
      "demain",
    ]);
  });

  it("départage deux échéances identiques par l'ancienneté", () => {
    const due = startOfDay("2026-06-10", PARIS);
    const items = [
      { title: "récente", dueAt: due, createdAt: new Date("2026-06-09T10:00:00Z") },
      { title: "ancienne", dueAt: due, createdAt: new Date("2026-06-01T10:00:00Z") },
    ];

    expect([...items].sort(compareTasks).map((item) => item.title)).toEqual([
      "ancienne",
      "récente",
    ]);
  });
});

describe("taskHeadline", () => {
  it("annonce un workspace à jour sans avoir l'air en panne", () => {
    expect(taskHeadline(0)).toBe("Aucune tâche à faire.");
    expect(taskHeadline(1)).toBe("1 tâche à faire.");
    expect(taskHeadline(4)).toBe("4 tâches à faire.");
  });
});

describe("TASK_SNOOZE_OPTIONS", () => {
  it("propose quelques choix rapides, pas un calendrier", () => {
    expect(TASK_SNOOZE_OPTIONS.map((option) => option.days)).toEqual([1, 3, 7]);
  });
});

describe("parseTaskFilter", () => {
  it("retombe sur « à faire » pour toute valeur inattendue", () => {
    expect(parseTaskFilter("done")).toBe("done");
    expect(parseTaskFilter("todo")).toBe("todo");
    expect(parseTaskFilter("archives")).toBe("todo");
    expect(parseTaskFilter(undefined)).toBe("todo");
    expect(parseTaskFilter(["done", "todo"])).toBe("done");
  });
});

describe("toTaskView", () => {
  const base = {
    id: "task-1",
    title: "Préparer le contrat",
    notes: null,
    dueAt: startOfDay("2026-06-11", PARIS),
    completedAt: null,
    isDemo: false,
    createdAt: startOfDay("2026-06-01", PARIS),
    contact: null,
    followUp: null,
  };

  it("expose une tâche seule sans contexte inventé", () => {
    const view = toTaskView(base, NOW, PARIS);

    expect(view.dueDate).toBe("2026-06-11");
    expect(view.dueLabel).toBe("Demain");
    expect(view.contactName).toBeNull();
    expect(view.followUpLabel).toBeNull();
    expect(view.completed).toBe(false);
  });

  it("porte le contact sans en faire un suivi", () => {
    const view = toTaskView(
      {
        ...base,
        contact: {
          id: "contact-1",
          firstName: "Sophie",
          lastName: "Martin",
          archivedAt: null,
        },
      },
      NOW,
      PARIS,
    );

    expect(view.contactId).toBe("contact-1");
    expect(view.contactName).toBe("Sophie Martin");
    expect(view.contactArchived).toBe(false);
    // Aucune notion de balle ni de relance : ce sont des propriétés de suivi.
    expect(Object.keys(view)).not.toContain("ballOwner");
    expect(Object.keys(view)).not.toContain("nudgeCount");
  });

  it("signale un contact archivé au lieu de le faire disparaître", () => {
    const view = toTaskView(
      {
        ...base,
        contact: {
          id: "contact-1",
          firstName: "Sophie",
          lastName: "Martin",
          archivedAt: new Date("2026-06-05T10:00:00Z"),
        },
      },
      NOW,
      PARIS,
    );

    expect(view.contactName).toBe("Sophie Martin");
    expect(view.contactArchived).toBe(true);
  });

  it("résume le suivi lié sans surcharger la ligne", () => {
    const view = toTaskView(
      {
        ...base,
        followUp: {
          id: "fu-1",
          title: "Validation commerciale",
          contact: { firstName: "Camille", lastName: "Roy" },
        },
      },
      NOW,
      PARIS,
    );

    expect(view.followUpId).toBe("fu-1");
    expect(view.followUpLabel).toBe("Validation commerciale — Camille");
  });
});

describe("followUpLinkLabel", () => {
  it("se passe du contact quand le suivi n'en a pas", () => {
    expect(followUpLinkLabel({ title: "Relire le contrat", contact: null })).toBe(
      "Relire le contrat",
    );
  });
});
