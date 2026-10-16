/**
 * Processus de test : exécute la vraie tâche planifiée `runTaskReminders`
 * dans un processus Node distinct, pour pouvoir l'arrêter brutalement
 * (SIGKILL) ou le suspendre (SIGSTOP) pendant qu'il détient le bail.
 *
 *   node --conditions=react-server --import tsx tests/scheduler/reminder-worker.mts \
 *     --ttl 3000 --delay 300 [--crash-after-notify 0] [--pause-after-deliver 1]
 *
 * Journal sur stdout, une ligne par événement : `deliver i`, `delivered i`,
 * puis `report {json}`. Utilisé uniquement par
 * `tests/integration/scheduler-recovery.test.ts`.
 */
import { runTaskReminders } from "@/lib/tasks/task-reminders";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ttl = Number(arg("ttl") ?? 3000);
const delay = Number(arg("delay") ?? 0);
const crashAfter = arg("crash-after-notify");
const pauseAfter = arg("pause-after-deliver");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const report = await runTaskReminders({
  holder: `worker:${process.pid}`,
  leaseTtlMs: ttl,
  hooks: {
    beforeDeliver: async (i) => {
      if (delay) await sleep(delay);
      console.log(`deliver ${i}`);
    },
    afterDeliver: async (i) => {
      console.log(`delivered ${i}`);
      // Point d'arrêt hors de toute transaction, pour une suspension (SIGSTOP) déterministe.
      if (pauseAfter !== undefined && Number(pauseAfter) === i) {
        console.log(`paused ${i}`);
        await sleep(1500);
      }
      // Arrêt brutal après la création de la notification, avant la validation.
      if (crashAfter !== undefined && Number(crashAfter) === i) process.kill(process.pid, "SIGKILL");
    },
  },
});
console.log(`report ${JSON.stringify(report)}`);
process.exit(0);
