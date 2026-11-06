import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Transitous asks to be contacted before exceeding 720 /plan requests per day.
 * This limit keeps the shared public endpoint below that.
 */
const DAILY_PLAN_LIMIT = 700;
/** Following a trip is far cheaper upstream, but must not grow without bound either. */
const DAILY_TRIP_LIMIT = 20_000;

const usageToday = async (ctx: MutationCtx) => {
  const day = new Date().toISOString().slice(0, 10);
  const usage = await ctx.db
    .query("usage")
    .withIndex("by_day", (query) => query.eq("day", day))
    .unique();
  return { day, usage };
};

/** Reserves upstream calls. Returns false once the day's budget is used up. */
export const reservePlanCalls = internalMutation({
  args: { calls: v.number() },
  handler: async (ctx, { calls }) => {
    const { day, usage } = await usageToday(ctx);
    const used = usage?.planCalls ?? 0;
    if (used + calls > DAILY_PLAN_LIMIT) return false;
    if (usage) await ctx.db.patch(usage._id, { planCalls: used + calls });
    else await ctx.db.insert("usage", { day, planCalls: calls });
    return true;
  },
});

export const reserveTripCall = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { day, usage } = await usageToday(ctx);
    const used = usage?.tripCalls ?? 0;
    if (used >= DAILY_TRIP_LIMIT) return false;
    if (usage) await ctx.db.patch(usage._id, { tripCalls: used + 1 });
    else await ctx.db.insert("usage", { day, planCalls: 0, tripCalls: 1 });
    return true;
  },
});
