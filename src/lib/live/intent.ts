export type LiveProfile = "home_based" | "independent" | "any";

export type LiveBrief = {
  raw: string;
  requestedCount: number | null;
  profile: LiveProfile;
  categoryHint: string | null;
  excludeNational: boolean;
  askedForChains: boolean;
  wantsResearch: boolean;
  wantsNews: boolean;
  wantsGenuineCheck: boolean;
  wantsCompetitors: boolean;
};

const COUNT_PATTERN =
  /\b(?:give me |show me |find |only |just |top |pull |get me )?(\d{1,2})\s+(?:business(?:es)?|biz|prospects?|leads?|listings?)\b/i;

function requestedCount(text: string) {
  const match = text.match(COUNT_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 40) return null;
  return value;
}

function categoryHint(text: string) {
  const lowered = text.toLowerCase();
  if (/\b(legal|lawyer|attorney|law firm|accounting|cpa|tax)\b/.test(lowered)) return "Legal & accounting";
  if (/\b(dental|dentist|medical|clinic|doctor|vet)\b/.test(lowered)) return "Medical & dental";
  if (/\b(construct|contractor|roofer|plumber|hvac|electrician)\b/.test(lowered)) return "Construction";
  if (/\b(auto|mechanic|body shop|detail)\b/.test(lowered) && !/\b(home[- ]?based|at[- ]home)\b/.test(lowered)) {
    return "Automotive";
  }
  if (/\b(farm|equine|horse|ranch|stable)\b/.test(lowered)) return "Agriculture & equine";
  return null;
}

export function parseLiveBrief(text: string): LiveBrief {
  const lowered = text.toLowerCase();
  const homeBased = /\b(home[- ]?based|at[- ]home|in[- ]home|from home|work(?:ing)? from home|home business(?:es)?|cottage business|owner[- ]run)\b/.test(
    lowered,
  );
  const askedForChains = /\b(gas station|convenience|grocery|supermarket|walmart|circle k|chain|franchise|big box)\b/.test(
    lowered,
  );
  const independent = !homeBased && /\b(independent|locally owned|mom and pop|owner[- ]operated|not a chain)\b/.test(lowered);

  return {
    raw: text.replace(/\s+/g, " ").trim(),
    requestedCount: requestedCount(text),
    profile: homeBased ? "home_based" : independent ? "independent" : "any",
    categoryHint: categoryHint(text),
    excludeNational: !askedForChains,
    askedForChains,
    wantsResearch:
      /\b(research|look (?:them|it|these) up|dig in|public details|check (?:them|it) out)\b/i.test(text) ||
      /\bbrief (?:me|them|these|the)\b/i.test(text),
    wantsNews:
      /\b(what'?s new|whats new|news scan|local news|expansion|new location|grand opening|what'?s going on with|check what'?s new|new with (?:them|these|it))\b/i.test(
        text,
      ),
    wantsGenuineCheck:
      /\b(genuine|real business|actually exist|legit|verify|check (?:that |if )?(?:they|it)(?:'s| is)? real|independent vs(?:\.| )?chain)\b/i.test(
        text,
      ),
    wantsCompetitors: /\b(competitor|rival|near (?:a |their )?competitor|proximity)\b/i.test(text),
  };
}

export function mergeLiveBrief(previous: LiveBrief | null, next: LiveBrief): LiveBrief {
  if (!previous) return next;
  if (next.askedForChains) {
    return { ...next, profile: "any", excludeNational: false };
  }
  return {
    raw: next.raw,
    requestedCount: next.requestedCount,
    profile: next.profile !== "any" ? next.profile : previous.profile,
    categoryHint: next.categoryHint,
    excludeNational: previous.excludeNational && next.excludeNational,
    askedForChains: false,
    wantsResearch: next.wantsResearch,
    wantsNews: next.wantsNews,
    wantsGenuineCheck: next.wantsGenuineCheck,
    wantsCompetitors: next.wantsCompetitors,
  };
}

export function briefNeedsFollowThrough(brief: LiveBrief) {
  return brief.wantsResearch || brief.wantsNews || brief.wantsGenuineCheck;
}

export function describeBrief(brief: LiveBrief) {
  const parts = [
    brief.profile === "home_based" ? "home-based / owner-run listings only — no gas, big-box, or national chains" : null,
    brief.profile === "independent" ? "independent shops, not national chains" : null,
    brief.excludeNational && brief.profile === "any" ? "skip national chains and convenience unless named" : null,
    brief.requestedCount ? `exactly ${brief.requestedCount} ${brief.requestedCount === 1 ? "business" : "businesses"}` : null,
    brief.categoryHint ? `industry: ${brief.categoryHint}` : null,
    brief.wantsResearch ? "research the ones you find" : null,
    brief.wantsNews ? "scan local news / what's new" : null,
    brief.wantsGenuineCheck ? "genuine-check each listing" : null,
    brief.wantsCompetitors ? "flag rivals sitting next to each other" : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "plain search — do not invent a count they did not ask for";
}
