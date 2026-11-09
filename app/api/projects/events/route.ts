import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse } from "@/lib/session/http";

/** Server-sent events for import phases, dev-server output and save notifications. */
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
  } catch (error) {
    return errorResponse(error);
  }
  const session = currentSession();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };
      send({ type: "hello", snapshot: session ? session.snapshot() : null });
      if (!session) {
        controller.close();
        return;
      }
      const onEvent = (event: unknown) => send(event);
      session.events.on("event", onEvent);
      const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
      const stop = () => {
        clearInterval(heartbeat);
        session.events.off("event", onEvent);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", stop);
      session.events.once("event", (e: { type: string }) => {
        if (e.type === "closed") stop();
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
