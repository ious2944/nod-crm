/**
 * Erreurs métier du module Tâches.
 *
 * Elles vivent ici et non dans `actions.ts` : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones. Y exporter une classe fait perdre
 * *tous* ses exports au module.
 */

/**
 * Transition refusée : soit l'état de départ ne l'autorise pas (terminer une
 * tâche déjà terminée), soit la tâche a changé entre la lecture et l'écriture
 * (double clic, second onglet). Message neutre : aucun détail interne ne sort
 * d'ici.
 */
export class TaskConflictError extends Error {
  constructor() {
    super("Cette tâche a changé entre-temps. Rafraîchis la page.");
    this.name = "TaskConflictError";
  }
}
