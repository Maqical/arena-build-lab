import { getGameStateMonitor, type GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function eventChunk(snapshot: GameStateSnapshot): Uint8Array {
  return new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

export async function GET(request: Request) {
  const monitor = getGameStateMonitor();
  const url = new URL(request.url);
  if (url.searchParams.get("once") === "1") {
    let snapshot = monitor.snapshot();
    if (snapshot.sequence === 0) {
      snapshot = await new Promise<GameStateSnapshot>((resolve) => {
        const finish = (next: GameStateSnapshot) => {
          clearTimeout(timeout);
          monitor.off("change", finish);
          resolve(next);
        };
        const timeout = setTimeout(() => finish(monitor.snapshot()), 2_500);
        monitor.once("change", finish);
      });
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  }

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (snapshot: GameStateSnapshot) => {
        if (!closed) controller.enqueue(eventChunk(snapshot));
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        monitor.off("change", send);
        try { controller.close(); } catch { /* Client already disconnected. */ }
      };
      cleanup = close;
      monitor.on("change", send);
      send(monitor.snapshot());
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() { cleanup(); },
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
