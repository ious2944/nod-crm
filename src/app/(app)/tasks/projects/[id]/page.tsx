import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ProjectView } from "@/components/work/project-view";
import { PROJECT_TAB_KEYS, type ProjectTabKey } from "@/lib/tasks/constants";
import { TaskAccessError } from "@/lib/tasks/access";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getProjectBundle, getSavedViews } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Projet — NOD CRM",
};

export default async function ProjectPage({ params, searchParams }: PageProps<"/tasks/projects/[id]">) {
  await connection();
  const actor = await getPageActor();
  const { id } = await params;
  const { view } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let bundle;
  try {
    bundle = await getProjectBundle(actor, id);
  } catch (error) {
    // Projet inexistant ou privé dont on n'est pas membre : même réponse.
    if (error instanceof TaskAccessError) notFound();
    throw error;
  }
  const views = await getSavedViews(actor, `project:${id}`);
  const tab = (PROJECT_TAB_KEYS as readonly string[]).includes(String(view)) ? (view as ProjectTabKey) : "list";
  return <ProjectView initial={bundle} initialTab={tab} savedViews={views} />;
}
