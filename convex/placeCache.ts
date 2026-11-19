import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { CACHE_DAYS } from "./lib/placeCache";
import { placeValidator } from "./lib/placeSchema";

const CACHE_MS = CACHE_DAYS * 86_400_000;
const PRUNE_BATCH = 200;

/**
 * Answers to stop searches, so a repeated search costs no upstream call and comes back in the
 * time of one database read. Only stop lists are stored; see `cacheable` in lib/placeCache.
 */
export const lookup = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    // `first` instead of `unique`: two searches racing on a cold entry must not break the read.
    const row = await ctx.db
      .query("placeCache")
      .withIndex("by_key", (query) => query.eq("key", key))
      .first();
    if (!row || Date.now() - row.at > CACHE_MS) return null;
    return row.places;
  },
});

export const store = internalMutation({
  args: { key: v.string(), places: v.array(placeValidator) },
  handler: async (ctx, { key, places }) => {
    const row = await ctx.db
      .query("placeCache")
      .withIndex("by_key", (query) => query.eq("key", key))
      .first();
    const at = Date.now();
    if (row) await ctx.db.patch(row._id, { at, places });
    else await ctx.db.insert("placeCache", { key, at, places });
  },
});

/** Clears what has aged out, so the table does not grow with every search ever made. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("placeCache")
      .withIndex("by_at", (query) => query.lt("at", Date.now() - CACHE_MS))
      .take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
  },
});
