import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Upstream calls per UTC day, to stay within the Transitous usage policy.
  usage: defineTable({
    day: v.string(),
    planCalls: v.number(),
    tripCalls: v.optional(v.number()),
  }).index("by_day", ["day"]),
});
