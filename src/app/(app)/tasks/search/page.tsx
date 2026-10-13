import { connection } from "next/server";

import { SearchView } from "@/components/work/search-view";
import { getPageActor } from "@/lib/tasks/page-actor";
import { getSavedViews } from "@/lib/tasks/work-queries";

export const metadata = {
  title: "Recherche — NOD CRM",
};

export default async function SearchPage() {
  await connection();
  const actor = await getPageActor();
  return <SearchView savedViews={await getSavedViews(actor, "search")} />;
}
