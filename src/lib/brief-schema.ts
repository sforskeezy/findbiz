import { z } from "zod";

import type { BroadbandObservation, Prospect } from "@/lib/types";

export const briefRequestSchema = z
  .object({
    business: z
      .object({
        name: z.string().min(1).max(300),
        category: z.string().min(1).max(120),
        distanceMiles: z.number().finite().min(0).max(100),
        operatingStatus: z.enum(["Open", "Temporarily closed", "Permanently closed", "Unknown"]),
        phoneAvailable: z.boolean(),
        websiteAvailable: z.boolean(),
        publicFactDates: z.array(z.string().max(80)).max(8),
        confidence: z.enum(["High", "Medium", "Low"]),
        evidenceCompleteness: z.number().int().min(0).max(100),
      })
      .strict(),
    broadband: z
      .array(
        z
          .object({
            technology: z.string().min(1).max(160),
            downloadMbps: z.number().nonnegative().nullable(),
            uploadMbps: z.number().nonnegative().nullable(),
            scope: z.enum(["exact_location", "nearby_area"]),
            sourceDate: z.string().max(80),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type BriefRequest = z.infer<typeof briefRequestSchema>;

export function buildBriefRequest(prospect: Prospect, broadband: BroadbandObservation[]): BriefRequest {
  if (prospect.eligibility.status !== "eligible") {
    throw new Error("Research briefs are only available for eligible prospects.");
  }
  return {
    business: {
      name: prospect.name,
      category: prospect.category,
      distanceMiles: prospect.distanceMiles,
      operatingStatus: prospect.operatingStatus,
      phoneAvailable: Boolean(prospect.phone),
      websiteAvailable: Boolean(prospect.website),
      publicFactDates: prospect.sources
        .map((source) => source.updatedAt)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8),
      confidence: prospect.dataConfidence,
      evidenceCompleteness: prospect.evidenceCompleteness,
    },
    broadband: broadband.slice(0, 30).map((item) => ({
      technology: item.technology,
      downloadMbps: item.downloadMbps,
      uploadMbps: item.uploadMbps,
      scope: item.scope,
      sourceDate: item.sourceDate,
    })),
  };
}
