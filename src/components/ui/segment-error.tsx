"use client";

/**
 * Bloc d'erreur réutilisable pour les segments Next.js.
 *
 * Utilisé par les fichiers error.tsx locaux pour confiner l'erreur au segment
 * courant (sidebar et layout préservés).
 */
export function SegmentError({
  title,
  error,
  reset,
}: {
  /** Titre affiché (ex. « Le module Commerce n'a pas pu se charger »). */
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p aria-hidden className="text-3xl">
        ⚠️
      </p>
      <h1 className="mt-3 text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">
        Vérifie que PostgreSQL tourne et que les migrations sont appliquées
        (<code className="font-mono">npm run db:migrate</code>).
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted">Réf. {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-hover"
      >
        Réessayer
      </button>
    </div>
  );
}
