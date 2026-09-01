import { forgetFact, loadMemory } from "@/lib/live/store";
import { createSession, deleteSession, listSessions, loadSession } from "@/lib/live/store";
import { publicState } from "@/lib/live/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (sessionId) {
    const session = await loadSession(sessionId);
    if (!session) return Response.json({ error: "That Live chat was not found." }, { status: 404 });
    return Response.json({ state: publicState(session, await loadMemory()) });
  }
  return Response.json({
    sessions: await listSessions(),
    memory: await loadMemory(),
  });
}

export async function POST() {
  const session = await createSession();
  return Response.json({ state: publicState(session, await loadMemory()) });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim();
  const memoryId = url.searchParams.get("memoryId")?.trim();
  if (memoryId) {
    return Response.json({ memory: await forgetFact(memoryId) });
  }
  if (!sessionId) return Response.json({ error: "Missing session." }, { status: 400 });
  await deleteSession(sessionId);
  return Response.json({ ok: true });
}
