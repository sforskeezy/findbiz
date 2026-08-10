import type { Prospect, ResearchResponse } from "@/lib/types";

export type InMemorySearch = { address: string; radiusMiles: number };

let search: InMemorySearch | null = null;
let research: ResearchResponse | null = null;
let selectedProspect: Prospect | null = null;

export function beginSearch(value: InMemorySearch) {
  search = value;
  research = null;
  selectedProspect = null;
}

export function currentSearch() {
  return search;
}

export function setCurrentResearch(value: ResearchResponse) {
  research = value;
}

export function currentResearch() {
  return research;
}

export function selectProspect(value: Prospect) {
  selectedProspect = value;
}

export function currentProspect(prospectId?: string) {
  if (prospectId && selectedProspect?.id !== prospectId) return null;
  return selectedProspect;
}

export function clearInMemorySession() {
  search = null;
  research = null;
  selectedProspect = null;
}
