import "server-only";

import { APP_TIME_ZONE } from "@/lib/config";
import { dayKey, endOfDay } from "@/lib/date";
import { getActionableFollowUps } from "@/lib/follow-ups/queries";
import { getActionableTasks } from "@/lib/tasks/queries";
import { buildTodayFeed, type FeedItem } from "./feed";

/**
 * Lecture du cockpit « Aujourd'hui ».
 *
 * Deux requêtes, une par nature d'objet, chacune déjà cloisonnée sur le
 * workspace de la session par sa propre fonction. Le fuseau de référence est
 * `APP_TIME_ZONE`, comme partout ailleurs : « aujourd'hui » ne dépend pas du
 * fuseau du serveur.
 */
export async function getTodayFeed(): Promise<FeedItem[]> {
  const endOfToday = endOfDay(dayKey(new Date(), APP_TIME_ZONE), APP_TIME_ZONE);

  const [followUps, tasks] = await Promise.all([
    getActionableFollowUps(endOfToday),
    getActionableTasks(endOfToday),
  ]);

  return buildTodayFeed(followUps, tasks);
}
