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
  // ni les variables d'environnement du serveur. Import conditionnel, comme le
  // recommande la documentation de Next : le code Node.js n'entre pas dans le
  // bundle Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
