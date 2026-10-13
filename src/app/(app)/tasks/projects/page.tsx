import { connection } from "next/server";

import { ProjectsList } from "@/components/work/projects-list";
import { getPageActor } from "@/lib/tasks/page-actor";
import { listProjects } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Projets — NOD CRM",
};

const SCOPES = ["active", "archived", "templates"] as const;

export default async function ProjectsPage({ searchParams }: PageProps<"/tasks/projects">) {
  await connection();
  const actor = await getPageActor();
  const raw = String((await searchParams).scope ?? "active");
  const scope = (SCOPES as readonly string[]).includes(raw) ? (raw as (typeof SCOPES)[number]) : "active";
  const projects = await listProjects(actor, scope);
  return <ProjectsList projects={projects} scope={scope} />;
}
