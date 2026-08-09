export const ENTERPRISE_POLICY_VERSION = "2026-08-01.v1";

export type EnterprisePolicyEntry = {
  id: string;
  names: string[];
  domains: string[];
  brands: string[];
  treatment: "exclude" | "franchise_unknown";
  rationale: string;
};

/**
 * Conservative, reviewable policy. Franchise-heavy brands remain eligible
 * unless another source establishes corporate ownership. Entries marked
 * `exclude` are organizations whose retail locations are treated as national
 * enterprise sites for this tool's SMB prospect list.
 */
export const ENTERPRISE_POLICY: EnterprisePolicyEntry[] = [
  {
    id: "walmart",
    names: ["walmart", "walmart supercenter", "sam's club", "sams club"],
    domains: ["walmart.com", "samsclub.com"],
    brands: ["walmart", "sam's club", "sams club"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "amazon",
    names: ["amazon", "amazon fulfillment center", "amazon delivery station"],
    domains: ["amazon.com"],
    brands: ["amazon"],
    treatment: "exclude",
    rationale: "Configured national enterprise operator.",
  },
  {
    id: "home-depot",
    names: ["the home depot", "home depot"],
    domains: ["homedepot.com"],
    brands: ["the home depot", "home depot"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "lowes",
    names: ["lowe's", "lowes"],
    domains: ["lowes.com"],
    brands: ["lowe's", "lowes"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "starbucks",
    names: ["starbucks"],
    domains: ["starbucks.com"],
    brands: ["starbucks"],
    treatment: "exclude",
    rationale: "Configured national enterprise brand.",
  },
  {
    id: "franchise-brands",
    names: ["mcdonald's", "mcdonalds", "subway", "dunkin", "domino's", "dominos"],
    domains: ["mcdonalds.com", "subway.com", "dunkindonuts.com", "dominos.com"],
    brands: ["mcdonald's", "mcdonalds", "subway", "dunkin", "domino's", "dominos"],
    treatment: "franchise_unknown",
    rationale: "Brand alone does not establish whether the location is independently operated.",
  },
];
