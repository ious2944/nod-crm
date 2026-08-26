import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/dal";
import { APP_NAME, MODULE_NAME } from "@/lib/config";

export const metadata = {
  title: `Connexion — ${APP_NAME}`,
};

export default async function LoginPage() {
  // Déjà connecté : inutile de proposer l'écran de connexion.
  if (await getCurrentUser()) {
    redirect("/today");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-contrast"
          >
            {APP_NAME.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight">{APP_NAME}</span>
            <span className="text-xs text-muted">{MODULE_NAME}</span>
          </span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
        <p className="mt-1 text-sm text-muted">Accède à tes suivis.</p>

        <LoginForm />
      </div>
    </div>
  );
}
