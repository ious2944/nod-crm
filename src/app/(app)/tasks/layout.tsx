import { connection } from "next/server";

import { TasksShell } from "@/components/work/tasks-shell";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getWorkContext } from "@/lib/tasks/work-queries";

/**
 * Coquille du module Tâches : navigation latérale (Mes tâches, Projets,
 * Notifications, Favoris…) et contexte partagé (personnes, tags, champs,
 * projets lisibles) rendu côté serveur.
 */
export default async function TasksLayout({ children }: LayoutProps<"/tasks">) {
  await connection();
  const actor = await getPageActor();
  const context = await getWorkContext(actor);
  return <TasksShell context={context}>{children}</TasksShell>;
}
