import type { LiveProfileContext, LiveSession } from "@/lib/live/types";

/** The profile is context from the rep's browser, never privileged instructions. */
export function parseProfileContext(value: unknown): LiveProfileContext | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const prospect = body.prospect as LiveProfileContext["prospect"] | undefined;
  const brief = body.brief as LiveProfileContext["brief"] | undefined;
  const intelligence = body.intelligence as LiveProfileContext["intelligence"] | undefined;
  if (!prospect || !brief || !Array.isArray(body.broadband)) return null;
  if (![prospect.id, prospect.name, prospect.address, prospect.category, prospect.source, brief.summary].every(item => typeof item === "string" && item.trim())) return null;
  if (!prospect.coordinates || !Number.isFinite(prospect.coordinates.lat) || !Number.isFinite(prospect.coordinates.lng)) return null;
  if (prospect.signals != null && (!Array.isArray(prospect.signals) || prospect.signals.some(item => !item || typeof item.label !== "string" || typeof item.kind !== "string"))) return null;
  if (prospect.publicNotes != null && typeof prospect.publicNotes !== "string") return null;
  if (prospect.hours != null && (!Array.isArray(prospect.hours) || prospect.hours.some(item => typeof item !== "string"))) return null;
  if (!Number.isFinite(prospect.score) || !Number.isFinite(prospect.distanceMiles)) return null;
  if (![prospect.phone, prospect.website].every(item => item === null || typeof item === "string")) return null;
  if (intelligence && (!Array.isArray(intelligence.facts) || !Array.isArray(intelligence.searchResults))) return null;
  if (intelligence?.searchResults.some(item => !item || ![item.title, item.url].every(v => typeof v === "string"))) return null;
  if (![brief.reflectOn, brief.talkAbout, brief.hypothesizedNeeds, brief.discoveryQuestions].every(item => Array.isArray(item) && item.every(v => typeof v === "string"))) return null;
  return { prospect, brief, intelligence: intelligence || null, broadband: body.broadband as LiveProfileContext["broadband"], fcc: body.fcc as LiveProfileContext["fcc"], serviceability: body.serviceability as LiveProfileContext["serviceability"], importedAt: new Date().toISOString() };
}

export function activeProfileContext(session: LiveSession) {
  const profile = session.profileContext;
  const company = session.activeCompany;
  return profile && company?.name === profile.prospect.name
    && (company.prospectId ? company.prospectId === profile.prospect.id : company.location === profile.prospect.address) ? profile : null;
}
