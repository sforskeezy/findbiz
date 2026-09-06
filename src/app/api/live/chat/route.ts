import { runLiveTurn } from "@/lib/live/engine";
import type { LiveChatEvent } from "@/lib/live/types";
import { isLiveSessionId } from "@/lib/live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const message =
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message
      : "";
  const sessionId =
    typeof body === "object" && body !== null && "sessionId" in body && typeof body.sessionId === "string"
      ? body.sessionId
      : null;

  if (message.trim().length < 1) {
    return Response.json({ error: "Type a message for Live." }, { status: 400 });
  }
  if (message.length > 2_000) {
    return Response.json({ error: "Keep your message under 2,000 characters." }, { status: 400 });
  }
  if (sessionId && !isLiveSessionId(sessionId)) {
    return Response.json({ error: "Invalid Live session." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(110_000)]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LiveChatEvent) => {
        signal.throwIfAborted();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runLiveTurn({ sessionId, message, signal, onEvent: send });
      } catch (error) {
        if (!cancellation.signal.aborted && !request.signal.aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: signal.aborted ? "That took too long. Try your message again." : error instanceof Error ? error.message : "Live could not finish that request.",
          })}\n\n`));
        }
      } finally {
        if (!cancellation.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancellation.abort();
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
