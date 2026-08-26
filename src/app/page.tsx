import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

// Depuis la V0.3, l'accueil d'une session ouverte est le cockpit « Aujourd'hui » :
// on entre dans le CRM par ce qu'il y a à faire, pas par une liste.
export default async function Home() {
  redirect((await getCurrentUser()) ? "/today" : "/login");
}
