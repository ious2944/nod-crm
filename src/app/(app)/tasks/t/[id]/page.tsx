import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { TaskAccessError } from "@/lib/tasks/access";
import { getPageActor } from "@/lib/tasks/page-actor";
import { resolveTaskLocation } from "@/lib/tasks/work-queries";

/**
 * Lien direct vers une tâche : `/tasks/t/<id>`. Ouvre la tâche dans son
 * premier projet lisible (ou dans « Mes tâches »), panneau de détail ouvert.
 * Une tâche invisible pour l'utilisateur donne un 404, comme une tâche
 * inexistante.
 */
export default async function TaskLinkPage({ params }: PageProps<"/tasks/t/[id]">) {
  await connection();
  const actor = await getPageActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let location: string;
  try {
    location = await resolveTaskLocation(actor, id);
  } catch (error) {
    if (error instanceof TaskAccessError) notFound();
    throw error;
  }
  redirect(location);
}
