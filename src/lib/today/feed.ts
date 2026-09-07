/**
 * Assemblage du feed « Aujourd'hui » et compteurs KPI combinés.
 *
 * Le cockpit répond à une seule question — *qu'est-ce qui demande une action
 * maintenant ?* — et deux objets peuvent y répondre :
 *
 * - un **suivi** ouvert dont l'échéance est atteinte (règle V0.3, inchangée) ;
 * - une **tâche** non terminée dont l'échéance est atteinte (règle V0.4).
 *
 * Les deux gardent leur nature : ils sont juste triés ensemble par urgence.
 * Rien ici ne synchronise leurs états — terminer une tâche ne touche pas au
 * suivi qu'elle cite, et réciproquement.
 *
 * Les KPI (En retard / Aujourd'hui / À venir) comptent les deux types.
 * « Chez eux » reste propre aux suivis : aucune tâche n'a de notion de balle.
 *
 * Fonctions pures : testées dans `feed.test.ts`.
 */

import type { AttentionCounters, CockpitFilter } from "@/lib/cockpit/filters";
import type { FollowUpView } from "@/lib/follow-ups/view";
import type { TaskView } from "@/lib/tasks/view";

export type FeedItem =
  | { kind: "follow-up"; id: string; dueDate: string; title: string; followUp: FollowUpView }
  | { kind: "task"; id: string; dueDate: string; title: string; task: TaskView };

/**
 * Tri du feed : la plus vieille échéance d'abord.
 *
 * À échéance égale, les suivis passent devant : ce sont eux qui dépendent de
 * quelqu'un d'autre, donc ceux dont le retard coûte le plus cher. Le titre
 * départage le reste, pour que deux rendus successifs donnent le même ordre.
 */
export function compareFeedItems(a: FeedItem, b: FeedItem): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "follow-up" ? -1 : 1;
  return a.title.localeCompare(b.title, "fr");
}

export function buildTodayFeed(
  followUps: readonly FollowUpView[],
  tasks: readonly TaskView[],
): FeedItem[] {
  const items: FeedItem[] = [
    ...followUps.map(
      (followUp): FeedItem => ({
        kind: "follow-up",
        id: followUp.id,
        dueDate: followUp.dueDate,
        title: followUp.title,
        followUp,
      }),
    ),
    ...tasks.map(
      (task): FeedItem => ({
        kind: "task",
        id: task.id,
        dueDate: task.dueDate,
        title: task.title,
        task,
      }),
    ),
  ];

  return items.sort(compareFeedItems);
}

/**
 * Titre du cockpit.
 *
 * **Attention à la sémantique.** Ce compteur-ci porte sur le *travail
 * actionnable du jour*, suivis **et** tâches confondus : c'est exactement ce
 * que la page liste en dessous. Il ne remplace ni ne modifie les quatre
 * compteurs de la page Suivis (« Ouverts », « Chez moi », « Chez eux »,
 * « À relancer »), qui restent des compteurs de suivis et rien d'autre.
 */
export function cockpitHeadline(count: number): string {
  if (count === 0) return "Tout est sous contrôle.";
  if (count === 1) return "1 élément à traiter aujourd'hui.";
  return `${count} éléments à traiter aujourd'hui.`;
}

// ─── Compteurs KPI combinés ───────────────────────────────────────────────────

/**
 * Répartition des tâches non terminées dans les trois catégories temporelles
 * des KPI du cockpit.
 *
 * La requête qui alimente cette fonction filtre déjà `dueAt <= endOfWindow`,
 * donc toute tâche avec `bucket === "upcoming"` est garantie dans la fenêtre.
 */
export interface TaskKpiCounts {
  overdue: number;
  today: number;
  upcoming: number;
}

/**
 * Compte les tâches non terminées par catégorie KPI.
 *
 * Entrée : tableau de `TaskView` dont `bucket` est déjà calculé et dont
 * `completedAt === null` est garanti par la requête amont.
 *
 * Le champ `bucket` de `TaskView` vaut `"overdue"`, `"today"` ou `"upcoming"`
 * pour les tâches actives ; `"completed"` ne peut apparaître ici que par
 * erreur, et est simplement ignoré.
 */
export function computeTaskKpiCounts(
  tasks: readonly Pick<TaskView, "bucket">[],
): TaskKpiCounts {
  let overdue = 0;
  let today = 0;
  let upcoming = 0;

  for (const task of tasks) {
    if (task.bucket === "overdue") overdue++;
    else if (task.bucket === "today") today++;
    else if (task.bucket === "upcoming") upcoming++;
    // "completed" ignoré : ne doit pas arriver, mais ne casse rien s'il arrive.
  }

  return { overdue, today, upcoming };
}

/**
 * Filtre les tâches à afficher selon le filtre KPI actif.
 *
 * Règle de cohérence : la section « Tâches » de la page Aujourd'hui doit
 * afficher exactement les tâches qui ont été comptées dans le KPI activé.
 *
 * - `all`      → tâches actionnables (en retard + aujourd'hui)
 * - `late`     → tâches en retard uniquement
 * - `today`    → tâches dues aujourd'hui uniquement
 * - `upcoming` → tâches à venir (dans la fenêtre de UPCOMING_WINDOW_DAYS jours)
 * - `waiting`  → aucune tâche (« Chez eux » est un concept de suivi)
 */
export function filterTasksForKpi(
  tasks: readonly TaskView[],
  filter: CockpitFilter,
): TaskView[] {
  switch (filter) {
    case "all":
      return tasks.filter((t) => t.isActionable);
    case "late":
      return tasks.filter((t) => t.bucket === "overdue");
    case "today":
      return tasks.filter((t) => t.bucket === "today");
    case "upcoming":
      return tasks.filter((t) => t.bucket === "upcoming");
    case "waiting":
      return [];
    default:
      return [];
  }
}

/**
 * Fusionne les compteurs KPI des suivis (source : cockpit) et des tâches.
 *
 * Règle métier :
 * - « En retard » = suivis en retard + tâches en retard
 * - « Aujourd'hui » = suivis du jour + tâches du jour
 * - « À venir » = suivis à venir + tâches à venir (dans la même fenêtre)
 * - « Chez eux » = suivis chez eux uniquement — les tâches n'ont pas de balle.
 *
 * Les trois premières catégories sont mutuellement exclusives : un élément ne
 * peut appartenir qu'à l'une d'elles, donc il n'y a pas de double comptage.
 */
export function mergeAttentionCounters(
  followUpCounters: AttentionCounters,
  taskCounts: TaskKpiCounts,
): AttentionCounters {
  return {
    late: followUpCounters.late + taskCounts.overdue,
    today: followUpCounters.today + taskCounts.today,
    upcoming: followUpCounters.upcoming + taskCounts.upcoming,
    waiting: followUpCounters.waiting, // inchangé : pas de balle pour les tâches
  };
}
