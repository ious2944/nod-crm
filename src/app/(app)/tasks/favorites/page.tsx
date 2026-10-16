import { connection } from "next/server";

import { ProjectsList } from "@/components/work/projects-list";
import { getPageActor } from "@/lib/tasks/page-actor";
import { listProjects } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Favoris — NOD CRM",
};

export default async function FavoritesPage() {
  await connection();
  const actor = await getPageActor();
  const projects = (await listProjects(actor, "all")).filter((p) => p.isFavorite);
  return <ProjectsList projects={projects} scope="favorites" />;
}
