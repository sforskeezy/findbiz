import type { SignalSeverity, SignalType } from "@/lib/radar/types";
import { SIGNAL_TYPES } from "@/lib/radar/types";

export const SIGNAL_LABELS: Record<SignalType, { confirmed: string; possible: string; short: string }> = {
  new_business: {
    confirmed: "New business detected",
    possible: "Possible new business",
    short: "New business",
  },
  new_location: {
    confirmed: "New location detected",
    possible: "Possible new location",
    short: "New location",
  },
  moved: {
    confirmed: "Business moved locations",
    possible: "Possible location move",
    short: "Moved",
  },
  coming_soon: {
    confirmed: "Coming soon location",
    possible: "Possible coming soon location",
    short: "Coming soon",
  },
  address_changed: {
    confirmed: "Address changed",
    possible: "Possible address change",
    short: "Address change",
  },
  new_website: {
    confirmed: "New website detected",
    possible: "Possible new website",
    short: "New website",
  },
  website_changed: {
    confirmed: "Website changed",
    possible: "Possible website change",
    short: "Website change",
  },
  phone_added: {
    confirmed: "Phone number added",
    possible: "Possible new phone number",
    short: "New phone",
  },
  expanding: {
    confirmed: "Business appears to be expanding",
    possible: "Possible expansion",
    short: "Expanding",
  },
  hiring: {
    confirmed: "New hiring activity",
    possible: "Possible hiring activity",
    short: "Hiring",
  },
  grand_opening: {
    confirmed: "Grand opening announcement",
    possible: "Possible grand opening",
    short: "Grand opening",
  },
  renovation: {
    confirmed: "Renovation announced",
    possible: "Possible renovation",
    short: "Renovation",
  },
  new_ownership: {
    confirmed: "New ownership or management",
    possible: "Possible ownership change",
    short: "Ownership",
  },
  newly_registered: {
    confirmed: "Recently registered business",
    possible: "Possible recent registration",
    short: "Registered",
  },
  reopened: {
    confirmed: "Recently reopened",
    possible: "Possible reopening",
    short: "Reopened",
  },
  multiple_locations: {
    confirmed: "Multiple locations detected",
    possible: "Possible additional location",
    short: "Multiple locations",
  },
  newly_active_online: {
    confirmed: "Newly active online",
    possible: "Possible new online activity",
    short: "Newly active",
  },
  possible_new_listing: {
    confirmed: "New public listing",
    possible: "Possible new listing",
    short: "New listing",
  },
};

/** Radar is a prospecting tool. Hiring and low-review guesses are not reasons to call. */
export function isProspectSignal(type: SignalType) {
  return type !== "hiring" && type !== "possible_new_listing";
}

export const FILTERABLE_SIGNAL_TYPES = SIGNAL_TYPES.filter(isProspectSignal);

export const SEVERITY_COPY: Record<SignalSeverity, { mark: string; label: string; hint: string }> = {
  hot: { mark: "NOW", label: "Contact now", hint: "A public change that makes this worth calling today." },
  active: { mark: "CHANGED", label: "Recently changed", hint: "Something about this business recently changed." },
  watch: { mark: "WATCH", label: "Watch", hint: "Interesting, but not enough to call yet." },
};

export const SCAN_STAGE_COPY: Record<string, string> = {
  scanning: "Scanning territory…",
  discovering: "Discovering businesses…",
  comparing: "Comparing territory history…",
  web: "Checking recent web activity…",
  expansion: "Looking for new locations and openings…",
  hiring: "Looking for new locations and openings…",
  evidence: "Cross-checking evidence…",
  ranking: "Ranking opportunities…",
  complete: "Radar scan complete.",
};
