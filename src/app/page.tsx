import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

// Follow-up est le seul module de la V0.1 : c'est la page d'accueil du CRM,
// pour peu qu'une session valide existe.
export default async function Home() {
  redirect((await getCurrentUser()) ? "/follow-ups" : "/login");
}
