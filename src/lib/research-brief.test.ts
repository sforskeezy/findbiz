import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefRequest } from "@/lib/brief-schema";
import { generateResearchBrief } from "@/lib/research-brief";

const input: BriefRequest = {
  business: {
    name: "Green Valley Dental",
    category: "Medical & dental",
    distanceMiles: 0.4,
    operatingStatus: "Open",
    phoneAvailable: true,
    websiteAvailable: true,
    publicFactDates: ["2026-08-01"],
    confidence: "Medium",
    evidenceCompleteness: 80,
  },
  broadband: [],
};

function response(summary: string) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({
    summary,
    hypothesizedNeeds: ["Hypothesis: Connected operations", "Hypothesis: Payment tools", "Hypothesis: Security cameras"],
    reflectOn: ["Confirm the operating context."],
    talkAbout: ["Ask how connected tools support the day."],
    topOpportunity: "Use a short discovery conversation to learn the operation.",
    discoveryQuestions: ["What tools matter most?", "What happens during an outage?", "What would you improve?"],
    callOpener: "Hi, this is [Name] with [Company]. Could I ask how connectivity supports your day?",
    unsupportedClaimsToAvoid: ["Current provider", "Current speed", "Guaranteed availability"],
    followUpEmail: { subject: "A quick connectivity question", body: "Hi — would a brief conversation next week be convenient?" },
  }) } }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEARCH_API_KEY;
  delete process.env.RESEARCH_MODEL;
  delete process.env.RESEARCH_BASE_URL;
});

describe("research brief safety", () => {
  it.each([
    "Green Valley Dental is nearby. Its identity comes from OpenStreetMap contributors, and it may be worth a short call.",
    "Green Valley Dental currently uses Fixture Broadband and is serviceable, so it may be worth a short sales call.",
    "Green Valley Dental has guaranteed 1 Gbps service for a low price, so the rep should lead with that offer.",
  ])("rejects unsupported or provider-source sales copy", async (summary) => {
    process.env.RESEARCH_API_KEY = "test";
    process.env.RESEARCH_MODEL = "fixture";
    process.env.RESEARCH_BASE_URL = "https://brief.example";
    vi.stubGlobal("fetch", vi.fn(async () => response(summary)));
    await expect(generateResearchBrief(input)).rejects.toThrow();
  });
});
