import { connection } from "next/server";

import { WorkloadView } from "@/components/work/portfolio-workload";
import { startOfWeekKey } from "@/lib/tasks/format";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getWorkload, todayKey } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Charge de travail — NOD CRM",
};

const DEFAULT_WEEKS = 6;
const ALLOWED_WEEKS = new Set([2, 4, 6, 8, 12]);

export default async function WorkloadPage({ searchParams }: PageProps<"/tasks/workload">) {
  await connection();
  const params = await searchParams;
  const rawFrom = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) && !Number.isNaN(Date.parse(params.from)) ? params.from : todayKey();
  const rawWeeks = Number(typeof params.weeks === "string" ? params.weeks : DEFAULT_WEEKS);
  const weeks = ALLOWED_WEEKS.has(rawWeeks) ? rawWeeks : DEFAULT_WEEKS;
  const from = startOfWeekKey(rawFrom);
  const actor = await getPageActor();
  const data = await getWorkload(actor, from, weeks);
  return <WorkloadView initial={data.tasks} from={data.from} weeks={weeks} capacities={data.capacities} />;
}
