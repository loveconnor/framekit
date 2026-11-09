import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse } from "@/lib/session/http";
import { editorOpened } from "@/lib/hosted/config";

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
      // An open stream is an open editor: hosted mode keeps the sandbox running while any exist.
      const release = editorOpened();
      const onEvent = (event: unknown) => {
        send(event);
        if ((event as { type?: string }).type === "closed") stop();
      };
      session.events.on("event", onEvent);
      const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
      const stop = () => {
        release();
        clearInterval(heartbeat);
        session.events.off("event", onEvent);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", stop);
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
