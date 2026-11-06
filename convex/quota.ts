import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Transitous asks to be contacted before exceeding 720 /plan requests per day.
 * This limit keeps the shared public endpoint below that.
 */
const DAILY_PLAN_LIMIT = 700;

/** Reserves upstream calls. Returns false once the day's budget is used up. */
export const reservePlanCalls = internalMutation({
  args: { calls: v.number() },
  handler: async (ctx, { calls }) => {
    const day = new Date().toISOString().slice(0, 10);
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_day", (query) => query.eq("day", day))
      .unique();
    const used = usage?.planCalls ?? 0;
    if (used + calls > DAILY_PLAN_LIMIT) return false;
    if (usage) await ctx.db.patch(usage._id, { planCalls: used + calls });
    else await ctx.db.insert("usage", { day, planCalls: calls });
    return true;
  },
});
