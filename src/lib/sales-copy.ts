import type { Prospect } from "@/lib/types";

const categoryAngles: Record<string, string> = {
  "Medical & dental":
    "Clinics usually depend on cloud practice software, imaging files, VoIP phones, and patient Wi-Fi — downtime hits scheduling and care delivery fast.",
  "Legal & accounting":
    "These offices move large files, run secure cloud apps, and live on video calls; unreliable upload or drops become billable-time problems.",
  "Logistics & warehouse":
    "Dispatch, inventory, cameras, and handheld scanners all need steady connectivity — a weak link shows up as missed shipments and stalled floor ops.",
  "Property management":
    "Property teams juggle multi-site systems, VoIP, and vendor coordination; connectivity issues multiply across locations quickly.",
  "Financial services":
    "Banks and insurance offices need secure, always-on access for cloud apps, video, and phones — reliability and support matter as much as speed.",
  "Education & childcare":
    "Staff systems, security cameras, and parent communication all ride the network; outages disrupt operations and parent trust.",
  Automotive:
    "Shops lean on management software, payment processing, and parts ordering — slow or flaky internet stalls the bay and the counter.",
  "Hospitality & food":
    "POS, online ordering, and guest Wi-Fi are revenue-critical; even short outages show up as lost tickets and frustrated guests.",
  Retail:
    "Inventory systems, card payments, and guest Wi-Fi need dependable bandwidth — weak connectivity hits checkout and stock accuracy first.",
  Construction:
    "Plan files, field coordination, and cloud project tools punish slow uploads; jobsite teams feel every connectivity gap.",
  "Professional services":
    "Cloud apps, VoIP, and video are table stakes — reps should qualify how many people and devices the network has to carry every day.",
  "Other/Unknown":
    "Public category detail is limited. Use the first conversation to learn which connected tools, if any, matter to the operation.",
};

export function salesAngleForCategory(category: string) {
  return categoryAngles[category] ?? categoryAngles["Other/Unknown"];
}

export function buildSalesSummary(input: {
  name: string;
  category: string;
  distanceMiles: number;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  operatingStatus: Prospect["operatingStatus"];
}) {
  const angle = salesAngleForCategory(input.category);
  const contactBits = [
    input.phone ? "phone on file" : null,
    input.website ? "website listed" : null,
    input.rating != null
      ? `${input.rating.toFixed(1)} rating${input.reviewCount ? ` from ${input.reviewCount} reviews` : ""}`
      : null,
  ].filter(Boolean);

  const contactLine = contactBits.length
    ? `Public contact signals include ${contactBits.join(", ")}.`
    : "Public contact details are thin, so discovery will matter more than desk research.";

  const statusLine =
    input.operatingStatus === "Open"
      ? "It appears open."
      : input.operatingStatus === "Temporarily closed"
        ? "Listings mark it temporarily closed — confirm status before pitching."
        : "Operating status is unclear from public listings.";

  return `${input.name} is a ${input.category.toLowerCase()} prospect about ${input.distanceMiles.toFixed(2)} miles from the searched address. ${angle} ${statusLine} ${contactLine} Use the Broadband tab to review FCC availability observations at the address, then qualify reliability, speed, support, and contract fit on the call — never assume their current provider.`;
}

export function buildSalesOpportunity(category: string) {
  return `Treat connected operations as a hypothesis for this ${category.toLowerCase()} business, then ask which tools matter most and what happens when the connection slows or drops.`;
}
