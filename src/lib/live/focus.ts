import { foldBusinessName } from "@/lib/business-identity";
import type { LiveActiveCompany } from "@/lib/live/types";
import type { Prospect } from "@/lib/types";

export function locationFromAddress(address: string | null | undefined) {
  if (!address) return null;
  const parts = address.split(",").map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  const compact = address.replace(/\s+/g, " ").trim();
  return compact || null;
}

export function namesMatch(left: string, right: string) {
  const a = foldBusinessName(left);
  const b = foldBusinessName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function activeCompanyFromLookup(
  name: string,
  location: string | null,
  findings: Array<{ title: string; url: string; snippet: string }>,
): LiveActiveCompany {
  const website = findings.find((item) => /^https?:\/\//i.test(item.url))?.url ?? null;
  return {
    name,
    location,
    website,
    findings: findings.slice(0, 8),
  };
}

export function activeCompanyFromProspect(
  prospect: Prospect,
  location?: string | null,
  findings: LiveActiveCompany["findings"] = [],
): LiveActiveCompany {
  return {
    name: prospect.name,
    location: location || locationFromAddress(prospect.address),
    website: prospect.website,
    findings: findings.slice(0, 8),
    prospectId: prospect.id,
  };
}

export function formatActiveCompanyBlock(company: LiveActiveCompany | null | undefined) {
  if (!company) {
    return "None. After a named-company lookup or a list item is briefed, that company stays active for “this company”, “them”, and “brief me again” even if there is no nearby-business list.";
  }
  const place = company.location ? ` · ${company.location}` : "";
  const site = company.website ? `\nWebsite: ${company.website}` : "";
  return `${company.name}${place}${site}\n“This company”, “them”, “this business”, and “brief me again” refer to this company. It does not require a nearby-business list.`;
}
