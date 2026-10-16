import { notFound } from "next/navigation";
import { connection } from "next/server";

import { FormFill } from "@/components/work/forms-settings";
import { TaskAccessError } from "@/lib/tasks/access";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getForm } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Formulaire — NOD CRM",
};

/** Formulaire interne : réservé aux membres de l'espace qui peuvent voir le projet. */
export default async function FormPage({ params }: PageProps<"/tasks/forms/[id]">) {
  await connection();
  const actor = await getPageActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let form;
  try {
    form = await getForm(actor, id);
  } catch (error) {
    if (error instanceof TaskAccessError) notFound();
    throw error;
  }
  return <FormFill form={form} />;
}
