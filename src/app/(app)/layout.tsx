import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/dal";
import { APP_NAME, APP_SOURCE_URL } from "@/lib/config";

/**
 * Coquille des pages authentifiées.
 *
 * La vérification est faite ici *et* dans chaque page/action : un layout ne
 * protège pas une route à lui seul (une page enfant peut être rendue sans que
 * son layout parent ne bloque le flux). C'est une commodité pour l'affichage,
 * pas la frontière d'autorisation.
 */
export default async function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <AppShell
      appName={APP_NAME}
      sourceUrl={APP_SOURCE_URL}
      userLabel={user.displayName || user.email}
      workspaceName={user.workspaceName}
    >
      {children}
    </AppShell>
  );
}
