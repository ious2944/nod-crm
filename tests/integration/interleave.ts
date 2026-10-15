import { setTestHook } from "@/lib/tasks/test-hooks";

/**
 * Entrelacement contrôlé de deux opérations.
 *
 * `first` est suspendue au point `pauseAt`. Pendant ce temps, `second`
 * démarre ; on attend qu'elle atteigne `probe` — ce qui prouve qu'elle n'est
 * pas bloquée — ou, au plus, `waitMs`. Puis `first` reprend.
 *
 * Avec une protection correcte, `second` reste bloquée derrière `first`
 * (`secondReachedProbe` vaut `false`) et s'exécute après elle.
 */
export async function interleave<A, B>(options: {
  pauseAt: string;
  probe: string;
  first: () => Promise<A>;
  second: () => Promise<B>;
  waitMs?: number;
}) {
  let paused = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reachedFirst!: () => void;
  const firstAtPause = new Promise<void>((resolve) => (reachedFirst = resolve));
  let reachedProbe!: () => void;
  const secondAtProbe = new Promise<void>((resolve) => (reachedProbe = resolve));
  let secondReachedProbe = false;
  let released = false;

  setTestHook(async (point) => {
    if (point === options.pauseAt && !paused) {
      paused = true;
      reachedFirst();
      await gate;
      return;
    }
    if (paused && !released && point === options.probe) {
      secondReachedProbe = true;
      reachedProbe();
    }
  });
  try {
    const a = options.first().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await Promise.race([firstAtPause, a]);
    if (!paused) throw new Error(`Le point « ${options.pauseAt} » n'a pas été atteint.`);
    const b = options.second().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await Promise.race([secondAtProbe, b, new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 600))]);
    released = true;
    release();
    const [first, second] = await Promise.all([a, b]);
    return { first, second, secondReachedProbe };
  } finally {
    release();
    setTestHook(null);
  }
}
