"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login } from "@/app/login/actions";
import { initialLoginState } from "@/lib/auth/schemas";

const FIELD =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-muted";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "Connexion…" : "Se connecter"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialLoginState);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className={LABEL} htmlFor="email">
          Adresse email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          autoFocus
          className={`mt-1 ${FIELD}`}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className={`mt-1 ${FIELD}`}
        />
      </div>

      {state.status === "error" && state.message && (
        <p
          role="alert"
          className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical-fg"
        >
          {state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
