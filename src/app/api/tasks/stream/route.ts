import { getCurrentUser } from "@/lib/auth/dal";
import { subscribe, type ChangeMessage } from "@/lib/tasks/realtime";

/**
 * Flux temps réel (Server-Sent Events) des changements de l'espace.
 *
 * Le message ne contient que des identifiants : le client relit ce qui le
 * concerne via les routes GET, qui appliquent les permissions. Les
 * identifiants de notifications sont filtrés pour ne viser que l'utilisateur
 * connecté.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup?.();
        }
      };
      send("ready", { ok: true });

      const listener = (message: ChangeMessage) => {
        send("change", {
          kind: message.k,
          actorId: message.a,
          taskIds: message.t ?? [],
          projectIds: message.p ?? [],
          forMe: (message.u ?? []).includes(user.id),
        });
      };
      let unsubscribe: () => void = () => {};
      try {
        unsubscribe = await subscribe(user.workspaceId, listener);
      } catch {
        send("unavailable", {});
      }
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup?.();
        }
      }, 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // déjà fermé
        }
        cleanup = null;
      };
      request.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
