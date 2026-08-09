import { z } from "zod";

import type { BroadbandObservation, Prospect } from "@/lib/types";

const sourceFactSchema = z.object({ label: z.string().min(1).max(160), updatedAt: z.string().max(80).nullable() }).strict();

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
        sourceFacts: z.array(sourceFactSchema).max(8),
        confidence: z.enum(["High", "Medium", "Low"]),
        evidenceCompleteness: z.number().int().min(0).max(100),
      })
      .strict(),
    broadband: z
      .array(
        z
          .object({
            provider: z.string().min(1).max(200),
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
  return {
    business: {
      name: prospect.name,
      category: prospect.category,
      distanceMiles: prospect.distanceMiles,
      operatingStatus: prospect.operatingStatus,
      phoneAvailable: Boolean(prospect.phone),
      websiteAvailable: Boolean(prospect.website),
      sourceFacts: prospect.sources.slice(0, 8).map((source) => ({ label: source.label, updatedAt: source.updatedAt })),
      confidence: prospect.dataConfidence,
      evidenceCompleteness: prospect.evidenceCompleteness,
    },
    broadband: broadband.slice(0, 30).map((item) => ({
      provider: item.provider,
      technology: item.technology,
      downloadMbps: item.downloadMbps,
      uploadMbps: item.uploadMbps,
      scope: item.scope,
      sourceDate: item.sourceDate,
    })),
  };
}
