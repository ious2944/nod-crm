import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/dal";
import { APP_NAME, MODULE_NAME } from "@/lib/config";

export const metadata = {
  title: `Connexion — ${APP_NAME}`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ logged_out?: string }>;
}) {
  if (await getCurrentUser()) {
    redirect("/today");
  }

  const params = await searchParams;
  const loggedOut = params.logged_out === "1";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Identité */}
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-contrast shadow-sm"
          >
            {APP_NAME.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight text-ink">{APP_NAME}</span>
            <span className="text-xs text-muted">{MODULE_NAME}</span>
          </span>
        </div>

        {/* Confirmation de déconnexion */}
        {loggedOut && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-sm text-muted"
          >
            Vous avez été déconnecté.
          </p>
        )}

        {/* Accroche */}
        <h1 className="text-2xl font-bold tracking-tight text-ink">Connexion</h1>
        <p className="mt-1 text-sm text-muted">Accède à tes suivis et tâches.</p>

        {/* Formulaire */}
        <div className="mt-8 rounded-xl border border-border-subtle bg-surface p-6 shadow-card">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
