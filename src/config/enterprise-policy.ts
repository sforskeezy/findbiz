export const ENTERPRISE_POLICY_VERSION = "2026-08-09.v2";

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
    names: ["lowe's", "lowes", "lowe's home improvement", "lowes home improvement"],
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
    id: "target",
    names: ["target", "target store"],
    domains: ["target.com"],
    brands: ["target"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "costco",
    names: ["costco", "costco wholesale"],
    domains: ["costco.com"],
    brands: ["costco", "costco wholesale"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "best-buy",
    names: ["best buy"],
    domains: ["bestbuy.com"],
    brands: ["best buy"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "cvs",
    names: ["cvs", "cvs pharmacy"],
    domains: ["cvs.com"],
    brands: ["cvs", "cvs pharmacy"],
    treatment: "exclude",
    rationale: "Configured national enterprise pharmacy.",
  },
  {
    id: "walgreens",
    names: ["walgreens", "walgreen pharmacy"],
    domains: ["walgreens.com"],
    brands: ["walgreens"],
    treatment: "exclude",
    rationale: "Configured national enterprise pharmacy.",
  },
  {
    id: "dollar-stores",
    names: ["dollar general", "dollar general market", "dollar tree", "family dollar"],
    domains: ["dollargeneral.com", "dollartree.com", "familydollar.com"],
    brands: ["dollar general", "dollar tree", "family dollar"],
    treatment: "exclude",
    rationale: "Configured national enterprise discount retailer.",
  },
  {
    id: "aldi-whole-foods",
    names: ["aldi", "aldi food market", "whole foods", "whole foods market"],
    domains: ["aldi.us", "wholefoodsmarket.com"],
    brands: ["aldi", "whole foods", "whole foods market"],
    treatment: "exclude",
    rationale: "Configured national enterprise grocer.",
  },
  {
    id: "tractor-supply",
    names: ["tractor supply", "tractor supply co", "tractor supply company"],
    domains: ["tractorsupply.com"],
    brands: ["tractor supply", "tractor supply company"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
  },
  {
    id: "harbor-freight",
    names: ["harbor freight", "harbor freight tools"],
    domains: ["harborfreight.com"],
    brands: ["harbor freight", "harbor freight tools"],
    treatment: "exclude",
    rationale: "Configured national enterprise retailer.",
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
