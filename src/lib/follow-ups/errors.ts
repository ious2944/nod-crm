/**
 * Erreurs métier du module Follow-up.
 *
 * Elles vivent ici et non dans `actions.ts` : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones. Y exporter une classe fait perdre
 * *tous* ses exports au module, et l'application casse au premier import côté
 * client. Le build le détecte, mais autant ne pas reposer sur ce filet.
 */

/**
 * Transition refusée : soit l'état de départ ne l'autorise pas, soit le suivi
 * a changé entre la lecture et l'écriture (double clic, second onglet).
 * Message volontairement neutre : aucun détail interne ne sort d'ici.
 */
export class FollowUpConflictError extends Error {
  constructor() {
    super("Ce suivi a changé entre-temps. Rafraîchis la page.");
    this.name = "FollowUpConflictError";
  }
}
