import { z } from "zod";

import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResult } from "@/lib/place-provider";
import { distanceMiles, normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";
import {
  CircuitBreaker,
  ProviderRateLimiter,
  createTimeoutSignal,
  redactError,
} from "@/lib/request-safety";

const REQUIRED_LICENSE_ACK = "business-discovery-and-sales-prospecting-permitted";

const placeSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  categories: z.array(z.string().max(120)).max(12).default([]),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(80).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  operatingStatus: z.enum(["open", "temporarily_closed", "permanently_closed", "unknown"]).default("unknown"),
  confidence: z.number().min(0).max(1).nullable().optional(),
  updatedAt: z.string().max(80).nullable().optional(),
  apartmentUnits: z.number().int().nonnegative().nullable().optional(),
});

const responseSchema = z.object({ businesses: z.array(placeSchema).max(1_000) });

const limiter = new ProviderRateLimiter(250);
const breaker = new CircuitBreaker(3, 60_000);

function configuration() {
  const baseUrl = process.env.COMMERCIAL_PROVIDER_BASE_URL?.trim();
  const apiKey = process.env.COMMERCIAL_PROVIDER_API_KEY?.trim();
  const providerId = process.env.COMMERCIAL_PROVIDER_ID?.trim();
  const label = process.env.COMMERCIAL_PROVIDER_LABEL?.trim();
  const attributionUrl = process.env.COMMERCIAL_PROVIDER_ATTRIBUTION_URL?.trim();
  const retentionRule = process.env.COMMERCIAL_PROVIDER_RETENTION_RULE?.trim();
  const acknowledged = process.env.COMMERCIAL_PROVIDER_LICENSE_ACK === REQUIRED_LICENSE_ACK;
  const enabled = Boolean(baseUrl && apiKey && providerId && label && attributionUrl && retentionRule && acknowledged);
  return { baseUrl, apiKey, providerId, label, attributionUrl, retentionRule, acknowledged, enabled };
}

export function commercialProviderStatus() {
  const config = configuration();
  return {
    configured: config.enabled,
    code: config.enabled ? "COMMERCIAL_READY" : "COMMERCIAL_DISABLED",
    licenseAcknowledged: config.acknowledged,
  };
}

function mapStatus(value: z.infer<typeof placeSchema>["operatingStatus"]): PlaceCandidate["operatingStatus"] {
  if (value === "open") return "Open";
  if (value === "temporarily_closed") return "Temporarily closed";
  if (value === "permanently_closed") return "Permanently closed";
  return "Unknown";
}

export class CommercialPlaceProvider implements PlaceProvider {
  readonly id = "commercial";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const started = performance.now();
    const config = configuration();
    if (!config.enabled || !config.baseUrl || !config.apiKey || !config.providerId || !config.label) {
      return {
        providerId: this.id,
        places: [],
        completedCellIds: [],
        diagnostic: {
          providerId: this.id,
          label: "Optional licensed commercial provider",
          status: "disabled",
          code: "COMMERCIAL_DISABLED",
          recordCount: 0,
          requestCount: 0,
          durationMs: Math.round(performance.now() - started),
          message: "No commercial source is enabled. A separate licensing decision is required.",
          attributionUrl: null,
        },
      };
    }

    const candidates: PlaceCandidate[] = [];
    const completedCellIds: string[] = [];
    let requestCount = 0;
    let partial = false;
    try {
      breaker.assertAvailable();
      for (const cell of request.cells) {
        if (requestCount >= request.budget.maxRequests || Date.now() >= request.budget.deadline) {
          partial = true;
          break;
        }
        await limiter.wait(request.signal);
        const signal = createTimeoutSignal(5_000, request.signal);
        const response = await this.fetchImpl(config.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            latitude: cell.center.lat,
            longitude: cell.center.lng,
            radiusMeters: Math.round(cell.radiusMiles * 1609.344),
            limit: Math.min(250, request.budget.maxRecords - candidates.length),
            fields: ["id", "name", "coordinates", "categories", "address", "phone", "website", "brand", "operatingStatus", "confidence", "updatedAt", "apartmentUnits"],
          }),
          cache: "no-store",
          signal,
        });
        requestCount += 1;
        if (!response.ok) throw new Error(`Commercial provider returned HTTP ${response.status}.`);
        const payload = responseSchema.parse(await response.json());
        for (const place of payload.businesses) {
          const providerId = config.providerId;
          const coordinates = { lat: place.lat, lng: place.lng };
          if (distanceMiles(request.center, coordinates) > request.radiusMiles) continue;
          candidates.push({
            id: `${providerId}-${place.id}`,
            name: place.name,
            address: place.address ?? null,
            coordinates,
            category: normalizeCategory(place.categories[0]),
            rawCategories: place.categories,
            phone: place.phone ?? null,
            website: place.website ?? null,
            directoryUrl: null,
            hours: null,
            rating: null,
            reviewCount: null,
            brand: place.brand ?? null,
            apartmentUnits: place.apartmentUnits ?? null,
            operatingStatus: mapStatus(place.operatingStatus),
            publicNotes: null,
            sources: [
              {
                providerId,
                providerRecordId: place.id,
                label: config.label,
                url: config.attributionUrl ?? null,
                updatedAt: place.updatedAt ?? null,
                confidence: place.confidence ?? null,
                dataset: null,
              },
            ],
            fieldProvenance: {
              name: [providerId],
              address: place.address ? [providerId] : [],
              coordinates: [providerId],
              category: [providerId],
              phone: place.phone ? [providerId] : [],
              website: place.website ? [providerId] : [],
              brand: place.brand ? [providerId] : [],
              operatingStatus: [providerId],
            },
            sourceDate: place.updatedAt ?? "",
            confidence: place.confidence !== null && place.confidence !== undefined && place.confidence >= 0.8 ? "Verified" : "Estimated",
            sourceConfidence: place.confidence ?? null,
          });
          if (candidates.length >= request.budget.maxRecords) {
            partial = true;
            break;
          }
        }
        completedCellIds.push(cell.id);
        if (partial) break;
      }
      breaker.success();
      return {
        providerId: this.id,
        places: candidates,
        completedCellIds,
        diagnostic: {
          providerId: this.id,
          label: config.label,
          status: partial ? "partial" : "complete",
          code: partial ? "COMMERCIAL_BUDGET_REACHED" : "COMMERCIAL_COMPLETE",
          recordCount: candidates.length,
          requestCount,
          durationMs: Math.round(performance.now() - started),
          message: partial ? "Commercial provider search reached its configured budget." : "Licensed commercial provider search completed.",
          attributionUrl: config.attributionUrl ?? null,
        },
      };
    } catch (error) {
      breaker.failure();
      return {
        providerId: this.id,
        places: candidates,
        completedCellIds,
        diagnostic: {
          providerId: this.id,
          label: config.label,
          status: candidates.length ? "partial" : "failed",
          code: request.signal?.aborted ? "COMMERCIAL_TIMEOUT" : "COMMERCIAL_FAILED",
          recordCount: candidates.length,
          requestCount,
          durationMs: Math.round(performance.now() - started),
          message: redactError(error, "Commercial provider failed."),
          attributionUrl: config.attributionUrl ?? null,
        },
      };
    }
  }
}
