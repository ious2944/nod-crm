/**
 * Dépendances et ordonnancement — fonctions pures.
 *
 * - `wouldCreateCycle` : refuse une dépendance qui fermerait une boucle
 *   (A bloque B, B bloque C, C bloque A) ;
 * - `positionBetween` : position fractionnaire entre deux voisins, pour
 *   réordonner sans réécrire toute une section ;
 * - `dateConflicts` : incohérences de dates entre une tâche et ses bloqueurs.
 */

export interface DependencyEdge {
  blockingId: string;
  blockedId: string;
}

/**
 * Ajouter « `blockingId` bloque `blockedId` » crée-t-il un cycle ?
 * Oui si `blockedId` bloque déjà — directement ou transitivement — `blockingId`.
 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  blockingId: string,
  blockedId: string,
): boolean {
  if (blockingId === blockedId) return true;

  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.blockingId) ?? [];
    list.push(edge.blockedId);
    next.set(edge.blockingId, list);
  }

  // Parcours depuis `blockedId` en suivant « bloque » : atteindre `blockingId`
  // signifie qu'il dépend déjà de lui.
  const stack = [blockedId];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === blockingId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const target of next.get(current) ?? []) stack.push(target);
  }
  return false;
}

/** Écart de position par défaut entre deux éléments consécutifs. */
export const POSITION_STEP = 1024;

/**
 * Position à donner à un élément inséré entre `before` (au-dessus) et `after`
 * (en dessous). `null` aux extrémités. Renvoie `null` si l'écart est devenu
 * trop petit : l'appelant doit alors renuméroter la liste.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  const gap = after - before;
  if (!(gap > 1e-6)) return null;
  return before + gap / 2;
}

/** Positions régulières pour `count` éléments, dans l'ordre. */
export function evenPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_STEP);
}

export interface DatedTask {
  id: string;
  startDate: string | null;
  dueDate: string | null;
}

/**
 * Une tâche commence (ou se termine, faute de début) avant la fin d'un de ses
 * bloqueurs : signalé dans la chronologie, jamais corrigé en silence.
 */
export function dateConflicts(
  task: DatedTask,
  blockers: readonly DatedTask[],
): string[] {
  const begin = task.startDate ?? task.dueDate;
  if (!begin) return [];
  return blockers
    .filter((blocker) => blocker.dueDate !== null && blocker.dueDate > begin)
    .map((blocker) => blocker.id);
}

/** Écart en jours entre deux clés `YYYY-MM-DD` (`to - from`). */
export function keyDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Décalage proposé des tâches dépendantes quand une tâche se termine plus
 * tard : chaque successeur dont le début précède la nouvelle fin de son
 * bloqueur est repoussé d'autant (en cascade). N'est appliqué que si
 * l'utilisateur coche l'option explicite — jamais automatiquement.
 */
export function cascadeShift(
  tasks: ReadonlyMap<string, DatedTask>,
  edges: readonly DependencyEdge[],
  movedId: string,
): Map<string, { startDate: string | null; dueDate: string | null }> {
  const result = new Map<string, { startDate: string | null; dueDate: string | null }>();
  const current = (id: string) => result.get(id) ?? tasks.get(id) ?? null;

  const queue = [movedId];
  const guard = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (guard.has(id)) continue;
    guard.add(id);
    const blocker = current(id);
    if (!blocker?.dueDate) continue;

    for (const edge of edges.filter((e) => e.blockingId === id)) {
      const successor = current(edge.blockedId);
      if (!successor) continue;
      const begin = successor.startDate ?? successor.dueDate;
      if (!begin || begin > blocker.dueDate) continue;
      // Le successeur doit commencer le lendemain de la fin du bloqueur.
      const delta = keyDiff(begin, blocker.dueDate) + 1;
      const shift = (key: string | null) => (key ? addDaysKey(key, delta) : null);
      result.set(edge.blockedId, {
        startDate: shift(successor.startDate),
        dueDate: shift(successor.dueDate),
      });
      queue.push(edge.blockedId);
    }
  }
  result.delete(movedId);
  return result;
}

function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
