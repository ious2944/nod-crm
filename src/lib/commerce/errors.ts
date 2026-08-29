/**
 * Erreurs métier du module Commerce.
 *
 * Elles vivent ici et non dans `actions.ts` : un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones. Y exporter une classe fait perdre
 * *tous* ses exports au module.
 */

/**
 * Transition de statut refusée — soit la machine à états n'autorise pas ce
 * chemin (ex. Gagnée → Proposition sans passer par un statut ouvert), soit
 * l'opportunité a changé entre la lecture et l'écriture. Message neutre.
 */
export class OpportunityConflictError extends Error {
  constructor() {
    super("Cette opportunité a changé entre-temps. Rafraîchis la page.");
    this.name = "OpportunityConflictError";
  }
}
