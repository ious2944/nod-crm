/**
 * Points d'arrêt pour les tests d'entrelacement.
 *
 * Les tests de concurrence doivent prouver qu'une opération ne peut pas
 * s'intercaler entre le contrôle et l'écriture d'une autre. De simples appels
 * successifs ne le prouvent pas ; on suspend donc une opération à un point
 * précis (`checkpoint`) pendant qu'une seconde démarre.
 *
 * Hors des tests, aucun crochet n'est installé : `checkpoint` ne fait rien.
 */

type Hook = (point: string) => Promise<void> | void;

let hook: Hook | null = null;

/** Installe (ou retire, avec `null`) le crochet. Réservé aux tests. */
export function setTestHook(next: Hook | null): void {
  if (next && process.env.NODE_ENV !== "test") throw new Error("Crochet de test refusé hors des tests.");
  hook = next;
}

export async function checkpoint(point: string): Promise<void> {
  if (hook) await hook(point);
}
