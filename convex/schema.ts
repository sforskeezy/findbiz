import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  records: defineTable({
    collection: v.string(), key: v.string(), revision: v.number(),
    summary: v.any(), updatedAt: v.number(), storageId: v.optional(v.id('_storage')), active: v.optional(v.boolean()),
  }).index("by_key", ["collection", "key"]).index("by_collection", ["collection", "updatedAt"]).index('by_work', ['collection','active','updatedAt']),
  chunks: defineTable({ record: v.id("records"), position: v.number(), text: v.string() })
    .index("by_record", ["record", "position"]),
});
