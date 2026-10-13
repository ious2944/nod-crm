import "server-only";

import { EventEmitter } from "node:events";

import { Client } from "pg";

import { prisma } from "@/lib/prisma";

/**
 * Synchronisation temps réel entre utilisateurs — PostgreSQL LISTEN/NOTIFY.
 *
 * C'est le mécanisme adapté à la pile : aucun service supplémentaire (Redis,
 * WebSocket dédié) n'est nécessaire, et il fonctionne avec plusieurs instances
 * Node derrière le même PostgreSQL.
 *
 * - Chaque mutation appelle `publishChange` : un `pg_notify` sur le canal
 *   `nod_work`, avec un message minimal (identifiants seulement — jamais de
 *   contenu : le client relit ce qui le concerne, permissions comprises).
 * - Chaque processus Node ouvre **une seule** connexion d'écoute, partagée
 *   par tous les flux SSE (`/api/tasks/stream`) qu'il sert.
 *
 * Isolation : le flux SSE ne relaie que les messages du workspace de la
 * session, et le client relit les données via les routes qui appliquent
 * `visibleTaskWhere`. Un message ne contient donc jamais rien d'exploitable.
 */

export const CHANNEL = "nod_work";

export interface ChangeMessage {
  w: string; // workspaceId
  a: string | null; // actorId
  t?: string[]; // taskIds
  p?: string[]; // projectIds
  u?: string[]; // userIds concernés (notifications)
  k: string; // kind
}

export async function publishChange(message: ChangeMessage): Promise<void> {
  const payload = JSON.stringify({
    ...message,
    t: message.t?.slice(0, 50),
    p: message.p?.slice(0, 20),
    u: message.u?.slice(0, 50),
  });
  // Limite PostgreSQL : 8 000 octets par charge utile.
  if (payload.length > 7_500) return;
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (error) {
    // Best-effort : la mutation a réussi, seul le rafraîchissement des autres
    // onglets est retardé (ils resynchronisent au retour du focus).
    console.error("[realtime] publication impossible", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
}

const globalForRealtime = globalThis as unknown as {
  nodRealtime?: { emitter: EventEmitter; client: Client | null; connecting: Promise<void> | null };
};

function state() {
  if (!globalForRealtime.nodRealtime) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalForRealtime.nodRealtime = { emitter, client: null, connecting: null };
  }
  return globalForRealtime.nodRealtime;
}

async function ensureListener(): Promise<void> {
  const current = state();
  if (current.client) return;
  if (current.connecting) return current.connecting;

  current.connecting = (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return;
    const client = new Client({ connectionString });
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as ChangeMessage;
        current.emitter.emit(parsed.w, parsed);
      } catch {
        // Message illisible : ignoré.
      }
    });
    const reset = () => {
      current.client = null;
      client.removeAllListeners();
      client.end().catch(() => {});
    };
    client.on("error", reset);
    client.on("end", () => {
      current.client = null;
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    current.client = client;
  })().finally(() => {
    current.connecting = null;
  });

  return current.connecting;
}

/** Abonne un flux à son workspace. Renvoie la fonction de désabonnement. */
export async function subscribe(
  workspaceId: string,
  listener: (message: ChangeMessage) => void,
): Promise<() => void> {
  await ensureListener();
  const { emitter } = state();
  emitter.on(workspaceId, listener);
  return () => emitter.off(workspaceId, listener);
}
