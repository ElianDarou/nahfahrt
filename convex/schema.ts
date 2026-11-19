import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { placeValidator } from "./lib/placeSchema";

export default defineSchema({
  // Upstream calls per UTC day, to stay within the Transitous usage policy.
  usage: defineTable({
    day: v.string(),
    planCalls: v.number(),
    tripCalls: v.optional(v.number()),
  }).index("by_day", ["day"]),
  // Answers to stop searches. Never addresses; see lib/placeCache.
  placeCache: defineTable({
    /** Normalised text plus the coarse region it was searched for. */
    key: v.string(),
    /** Milliseconds since the epoch, for the 30-day lifetime. */
    at: v.number(),
    places: v.array(placeValidator),
  })
    .index("by_key", ["key"])
    .index("by_at", ["at"]),
});
