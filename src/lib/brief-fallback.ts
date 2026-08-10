import type { AiBriefResult, BroadbandObservation, Prospect } from "@/lib/types";

/**
 * Category-specific sales context. `pressure` is what the network actually
 * carries, `breaks` is what a rep can describe out loud when it fails, and
 * `growth` is the forward-looking thread to listen for.
 */
type CategoryStakes = {
  pressure: string;
  breaks: string;
  growth: string;
};

const CATEGORY_STAKES: Record<string, CategoryStakes> = {
  "Medical & dental": {
    pressure: "cloud practice software, imaging uploads, VoIP phones, and patient Wi-Fi",
    breaks: "check-in stalls and the schedule stays behind for the rest of the day",
    growth: "added operatories, digital imaging, or a second location",
  },
  "Legal & accounting": {
    pressure: "secure cloud applications, large document transfers, and back-to-back video calls",
    breaks: "billable time gets spent watching a file crawl",
    growth: "filing-season crunches, remote staff, or off-site backup",
  },
  "Logistics & warehouse": {
    pressure: "dispatch, cloud inventory, handheld scanners, and camera uploads",
    breaks: "the trucks and the floor lose their instructions at the same moment",
    growth: "added bays, yard cameras, or a second facility",
  },
  "Property management": {
    pressure: "multi-site property systems, VoIP phones, and constant vendor coordination",
    breaks: "every property feels the same outage at once and the calls stack up",
    growth: "each new building added to the portfolio",
  },
  "Financial services": {
    pressure: "secure cloud platforms, video appointments, and phones that cannot ring busy",
    breaks: "customer confidence erodes faster than the outage lasts",
    growth: "added advisors, a branch, or compliance-driven redundancy",
  },
  "Education & childcare": {
    pressure: "staff systems, security cameras, and parent communication",
    breaks: "parents notice before staff finish troubleshooting",
    growth: "enrollment growth and a rising camera count",
  },
  Automotive: {
    pressure: "shop management software, payment processing, and parts ordering",
    breaks: "the bay and the counter stop at the same time",
    growth: "more lifts, more techs working off tablets",
  },
  "Hospitality & food": {
    pressure: "point-of-sale, online ordering, and guest Wi-Fi",
    breaks: "a rush turns into lost tickets and a room full of waiting people",
    growth: "delivery platforms, added seating, or a second location",
  },
  Retail: {
    pressure: "card payments, inventory systems, and guest Wi-Fi",
    breaks: "checkout stops and the line becomes the customer's memory of the store",
    growth: "seasonal peaks and added registers",
  },
  Construction: {
    pressure: "plan file uploads, cloud project tools, and field-to-office coordination",
    breaks: "the jobsite and the office drift out of sync on the same drawing",
    growth: "more concurrent jobs and more people needing the same files",
  },
  "Agriculture & equine": {
    pressure: "property-wide Wi-Fi, cameras, and booking or billing tools",
    breaks: "coverage gaps across the acreage turn into blind spots",
    growth: "more boarders, events, or monitored buildings",
  },
  "Community & faith": {
    pressure: "guest Wi-Fi, streaming and AV, cameras, and staff systems",
    breaks: "a stream drops in front of everyone watching from home",
    growth: "attendance growth, added services, or streamed events",
  },
  "Professional services": {
    pressure: "cloud applications, VoIP phones, and video meetings",
    breaks: "the whole office goes idle at the same moment",
    growth: "headcount and device count creeping up quietly",
  },
  "Other/Unknown": {
    pressure: "whatever connected systems the operation actually uses",
    breaks: "the call must establish the operational impact instead of guessing it",
    growth: "new staff, devices, software, or locations",
  },
};

export function categoryStakes(category: string): CategoryStakes {
  return CATEGORY_STAKES[category] ?? CATEGORY_STAKES["Other/Unknown"];
}

function publicSignalPhrase(prospect: Prospect) {
  const bits = [
    prospect.phone ? "a listed phone number" : null,
    prospect.website ? "a live website" : null,
    prospect.rating != null
      ? `a ${prospect.rating.toFixed(1)} public rating${prospect.reviewCount ? ` across ${prospect.reviewCount} reviews` : ""}`
      : null,
    prospect.locationCount && prospect.locationCount > 1 ? `${prospect.locationCount} listed locations` : null,
  ].filter(Boolean) as string[];
  if (!bits.length) return null;
  if (bits.length === 1) return bits[0];
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
}

/**
 * Deterministic, source-bounded brief used whenever profile generation is
 * unavailable. It stays in the same master-rep voice as the generated version
 * so the Research tab never degrades into a stub.
 */
export function buildFallbackBrief(prospect: Prospect, broadband: BroadbandObservation[]): AiBriefResult {
  void broadband;
  const stakes = categoryStakes(prospect.category);
  const category = prospect.category.toLowerCase();
  const signals = publicSignalPhrase(prospect);

  const statusSentence =
    prospect.operatingStatus === "Temporarily closed"
      ? "Public listings mark it temporarily closed, so confirm they are operating before you pitch anything."
      : prospect.operatingStatus === "Unknown"
        ? "Operating status is unclear in public listings, so confirm they are open in your first ten seconds."
        : "Listings show it open, which makes a direct daytime call reasonable.";

  const signalSentence = signals
    ? `Public data gives you ${signals} — enough to sound prepared, not enough to assume anything about how they run.`
    : "Public data on this one is thin, so plan to learn the operation on the call instead of pitching from desk research.";

  const summary = [
    `${prospect.name} is a ${category} approximately ${prospect.distanceMiles.toFixed(2)} miles from the searched address.`,
    signalSentence,
    statusSentence,
  ].join(" ");

  const reflectOn = [
    `Picture their busiest hour: if the connection dies then, ${stakes.breaks}.`,
    signals
      ? "Separate what you already know from public listings from what you still have to earn on the call."
      : "Accept that you are walking in with thin public data — your first job is listening, not framing.",
    "Remind yourself the FCC rows are availability only; you do not know their provider, their speed, or their bill.",
    "Decide the one outcome that makes this call worth their time — a short discovery conversation, not a quote.",
  ];

  const talkAbout = [
    `How ${stakes.pressure} holds up during their busiest stretch of the week.`,
    `What actually happens on the floor when things slow down — ${stakes.breaks}.`,
    "Who they call when something breaks, and how long a real fix usually takes.",
    `Whether ${stakes.growth} is anywhere on the table in the next year.`,
    "What business-class service should include for an operation this size: uptime, priority support, and terms worth re-reading.",
    "Availability at their address as public context — options to look at, never an assumption about what they pay now.",
  ];

  const discoveryQuestions = [
    ...prospect.discoveryQuestions,
    "Who feels it first when the connection slows — the front desk, the back office, or your customers?",
  ]
    .filter((question, index, all) => all.indexOf(question) === index)
    .slice(0, 4);

  return {
    summary,
    hypothesizedNeeds: prospect.hypothesizedNeeds.slice(0, 3),
    reflectOn,
    talkAbout,
    topOpportunity: prospect.topOpportunity,
    discoveryQuestions: discoveryQuestions.slice(0, 3),
    callOpener: prospect.callOpener,
    unsupportedClaimsToAvoid: [
      "Do not claim a current internet provider or contract status.",
      "Do not claim serviceability, pricing, speed, or installation timing.",
      "Do not present category-based operational possibilities as known facts.",
    ],
    followUpEmail: prospect.followUpEmail,
  };
}
