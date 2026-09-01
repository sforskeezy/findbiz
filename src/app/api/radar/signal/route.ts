import { applySignalAction } from "@/lib/radar/store";
import type { RadarSignalAction } from "@/lib/radar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actions = new Set<RadarSignalAction>(["save", "unsave", "dismiss", "restore", "contacted", "uncontacted"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const scanId = typeof body === "object" && body !== null && "scanId" in body && typeof body.scanId === "string" ? body.scanId : "";
  const signalId =
    typeof body === "object" && body !== null && "signalId" in body && typeof body.signalId === "string" ? body.signalId : "";
  const action =
    typeof body === "object" && body !== null && "action" in body && typeof body.action === "string" ? body.action : "";

  if (!scanId || !signalId || !actions.has(action as RadarSignalAction)) {
    return Response.json({ error: "A valid scan, signal, and action are required." }, { status: 400 });
  }

  try {
    const signal = await applySignalAction(scanId, signalId, action as RadarSignalAction);
    return Response.json({ signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal update failed.";
    return Response.json({ error: message }, { status: 404 });
  }
}
