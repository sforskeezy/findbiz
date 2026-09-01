import { runLiveTurn } from "@/lib/live/engine";
import type { LiveChatEvent } from "@/lib/live/types";

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

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  async function send(event: LiveChatEvent) {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  void (async () => {
    try {
      await runLiveTurn({ sessionId, message, onEvent: send });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Live could not finish that request.";
      try {
        await send({ type: "error", error: text });
      } catch {
        // Client gone.
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed.
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
