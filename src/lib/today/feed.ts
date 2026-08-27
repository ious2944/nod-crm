/**
 * Assemblage du feed « Aujourd'hui ».
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
 * Fonctions pures : testées dans `feed.test.ts`.
 */

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
