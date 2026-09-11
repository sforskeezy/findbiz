import { createSession, liveId, saveSession } from "@/lib/live/store";
import { parseProfileContext } from "@/lib/live/profile-context";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 250_000) return Response.json({ error: "This profile is too large to open in LIVE." }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(text); } catch { return Response.json({ error: "Invalid profile." }, { status: 400 }); }
  const profile = parseProfileContext(value);
  if (!profile) return Response.json({ error: "A completed business profile is required." }, { status: 400 });
  const session = await createSession();
  session.profileContext = profile;
  session.title = profile.prospect.name.slice(0, 100);
  session.queue = { locationLabel: profile.prospect.address, radiusMiles: 2, category: profile.prospect.category, currentIndex: 0, prospects: [profile.prospect] };
  session.activeCompany = {
    name: profile.prospect.name, location: profile.prospect.address, website: profile.prospect.website, prospectId: profile.prospect.id,
    findings: (profile.intelligence?.searchResults || []).map(item => ({ title: item.title, url: item.url, snippet: item.snippet || "" })),
  };
  session.messages.push({ id: liveId("msg"), role: "assistant", createdAt: new Date().toISOString(), content: `I have the full profile for **${profile.prospect.name}** here, including the AI assessment, public research, availability results, and outreach notes. What would you like to discuss?` });
  await saveSession(session);
  return Response.json({ sessionId: session.id });
}
