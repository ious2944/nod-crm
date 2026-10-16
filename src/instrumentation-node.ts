/**
 * Partie Node.js de `instrumentation.ts` (contrôles de configuration au
 * démarrage, tâches planifiées). Importée uniquement quand
 * `NEXT_RUNTIME === "nodejs"` : le bundle Edge n'en contient rien.
 */
export async function registerNode(): Promise<void> {
  // Hors production, l'application démarre sans configuration : c'est ce qui
  // permet `npm run dev` sur un clone neuf.
  if (process.env.NODE_ENV !== "production") {
    await startJobs();
    return;
  }

  try {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error(
        "DATABASE_URL est absent. La stack Docker le construit à partir des " +
          "variables POSTGRES_* de votre .env.",
      );
    }

    // Import dynamique : le module charge `server-only` et n'a rien à faire
    // dans le graphe d'un autre runtime.
    const { getAuthSecret } = await import("@/lib/auth/secret");

    // Lève si le secret est absent, trop court, ou est une valeur d'exemple.
    // Le message porte la marche à suivre ; la valeur n'est jamais journalisée.
    getAuthSecret();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[config] démarrage refusé : ${detail}`);
    process.exit(1);
  }

  await startJobs();
}

/**
 * Tâches planifiées (rappels d'échéance), sans dépendre d'aucune requête :
 * voir `src/lib/tasks/scheduler.ts` et `docs/tasks.md`. Sans base configurée
 * (clone neuf en développement), il n'y a rien à planifier.
 */
async function startJobs(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  const { startScheduler } = await import("@/lib/tasks/scheduler");
  startScheduler();
}
