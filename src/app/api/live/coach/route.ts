import { publicState } from "@/lib/live/engine";
import { liveId, loadMemory, loadSession, saveSession, isLiveSessionId } from "@/lib/live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const sessionId =
    typeof body === "object" && body !== null && "sessionId" in body && typeof body.sessionId === "string"
      ? body.sessionId
      : "";
  const summary =
    typeof body === "object" && body !== null && "summary" in body && typeof body.summary === "string"
      ? body.summary.trim()
      : "";

  if (!isLiveSessionId(sessionId)) {
    return Response.json({ error: "Invalid Live session." }, { status: 400 });
  }
  if (summary.length < 1 || summary.length > 4_000) {
    return Response.json({ error: "Call notes were empty or too long." }, { status: 400 });
  }

  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "That Live chat was not found." }, { status: 404 });

  session.messages = [
    ...session.messages,
    {
      id: liveId("msg"),
      role: "assistant" as const,
      content: summary,
      createdAt: new Date().toISOString(),
    },
  ].slice(-40);
  await saveSession(session);
  return Response.json({ state: publicState(session, await loadMemory()) });
}
