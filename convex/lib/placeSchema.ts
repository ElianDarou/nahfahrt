import { v } from "convex/values";

/** The shape of a place as sent to the app; also the shape kept in the stop cache. */
export const placeValidator = v.object({
  n: v.string(),
  s: v.optional(v.string()),
  i: v.optional(v.string()),
  y: v.number(),
  x: v.number(),
  a: v.optional(v.literal(1)),
});
