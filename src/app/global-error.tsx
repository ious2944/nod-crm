"use client";

/**
 * Dernier filet : il ne se déclenche que si le layout racine lui-même échoue.
 * À ce stade, aucun style de l'application n'est disponible — il remplace le
 * document entier et doit donc porter ses propres balises `html` et `body`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "1rem",
          margin: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem" }}>NOD CRM est momentanément indisponible</h1>
          <p style={{ color: "#667085", fontSize: "0.875rem" }}>
            Le service n&apos;a pas pu démarrer. Réessaie dans un instant.
          </p>
          {error.digest && (
            <p style={{ color: "#98a2b3", fontSize: "0.75rem" }}>Référence : {error.digest}</p>
          )}
          <button type="button" onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
