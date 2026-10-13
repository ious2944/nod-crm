import { connection } from "next/server";

import { WorkloadView } from "@/components/work/portfolio-workload";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getWorkload, todayKey } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Charge de travail — NOD CRM",
};

const WEEKS = 6;

export default async function WorkloadPage() {
  await connection();
  const actor = await getPageActor();
  const data = await getWorkload(actor, todayKey(), WEEKS);
  return <WorkloadView initial={data.tasks} from={data.from} weeks={WEEKS} />;
}
