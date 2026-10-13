import { connection } from "next/server";

import { PortfolioView } from "@/components/work/portfolio-workload";
import { getPageActor } from "@/lib/tasks/page-actor";
import { listProjects } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Synthèse des projets — NOD CRM",
};

export default async function PortfolioPage() {
  await connection();
  const actor = await getPageActor();
  return <PortfolioView projects={await listProjects(actor, "active")} />;
}
