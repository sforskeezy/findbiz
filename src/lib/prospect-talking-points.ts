import { categoryStakes } from "@/lib/brief-fallback";
import type { CompanyIntelligence, Prospect } from "@/lib/types";

/** Questions grounded in professional evidence, with category assumptions phrased as questions. */
export function prospectTalkingPoints(prospect: Prospect, intelligence: CompanyIntelligence | null) {
  const points: string[] = [];
  const facts = intelligence?.facts ?? [];
  const founded = facts.find((fact) => fact.kind === "founded");
  const leader = facts.find((fact) => fact.kind === "leadership");
  const description = `${intelligence?.summary ?? ""} ${prospect.publicNotes ?? ""}`;
  if (/\bonline (?:booking|scheduling|appointments?)\b/i.test(description)) points.push("Your business advertises online booking. How do bookings and customer calls reach you during your busiest hours?");
  if (/\b(?:delivery|dispatch|shipping)\b/i.test(description)) points.push("Your public business description mentions delivery or dispatch. What does the team rely on to keep customers updated when things get busy?");
  if (founded && /\b(?:18|19|20)\d{2}\b/.test(founded.value)) points.push(`Your company information lists ${founded.value.match(/\b(?:18|19|20)\d{2}\b/)![0]} as the founding year. What has changed most about how the business operates since then?`);
  const stakes = categoryStakes(prospect.category);
  points.push(`For ${prospect.name}, which parts of ${stakes.pressure} actually matter day to day?`);
  if ((prospect.locationCount ?? 0) > 1) points.push(`The listing shows ${prospect.locationCount} locations. How do you keep the team connected between them?`);
  points.push("If the connection slowed down during your busiest hour, what would the team have to stop or work around?");
  if (leader) points.push(`The company site names ${leader.value} as ${leader.label.toLowerCase().includes("founder") ? "a founder" : "an owner"}. Are they still involved in internet and phone decisions, or does someone else handle that?`);
  else points.push("Who handles internet and phone decisions here, and what would make reviewing your options worthwhile?");
  points.push("Is there an upcoming renewal, move, or change in the business that would make this a useful time to talk?");
  return points.slice(0, 6);
}

export function prospectCallOpener(prospect: Prospect) {
  return `Hi, this is [your name] with [your company]. I’m reaching out to ${prospect.name} about business internet and phone. Are you the right person to ask about how that’s working for the team?`;
}
