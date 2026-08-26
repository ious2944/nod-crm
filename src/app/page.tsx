import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

// Le cockpit « Aujourd'hui » est la page d'accueil du CRM depuis la V0.4 :
// c'est lui qui répond à « qu'est-ce que j'ai à faire maintenant ? », suivis et
// tâches confondus.
export default async function Home() {
  redirect((await getCurrentUser()) ? "/today" : "/login");
}
