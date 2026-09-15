import { latLngToCell } from "h3-js";
import { distanceMiles } from "@/lib/place-candidate";
import { isNationalChain } from "@/lib/live/filters";
import type { SwarmBatch, SwarmProspect } from "@/lib/swarm/types";
import type { Prospect } from "@/lib/types";

export const MAX_ADDRESSES = 1000;
export function parseAddressBatch(text: string) {
  if (text.length > 300_000) throw new Error("This batch is too large. Split it into batches of up to 1,000 addresses.");
  const lines = text.split(/\r?\n|;/).map((line) => line.trim().replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, '').replace(/\s+/g, ' ')).filter(Boolean);
  if (lines.length > MAX_ADDRESSES) throw new Error("Use up to 1,000 addresses per batch. You can start another batch afterward.");
  const seen = new Set<string>();
  const addresses: string[] = [];
  const invalid: string[] = [];
  for (const line of lines) {
    if (line.length < 6 || line.length > 300 || !/[a-z]/i.test(line)) { invalid.push(line); continue; }
    const key = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seen.has(key)) { seen.add(key); addresses.push(line); }
  }
  return { addresses, duplicates: lines.length - addresses.length - invalid.length, invalid };
}
const norm = (text: string) => text.toLowerCase().replace(/\b(street|road|avenue|boulevard|drive|lane|highway)\b/g, (word) => ({ street: 'st', road: 'rd', avenue: 'ave', boulevard: 'blvd', drive: 'dr', lane: 'ln', highway: 'hwy' })[word]!).replace(/[^a-z0-9]/g, '');
export function sameSwarmBusiness(a: Prospect, b: Prospect) {
  if (a.id && a.id === b.id) return true;
  if (norm(a.name) !== norm(b.name)) return false;
  // A common website/switchboard cannot collapse separate branches.
  return norm(a.address) === norm(b.address) || distanceMiles(a.coordinates, b.coordinates) < 0.04;
}
export function clusterFor(coordinates: Prospect["coordinates"]) {
  if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180) return "unmapped";
  return latLngToCell(coordinates.lat, coordinates.lng, 8);
}
export function rankSwarmProspect(card: SwarmProspect): SwarmProspect {
  const p = card.business;
  const reasons: string[] = [];
  let rank = Math.round(p.score * 0.7);
  if (p.phone) { rank += 15; reasons.push("Public business phone available"); }
  if (p.website) { rank += 8; reasons.push("Company website available for research"); }
  if (!isNationalChain(p.name)) { rank += 7; reasons.push("Not matched to the national-chain list"); } else { rank -= 15; reasons.push("National chain; confirm local buying authority"); }
  if (p.operatingStatus === "Temporarily closed") { rank -= 30; reasons.push("Listed temporarily closed"); }
  if (card.broadband?.matchQuality === "exact" && card.broadband.observations.length) { rank += 5; reasons.push("Address-level broadband availability found"); }
  return { ...card, rank: Math.max(0, Math.min(100, rank)), opportunity: !p.phone && !p.website ? "contact_needed" : rank >= 75 ? "high" : "review", reasons };
}
export function addDiscovery(batch: SwarmBatch, prospect: Prospect, addressId: string, id: string) {
  const existing = batch.prospects.find((card) => sameSwarmBusiness(card.business, prospect));
  if (existing) {
    if (!existing.sourceAddressIds.includes(addressId)) existing.sourceAddressIds.push(addressId);
    existing.business = { ...existing.business, phone: existing.business.phone || prospect.phone, website: existing.business.website || prospect.website };
    Object.assign(existing, rankSwarmProspect(existing));
    return existing;
  }
  const now = new Date().toISOString();
  const card = rankSwarmProspect({ id, business: prospect, sourceAddressIds: [addressId], clusterId: clusterFor(prospect.coordinates), opportunity: "review", rank: 0, reasons: [], broadband: null, broadbandChecked: false, intelligence: null, researchStatus: "listing", error: null, firstSeenAt: now, updatedAt: now });
  batch.prospects.push(card);
  return card;
}
export function swarmClusters(prospects: SwarmProspect[]) {
  const groups = new Map<string, SwarmProspect[]>();
  for (const p of prospects) groups.set(p.clusterId, [...(groups.get(p.clusterId) ?? []), p]);
  return [...groups.entries()].map(([id, cards]) => ({ id, cards, high: cards.filter((card) => card.opportunity === "high").length })).sort((a, b) => b.high - a.high || b.cards.length - a.cards.length);
}
function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Spreadsheet exports must not execute a listing or address as a formula.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportSwarm(batch: SwarmBatch, cards = batch.prospects) {
  const rows: unknown[][] = [["Business", "Category", "Address", "Phone", "Website", "Priority", "Rank", "Available providers (not current ISP)", "Broadband as of", "Current ISP", "Source addresses", "Cluster", "Research status"]];
  for (const card of cards) rows.push([card.business.name, card.business.category, card.business.address, card.business.phone, card.business.website, card.opportunity, card.rank, [...new Set(card.broadband?.observations.map((o) => o.provider))].join('; '), card.broadband?.asOfDate, 'Not verified', card.sourceAddressIds.map((id) => batch.addresses.find((a) => a.id === id)?.text).filter(Boolean).join('; '), card.clusterId, card.researchStatus]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
