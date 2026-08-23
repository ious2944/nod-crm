/**
 * Contrôles de configuration au démarrage du serveur.
 *
 * `register()` est appelé une fois par instance Next, et doit se terminer avant
 * que le serveur n'accepte la moindre requête.
 *
 * Pourquoi ici et pas seulement à l'usage : `getAuthSecret()` n'est appelé que
 * lorsqu'un jeton de session doit être haché, et `DATABASE_URL` qu'à la
 * première requête. Une instance lancée avec un secret d'exemple servait donc
 * parfaitement la page de connexion et n'échouait qu'à la première tentative de
 * connexion — par une erreur 500, c'est-à-dire au pire moment et sous la forme
 * la moins lisible. Un défaut de configuration doit se voir au démarrage.
 *
 * En cas d'échec, on sort en code 1 plutôt que de laisser remonter l'exception.
 * Next journalise bien l'erreur, mais le processus reste vivant : le conteneur
 * apparaît « en cours d'exécution » alors qu'il ne répond à rien. Un processus
 * qui s'arrête est diagnostiqué en une commande — `docker compose logs` montre
 * la ligne, et le redémarrage en boucle dit franchement que rien ne va.
 */
export async function register(): Promise<void> {
  // `register` s'exécute aussi dans le runtime Edge, qui n'a ni `node:crypto`
  // ni les variables d'environnement du serveur. On ne contrôle que Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Hors production, l'application démarre sans configuration : c'est ce qui
  // permet `npm run dev` sur un clone neuf.
  if (process.env.NODE_ENV !== "production") return;

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
}
