"use client";

/**
 * Filet d'erreur du segment racine.
 *
 * Il rattrape les erreurs levées par les layouts enfants — notamment
 * `(app)/layout.tsx`, qui lit la session et touche donc la base. Un `error.tsx`
 * ne rattrape jamais les erreurs de son *propre* layout : sans ce fichier, une
 * base indisponible faisait tomber l'utilisateur sur l'écran par défaut de
 * Next, en anglais, dans une application entièrement en français.
 *
 * Aucun détail technique n'est affiché : `digest` est un identifiant opaque
 * qui permet de retrouver la trace côté serveur, rien de plus.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <p aria-hidden className="text-3xl">
        ⚠️
      </p>
      <h1 className="mt-3 text-lg font-semibold">NOD CRM est momentanément indisponible</h1>
      <p className="mt-2 text-sm text-muted">
        Le service n&apos;a pas pu répondre. C&apos;est probablement passager : réessaie dans un
        instant. Si le problème persiste, vérifie que la base de données est bien démarrée.
      </p>
      {error.digest && <p className="mt-3 text-xs text-muted">Référence : {error.digest}</p>}
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
