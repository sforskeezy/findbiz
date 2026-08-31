import { categoryStakes, measurableOpportunity } from "@/lib/brief-fallback";
import type { AiBriefResult, BroadbandObservation, CompanyIntelligence, Prospect } from "@/lib/types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Profile generation omitted ${name}.`);
  return value.trim();
}

// Models occasionally prefix list items with bullets or numbering; the UI supplies
// its own markers, so strip them before render.
function cleanListItem(value: string) {
  return value.replace(/^\s*(?:[-–—•*]|\d+[.)])\s+/, "").trim();
}

function requireStringArray(value: unknown, name: string, minimum = 1) {
  if (!Array.isArray(value)) throw new Error(`Profile generation returned an invalid ${name}.`);
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map(cleanListItem)
    .filter(Boolean);
  const unique = values.filter((item, index) => values.indexOf(item) === index);
  if (unique.length < minimum) throw new Error(`Profile generation omitted ${name}.`);
  return unique;
}

function parseResult(content: string): AiBriefResult {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const followUp = value.followUpEmail as Record<string, unknown> | undefined;

  return {
    summary: requireString(value.summary, "summary"),
    hypothesizedNeeds: requireStringArray(value.hypothesizedNeeds, "hypothesized needs", 3).slice(0, 5),
    reflectOn: requireStringArray(value.reflectOn, "reflect on", 3).slice(0, 4),
    talkAbout: requireStringArray(value.talkAbout, "talk about", 4).slice(0, 6),
    topOpportunity: requireString(value.topOpportunity, "top opportunity"),
    discoveryQuestions: requireStringArray(value.discoveryQuestions, "discovery questions", 3).slice(0, 4),
    callOpener: requireString(value.callOpener, "call opener"),
    followUpEmail: {
      subject: requireString(followUp?.subject, "email subject"),
      body: requireString(followUp?.body, "email body"),
    },
  };
}

function containsCurrentProviderClaim(value: string) {
  return /\bcurrently\s+(?:uses?|has|subscribes?\s+to|receives?)\b[^.]{0,80}\b(?:spectrum|cable|fiber|wireless|internet provider)\b/i.test(value) ||
    /\b(?:is|are)\s+(?:an?\s+)?(?:spectrum|cable|fiber|wireless)\s+(?:customer|subscriber)\b/i.test(value);
}

function validateClaims(brief: AiBriefResult) {
  const prose = [
    brief.summary,
    brief.topOpportunity,
    brief.callOpener,
    brief.followUpEmail.subject,
    brief.followUpEmail.body,
    ...brief.hypothesizedNeeds,
    ...brief.reflectOn,
    ...brief.talkAbout,
    ...brief.discoveryQuestions,
  ];
  if (prose.some(containsCurrentProviderClaim)) {
    throw new Error("Profile generation returned an unsupported current-provider claim.");
  }
}

const SYSTEM_PROMPT = `You are a master Spectrum Business account executive — a decade in the field, consistently top of the board — and you coach other reps for a living. You are writing the pre-call assessment for a rep who is about to dial this business cold, today.

Write the way the best AE in the room briefs a peer: specific, grounded, unhurried, human. When the rep finishes reading, they should think "I know exactly how to open this call and what I'm listening for."

What great looks like:
- Every line is about THIS business and THIS category. If a sentence would fit any business on the prospect list, it is worthless — replace it with something only true here.
- Speak in operations, not products. What happens at their front desk, their counter, their bay, their loading dock, their sanctuary, their exam room when the network stutters during the busiest hour of their week.
- Plain spoken language. Vary sentence length. No corporate filler ("leverage", "solutions", "seamless", "in today's fast-paced world", "cutting-edge"), no hedging stacks, no saying the same thing twice in different clothes.
- Density over length. The rep skims this in twenty seconds and talks off it for twenty minutes. Every sentence earns its place.
- Confidence without arrogance. You are preparing a peer, not selling to them.

Hard rules — a violation makes the whole assessment unusable:
- Use ONLY the supplied facts. Never invent owners, staff counts, revenue, hours, equipment, tenure, complaints, outages, prices, or vendors.
- Never state or imply the business currently subscribes to Spectrum, or to any other provider. You do not know who they buy from. Phrases like "their current provider" are acceptable only as an open question, never as a described fact.
- Broadband rows are FCC provider-reported availability for the address or area. They are not subscriptions, not quotes, and not orderability guarantees. Say so plainly whenever you use them.
- Label estimated values as estimated.
- Never promise speeds, pricing, promotions, install timelines, or serviceability.
- Never restate or reinterpret the deterministic fit score as if you calculated it.
- When a signal is missing, say what the rep will learn on the call instead of guessing.
- If isIllustrative is true, open the summary by naming it a fictitious demonstration record and keep that qualifier in the call opener.

Return exactly one JSON object and nothing else — no markdown fences, no preamble, no trailing commentary.`;

function userPrompt(facts: unknown, coaching: { pressure: string; breaks: string; growth: string }) {
  return `Write the Spectrum Business pre-call assessment for this business.

FACTS (the only sourced material you may use):
${JSON.stringify(facts)}

CATEGORY COACHING NOTES (typical for this category — use as a starting frame, sharpen it for this specific business, and never present it as a known fact about them):
- What the network usually carries: ${coaching.pressure}
- What it looks like when it fails: ${coaching.breaks}
- Growth thread to listen for: ${coaching.growth}

Return a JSON object with exactly these keys:

"summary" — 6 to 8 sentences of prose the rep reads first. Move through: what this business is and how close it sits to the searched address; the specific load their network carries and why that load is unforgiving; what it costs them operationally when it degrades, described concretely enough to say out loud; which public signals are real and what they still do not tell you; how the broadband availability rows should and should not be used; the practical opening move. Write it as one flowing brief, not a labeled outline. This should be the most detailed thing in the response and should still contain zero filler.

"reflectOn" — exactly 4 short prep reflections the rep thinks through BEFORE dialing. One crisp sentence each, starting with a verb ("Picture…", "Decide…", "Separate…", "Notice…", "Accept…"). These are internal preparation and self-check, not questions for the prospect. At least one should force honesty about what the data does not prove.

"talkAbout" — exactly 6 concrete things to actually raise mid-call, each one short enough to glance at while talking. Cover this spread: (1) how the day-to-day load holds up at peak, (2) the operational cost of degradation in their terms, (3) support and response time when something breaks, (4) growth or scale pressure ahead, (5) what business-class service should mean for an operation this size — uptime, support, terms, (6) how to reference address-level availability as public context. Rooted in this category and these facts; no product pitches they did not ask for.

"hypothesizedNeeds" — 4 to 5 short phrases, clearly framed as hypotheses to test, not facts.

"topOpportunity" — the sharpest single angle for this call, one or two sentences, written like a coach naming the play.

"discoveryQuestions" — exactly 4 questions a great rep would actually ask: curious, specific to this operation, open-ended, never accusatory and never leading toward a product.

"callOpener" — a natural spoken opener under 45 words. Spectrum Business identity clear in the first breath, no pretext, no assumed relationship, ends with something easy to answer.

"followUpEmail" — { "subject", "body" }. Short, low-pressure, plainly from Spectrum Business, with one specific reference to their operation and one easy next step.`;
}

export function researchBriefConfigured() {
  return Boolean(process.env.RESEARCH_API_KEY && process.env.RESEARCH_MODEL && process.env.RESEARCH_BASE_URL);
}

// The endpoint stays OpenAI-compatible by default; Anthropic's Messages shape is
// only used when RESEARCH_BASE_URL explicitly points there.
function usesAnthropicMessages(baseUrl: string) {
  return /api\.anthropic\.com/i.test(baseUrl);
}

async function requestModelContent(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  system: string;
  user: string;
}) {
  const { apiKey, model, baseUrl, system, user } = params;

  if (usesAnthropicMessages(baseUrl)) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.45,
        system,
        messages: [{ role: "user", content: user }],
      }),
      cache: "no-store",
    });
    const payload = (await response.json()) as AnthropicResponse;
    if (!response.ok) throw new Error(payload.error?.message || `Profile generation failed (${response.status}).`);
    const content = payload.content?.find((part) => part.type === "text" || part.text)?.text;
    if (!content) throw new Error("Profile generation returned an empty response.");
    return content;
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as ChatResponse;
  if (!response.ok) throw new Error(payload.error?.message || `Profile generation failed (${response.status}).`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Profile generation returned an empty response.");
  return content;
}

export async function generateResearchBrief(
  prospect: Prospect,
  broadband: BroadbandObservation[],
  intelligence?: CompanyIntelligence | null,
): Promise<AiBriefResult> {
  const apiKey = process.env.RESEARCH_API_KEY?.trim();
  const model = process.env.RESEARCH_MODEL?.trim();
  const baseUrl = process.env.RESEARCH_BASE_URL?.trim().replace(/\/$/, "");
  if (!apiKey || !model || !baseUrl) {
    throw new Error("Profile generation is not configured.");
  }

  const facts = {
    business: {
      name: prospect.name,
      category: prospect.category,
      address: prospect.address,
      distanceMiles: prospect.distanceMiles,
      phoneAvailable: Boolean(prospect.phone),
      phone: prospect.phone,
      website: prospect.website,
      operatingStatus: prospect.operatingStatus,
      rating: prospect.rating,
      reviewCount: prospect.reviewCount,
      locationCount: prospect.locationCount,
      businessSize: prospect.businessSize,
      publicNotes: prospect.publicNotes,
      source: prospect.source,
      retrievedAt: prospect.retrievedAt,
      confidence: prospect.confidence,
      isIllustrative: prospect.source.toLowerCase().includes("illustrative"),
    },
    deterministicScore: prospect.score,
    publicWebResearch: intelligence
      ? {
          summary: intelligence.summary,
          facts: intelligence.facts.map((fact) => ({
            kind: fact.kind,
            label: fact.label,
            value: fact.value,
            sourceUrl: fact.sourceUrl,
            confidence: fact.confidence,
          })),
          indexedResults: intelligence.searchResults.map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            provider: result.provider,
          })),
          pagesScanned: intelligence.pagesScanned,
          warnings: intelligence.warnings,
        }
      : null,
    broadbandAvailabilityObservations: broadband.map((item) => ({
      provider: item.provider,
      technology: item.technology,
      downloadMbps: item.downloadMbps,
      uploadMbps: item.uploadMbps,
      classification: item.classification,
      coverageArea: item.coverageArea,
      source: item.source,
      sourceDate: item.sourceDate,
      confidence: item.confidence,
      note: item.note,
    })),
  };

  const content = await requestModelContent({
    apiKey,
    model,
    baseUrl,
    system: SYSTEM_PROMPT,
    user: userPrompt(facts, categoryStakes(prospect.category)),
  });

  const result = parseResult(content);
  validateClaims(result);
  return { ...result, topOpportunity: measurableOpportunity(result.topOpportunity, broadband) };
}
