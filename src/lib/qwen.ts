import type { AiBriefResult, BroadbandObservation, Prospect } from "@/lib/types";

type QwenChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Qwen omitted ${name}.`);
  return value.trim();
}

function requireStringArray(value: unknown, name: string, minimum = 1) {
  if (!Array.isArray(value)) throw new Error(`Qwen returned an invalid ${name}.`);
  const values = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (values.length < minimum) throw new Error(`Qwen omitted ${name}.`);
  return values.map((item) => item.trim());
}

function parseResult(content: string): AiBriefResult {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const followUp = value.followUpEmail as Record<string, unknown> | undefined;

  return {
    summary: requireString(value.summary, "summary"),
    hypothesizedNeeds: requireStringArray(value.hypothesizedNeeds, "hypothesized needs"),
    topOpportunity: requireString(value.topOpportunity, "top opportunity"),
    discoveryQuestions: requireStringArray(value.discoveryQuestions, "discovery questions", 3).slice(0, 3),
    callOpener: requireString(value.callOpener, "call opener"),
    followUpEmail: {
      subject: requireString(followUp?.subject, "email subject"),
      body: requireString(followUp?.body, "email body"),
    },
  };
}

function speedLabel(observation: BroadbandObservation) {
  const parts = [
    observation.downloadMbps !== null ? `${observation.downloadMbps.toLocaleString()} Mbps down` : null,
    observation.uploadMbps !== null ? `${observation.uploadMbps.toLocaleString()} Mbps up` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}

// Availability rows are the only sourced numbers in the brief, so the angle is built
// deterministically here rather than left to the model.
function measurableOpportunity(fallbackOpportunity: string, broadband: BroadbandObservation[]) {
  const spectrum = broadband.find((item) => item.provider.toLowerCase().includes("spectrum"));
  if (!spectrum) return fallbackOpportunity;

  const speeds = speedLabel(spectrum);
  if (!speeds) {
    return "FCC records list Spectrum as available at this location, but without usable speed figures. Confirm the exact address, then win the conversation on reliability, support, and contract terms instead of a speed number.";
  }

  const qualifier = spectrum.confidence === "Verified" ? "" : " (estimated)";
  const lead = `FCC records list Spectrum as available here at ${speeds}${qualifier}`;
  const alternatives = broadband.filter((item) => item.id !== spectrum.id);
  const strongestDownload = alternatives
    .filter((item) => item.downloadMbps !== null)
    .sort((a, b) => (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0))[0];
  const strongestUpload = alternatives
    .filter((item) => item.uploadMbps !== null)
    .sort((a, b) => (b.uploadMbps ?? 0) - (a.uploadMbps ?? 0))[0];

  if (
    spectrum.uploadMbps !== null &&
    strongestUpload?.uploadMbps != null &&
    strongestUpload.uploadMbps > spectrum.uploadMbps
  ) {
    return `${lead}, while ${strongestUpload.provider} reports a higher ${strongestUpload.uploadMbps.toLocaleString()} Mbps upload. Avoid leading on upload — make it about download headroom, uptime, support, and terms, and verify the exact address.`;
  }

  if (
    spectrum.downloadMbps !== null &&
    strongestDownload?.downloadMbps != null &&
    spectrum.downloadMbps > strongestDownload.downloadMbps
  ) {
    return `${lead}, above the ${strongestDownload.downloadMbps.toLocaleString()} Mbps download reported by ${strongestDownload.provider}. Verify the exact address, then find out whether that extra headroom actually changes their day.`;
  }

  return `${lead}, with no clear speed edge over the other reported providers. Verify the exact address and make the case on reliability, support, and contract terms.`;
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
    ...brief.discoveryQuestions,
  ];
  if (prose.some(containsCurrentProviderClaim)) {
    throw new Error("Qwen returned an unsupported current-provider claim.");
  }
}

export function qwenConfigured() {
  return Boolean(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY);
}

export async function generateWithQwen(
  prospect: Prospect,
  broadband: BroadbandObservation[],
): Promise<AiBriefResult> {
  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("Qwen is not configured.");

  const baseUrl = (process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const model = process.env.QWEN_MODEL || "qwen3.5-flash";
  const facts = {
    business: {
      name: prospect.name,
      category: prospect.category,
      address: prospect.address,
      distanceMiles: prospect.distanceMiles,
      phoneAvailable: Boolean(prospect.phone),
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      enable_thinking: false,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a Spectrum Business sales coach writing a 10-second skim assessment for a field rep selling business internet and connectivity. Voice: direct, confident, useful — like a sharp sales brief, not a research essay or CRM blurb. Use only supplied public facts. Never invent missing facts. Never claim the business currently uses Spectrum or any provider. Broadband rows are availability observations only (not subscriptions or orderability guarantees). Call estimated values estimated. If the record is illustrative/fictitious, say so first. Do not modify the deterministic score. Return JSON only.",
        },
        {
          role: "user",
          content: `Write a Spectrum Business sales brief from these facts: ${JSON.stringify(facts)}.

Return exactly these keys:
- summary: 3-5 short sentences a rep can skim fast. Cover (1) what this business is and why it matters for a connectivity sale, (2) the category-specific network pressure (POS, phones, cloud apps, cameras, uploads, etc.) grounded only in the category/public signals, (3) what public signals help the call (phone/website/rating/status if present), and (4) how to use any broadband availability observations without claiming current service. End with the practical next move for the rep.
- hypothesizedNeeds: 3-5 short hypothesis phrases for discovery (not facts)
- topOpportunity: one crisp sales angle / opener frame for this call
- discoveryQuestions: exactly 3 natural questions a Spectrum Business rep would ask
- callOpener: natural phone opener; no deception; Spectrum Business identity clear
- followUpEmail: { subject, body } short and low-pressure

If isIllustrative is true, begin summary by saying this is a fictitious demonstration record and keep that qualifier in the call opener.`,
        },
      ],
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as QwenChatResponse;
  if (!response.ok) throw new Error(payload.error?.message || `Qwen request failed (${response.status}).`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen returned an empty response.");

  const result = parseResult(content);
  validateClaims(result);
  return { ...result, topOpportunity: measurableOpportunity(result.topOpportunity, broadband) };
}
