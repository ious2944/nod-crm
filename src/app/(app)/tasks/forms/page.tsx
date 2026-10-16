import { connection } from "next/server";

import { FormsList } from "@/components/work/forms-settings";
import { getPageActor } from "@/lib/tasks/page-actor";
import { listForms } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Formulaires — NOD CRM",
};

export default async function FormsPage() {
  await connection();
  const actor = await getPageActor();
  return <FormsList forms={await listForms(actor)} />;
}
