import { NextRequest } from "next/server";
import { bus } from "./events";

/**
 * Server-Sent Events helper (§22): binds bus channels to a ReadableStream
 * with a 15s keepalive comment. The client auto-falls-back to polling on
 * repeated errors (useSSE hook).
 */
export function sseStream(
  req: NextRequest,
  channels: string[],
  onOpen?: () => unknown | Promise<unknown>
): Response {
  const encoder = new TextEncoder();
  let cleanupFns: Array<() => void> = [];
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: { event: string; payload: string }) => {
        try {
          controller.enqueue(encoder.encode(`event: ${msg.event}\ndata: ${msg.payload}\n\n`));
        } catch {
          // stream already closed
        }
      };

      const initial = await onOpen?.();
      if (initial) send({ event: "snapshot", payload: JSON.stringify(initial) });

      const unsubs = channels.map((ch) => bus.subscribe(ch, send));
      cleanupFns = unsubs;

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // closed
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        cleanupFns.forEach((fn) => fn());
        if (keepalive) clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export { bus };
