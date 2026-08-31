import { describeScore, scoreProspect } from "@/lib/scoring";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

type DemoSeed = {
  id: string;
  name: string;
  category: string;
  distanceMiles: number;
  bearing: number;
  rating: number;
  reviewCount: number;
  size: string;
  locationCount: number;
  needs: string[];
};

const center: Coordinates = { lat: 35.2271, lng: -80.8431 };

const seeds: DemoSeed[] = [
  {
    id: "demo-northline",
    name: "Northline Logistics",
    category: "Logistics & warehouse",
    distanceMiles: 0.07,
    bearing: 24,
    rating: 4.7,
    reviewCount: 128,
    size: "Estimated 20–49 employees",
    locationCount: 3,
    needs: ["Dispatch continuity", "Cloud applications", "Security cameras", "Backup connectivity"],
  },
  {
    id: "demo-atrium",
    name: "Atrium Dental Group",
    category: "Medical & dental",
    distanceMiles: 0.11,
    bearing: 105,
    rating: 4.8,
    reviewCount: 246,
    size: "Estimated 10–19 employees",
    locationCount: 2,
    needs: ["Cloud practice software", "VoIP phones", "Large imaging files", "Guest Wi-Fi"],
  },
  {
    id: "demo-harper-cole",
    name: "Harper & Cole CPAs",
    category: "Legal & accounting",
    distanceMiles: 0.14,
    bearing: 196,
    rating: 4.6,
    reviewCount: 54,
    size: "Estimated 5–19 employees",
    locationCount: 1,
    needs: ["Cloud accounting", "Secure file transfers", "Video conferencing", "Off-site backup"],
  },
  {
    id: "demo-meridian",
    name: "Meridian Property Partners",
    category: "Property management",
    distanceMiles: 0.18,
    bearing: 292,
    rating: 4.4,
    reviewCount: 91,
    size: "Estimated 10–19 employees",
    locationCount: 4,
    needs: ["Cloud property systems", "VoIP phones", "Video conferencing", "Multi-site coordination"],
  },
  {
    id: "demo-forge-field",
    name: "Forge & Field Kitchen",
    category: "Hospitality & food",
    distanceMiles: 0.21,
    bearing: 340,
    rating: 4.5,
    reviewCount: 386,
    size: "Estimated 20–49 employees",
    locationCount: 2,
    needs: ["Point-of-sale reliability", "Guest Wi-Fi", "Online ordering", "Security cameras"],
  },
  {
    id: "demo-little-oaks",
    name: "Little Oaks Learning Center",
    category: "Education & childcare",
    distanceMiles: 0.24,
    bearing: 148,
    rating: 4.7,
    reviewCount: 73,
    size: "Estimated 10–19 employees",
    locationCount: 2,
    needs: ["Parent communication tools", "Security cameras", "Staff connectivity", "Backup connectivity"],
  },
  {
    id: "demo-cedarline",
    name: "Cedarline Auto Care",
    category: "Automotive",
    distanceMiles: 0.33,
    bearing: 72,
    rating: 4.6,
    reviewCount: 204,
    size: "Estimated 5–19 employees",
    locationCount: 1,
    needs: ["Shop management software", "Payment processing", "Parts ordering", "Guest Wi-Fi"],
  },
  {
    id: "demo-union-market",
    name: "Union Street Market",
    category: "Retail",
    distanceMiles: 0.41,
    bearing: 225,
    rating: 4.3,
    reviewCount: 164,
    size: "Estimated 10–19 employees",
    locationCount: 1,
    needs: ["Point-of-sale reliability", "Inventory systems", "Guest Wi-Fi", "Security cameras"],
  },
  {
    id: "demo-alder-financial",
    name: "Alder Financial Planning",
    category: "Financial services",
    distanceMiles: 0.72,
    bearing: 318,
    rating: 4.9,
    reviewCount: 39,
    size: "Estimated 5–19 employees",
    locationCount: 1,
    needs: ["Secure cloud applications", "Video conferencing", "VoIP phones", "Off-site backup"],
  },
  {
    id: "demo-stoneworks",
    name: "Stoneworks Construction",
    category: "Construction",
    distanceMiles: 1.35,
    bearing: 166,
    rating: 4.4,
    reviewCount: 112,
    size: "Estimated 20–49 employees",
    locationCount: 2,
    needs: ["Plan file transfers", "Cloud project tools", "Video conferencing", "Field coordination"],
  },
];

function pointFrom(centerPoint: Coordinates, distanceMiles: number, bearing: number) {
  const radians = (bearing * Math.PI) / 180;
  return {
    lat: centerPoint.lat + (Math.cos(radians) * distanceMiles) / 69,
    lng:
      centerPoint.lng +
      (Math.sin(radians) * distanceMiles) /
        (69 * Math.cos((centerPoint.lat * Math.PI) / 180)),
  };
}

function buildProspect(seed: DemoSeed, retrievedAt: string): Prospect {
  const { total, breakdown } = scoreProspect({
    distanceMiles: seed.distanceMiles,
    category: seed.category,
    rating: seed.rating,
    reviewCount: seed.reviewCount,
    hasPhone: false,
    hasWebsite: false,
    locationCount: seed.locationCount,
    verifiedBroadbandDelta: false,
    confidence: "Estimated",
  });

  const operations = seed.needs.slice(0, 2).join(" and ").toLowerCase();
  const opportunity =
    "Confirm address-level options, then discuss reliability and upload performance against documented operating needs.";

  return {
    id: seed.id,
    name: seed.name,
    address: "Illustrative location near the sample target",
    coordinates: pointFrom(center, seed.distanceMiles, seed.bearing),
    distanceMiles: seed.distanceMiles,
    category: seed.category,
    phone: null,
    website: null,
    directoryUrl: null,
    hours: ["Illustrative hours only — verify before outreach"],
    rating: seed.rating,
    reviewCount: seed.reviewCount,
    locationCount: seed.locationCount,
    businessSize: seed.size,
    operatingStatus: "Open",
    publicNotes: "Fictitious record supplied only to demonstrate the research workflow.",
    source: "ProspectIQ illustrative fixture",
    sourceDate: retrievedAt,
    retrievedAt,
    confidence: "Estimated",
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, seed.distanceMiles, seed.category, breakdown),
    topOpportunity: opportunity,
    summary: `${seed.name} is a fictitious ${seed.category.toLowerCase()} prospect used to demonstrate ProspectIQ. No claim in this sample record describes a real business.`,
    hypothesizedNeeds: seed.needs,
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with Spectrum Business. I work with businesses in the area on internet reliability and speed. I wanted to ask how your current connection is handling ${operations}.`,
    followUpEmail: {
      subject: `A quick question about connectivity at ${seed.name}`,
      body: `Hi — I’m following up from Spectrum Business. I work with nearby teams on reliable connectivity for ${operations}. If it would be useful, I can review the options available at your address and compare them with what your operation needs. Would a brief conversation next week be convenient?`,
    },
  };
}

export function generateDemoResearch(
  inputAddress = "Sample workspace · Charlotte, NC",
  radiusMiles = 0.25,
): ResearchResponse {
  const retrievedAt = new Date().toISOString();
  return {
    schemaVersion: 3,
    target: {
      inputAddress,
      formattedAddress: inputAddress.startsWith("Sample")
        ? inputAddress
        : `Unverified input · ${inputAddress}`,
      coordinates: center,
      geocodingConfidence: "Estimated",
    },
    radiusMiles,
    prospects: seeds
      .filter((seed) => seed.distanceMiles <= radiusMiles)
      .map((seed) => buildProspect(seed, retrievedAt)),
    broadband: [],
    sources: [
      {
        id: "demo-source",
        label: "ProspectIQ illustrative fixture",
        url: null,
        sourceDate: retrievedAt,
        retrievedAt,
        status: "Estimated",
      },
    ],
    retrievedAt,
    demoMode: true,
    warnings: [
      "Demo mode is active. Businesses, ratings, and locations are illustrative and are not tied to the entered address.",
      "Set USE_DEMO_DATA=false to use the live OpenStreetMap adapter.",
      "FCC observations require an official import or manual entry; target-area data never proves availability at a nearby business.",
    ],
  };
}
