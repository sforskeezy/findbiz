import { createHash } from "node:crypto";

import { distanceMiles } from "@/lib/place-candidate";
import type { Coordinates, Prospect } from "@/lib/types";

export function normalizedName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[.,'’"“”]/g, "")
    .replace(/\b(incorporated|corporation|company|limited|llc|inc|ltd|co|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function phoneDigits(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function websiteHost(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normalizedAddress(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(united states|usa|us)\b/g, "")
    .replace(/\b(suite|ste|unit|apt|#)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cell(coordinates: Coordinates, decimals = 3) {
  return `${coordinates.lat.toFixed(decimals)}:${coordinates.lng.toFixed(decimals)}`;
}

export function hashKey(...parts: string[]) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

/** Stable identity for one commercial location. */
export function locationKey(input: {
  prospectId?: string;
  name: string;
  phone: string | null;
  website: string | null;
  coordinates: Coordinates;
}) {
  if (input.prospectId?.startsWith("gmap-") || input.prospectId?.startsWith("place-")) {
    return input.prospectId;
  }
  const name = normalizedName(input.name);
  const phone = phoneDigits(input.phone);
  if (name && phone) return `np:${hashKey(name, phone, cell(input.coordinates, 3))}`;
  if (name) return `nc:${hashKey(name, cell(input.coordinates, 3))}`;
  return `c:${hashKey(cell(input.coordinates, 4))}`;
}

/** Stable identity for the organization across locations. */
export function companyKey(input: { name: string; phone: string | null; website: string | null }) {
  const host = websiteHost(input.website);
  if (host && !isGenericHost(host)) return `host:${host}`;
  const phone = phoneDigits(input.phone);
  if (phone) return `phone:${phone}`;
  return `name:${normalizedName(input.name) || hashKey(input.name)}`;
}

function isGenericHost(host: string) {
  return /(?:facebook|instagram|yelp|google|maps\.|linktr\.ee|bit\.ly)$/i.test(host);
}

export function sameLocation(
  a: { name: string; phone: string | null; website: string | null; coordinates: Coordinates },
  b: { name: string; phone: string | null; website: string | null; coordinates: Coordinates },
) {
  if (phoneDigits(a.phone) && phoneDigits(a.phone) === phoneDigits(b.phone) && distanceMiles(a.coordinates, b.coordinates) <= 0.25) {
    return true;
  }
  const namesMatch =
    normalizedName(a.name) === normalizedName(b.name) ||
    normalizedName(a.name).includes(normalizedName(b.name)) ||
    normalizedName(b.name).includes(normalizedName(a.name));
  return namesMatch && distanceMiles(a.coordinates, b.coordinates) <= 0.2;
}

export function sameCompany(
  a: { name: string; phone: string | null; website: string | null },
  b: { name: string; phone: string | null; website: string | null },
) {
  const aHost = websiteHost(a.website);
  const bHost = websiteHost(b.website);
  if (aHost && bHost && aHost === bHost && !isGenericHost(aHost)) return true;
  const aPhone = phoneDigits(a.phone);
  const bPhone = phoneDigits(b.phone);
  if (aPhone && bPhone && aPhone === bPhone) return true;
  return normalizedName(a.name) === normalizedName(b.name) && Boolean(normalizedName(a.name));
}

export function territoryId(locationQuery: string, radiusMiles: number, coordinates: Coordinates) {
  return hashKey(locationQuery.trim().toLowerCase(), String(radiusMiles), coordinates.lat.toFixed(4), coordinates.lng.toFixed(4));
}

export function signalIdentity(businessKey: string, type: string) {
  return hashKey(businessKey, type);
}

export function observationFromProspect(
  prospect: Prospect,
  timestamps: { firstSeenAt: string; lastSeenAt: string },
) {
  return {
    key: locationKey({
      prospectId: prospect.id,
      name: prospect.name,
      phone: prospect.phone,
      website: prospect.website,
      coordinates: prospect.coordinates,
    }),
    companyKey: companyKey(prospect),
    prospectId: prospect.id,
    name: prospect.name,
    address: prospect.address,
    coordinates: prospect.coordinates,
    distanceMiles: prospect.distanceMiles,
    category: prospect.category,
    phone: prospect.phone,
    website: prospect.website,
    directoryUrl: prospect.directoryUrl,
    rating: prospect.rating,
    reviewCount: prospect.reviewCount,
    operatingStatus: prospect.operatingStatus,
    source: prospect.source,
    firstSeenAt: timestamps.firstSeenAt,
    lastSeenAt: timestamps.lastSeenAt,
  };
}

export function cityFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 3] || parts[0];
  if (parts.length === 2) return parts[0];
  return address.split(" ").slice(-2).join(" ");
}
