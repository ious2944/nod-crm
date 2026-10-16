import { connection } from "next/server";

import { MyTasksView } from "@/components/work/my-tasks";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getMyTasks, getSavedViews } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Mes tâches — NOD CRM",
};

/**
 * Mes tâches : toutes les tâches affectées à l'utilisateur, tous projets
 * confondus (et les tâches personnelles, sans projet), regroupées par
 * échéance. Ce sont les mêmes lignes que la liste historique V0.4 : il n'y a
 * qu'un système de tâches.
 */
export default async function MyTasksPage() {
  await connection();
  const actor = await getPageActor();
  const [tasks, views] = await Promise.all([getMyTasks(actor, false), getSavedViews(actor, "my-tasks")]);
  return <MyTasksView initial={tasks} savedViews={views} />;
}
