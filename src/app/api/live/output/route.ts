import { snapshotFromSession } from "@/lib/live/chat-output";
import { isLiveSessionId, loadMemory, loadSession } from "@/lib/live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId || !isLiveSessionId(sessionId)) {
    return Response.json({ error: "Invalid Live session." }, { status: 400 });
  }
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "That Live chat was not found." }, { status: 404 });
  return Response.json({ snapshot: snapshotFromSession(session, await loadMemory()) });
}
