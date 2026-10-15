import { getCurrentUser } from "@/lib/auth/dal";
import { subscribe, type ChangeMessage } from "@/lib/tasks/realtime";
import { changeFor } from "@/lib/tasks/realtime-filter";

/**
 * Flux temps réel (Server-Sent Events) des changements de l'espace.
 *
 * Le message ne contient que des identifiants, **filtrés pour la personne
 * connectée** (`changeFor`) : jamais l'identifiant d'une tâche ou d'un projet
 * qu'elle ne peut pas voir. Le client relit ensuite ce qui le concerne via les
 * routes GET, qui appliquent les permissions.
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

      const actor = { id: user.id, workspaceId: user.workspaceId };
      const listener = (message: ChangeMessage) => {
        void changeFor(actor, message)
          .then((event) => {
            if (event) send("change", event);
          })
          .catch(() => {
            // Filtrage impossible (base indisponible) : rien n'est transmis ;
            // le client se resynchronise au retour du focus.
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
