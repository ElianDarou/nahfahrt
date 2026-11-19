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

/** What a reservation answers: whether it may go ahead, and how much of the day is left after it. */
export interface Reservation {
  ok: boolean;
  day: string;
  left: number;
}

/** Reserves upstream calls. Not ok once the day's budget is used up. */
export const reservePlanCalls = internalMutation({
  args: { calls: v.number() },
  handler: async (ctx, { calls }): Promise<Reservation> => {
    const { day, usage } = await usageToday(ctx);
    const used = usage?.planCalls ?? 0;
    if (used + calls > DAILY_PLAN_LIMIT) return { ok: false, day, left: DAILY_PLAN_LIMIT - used };
    if (usage) await ctx.db.patch(usage._id, { planCalls: used + calls });
    else await ctx.db.insert("usage", { day, planCalls: calls });
    return { ok: true, day, left: DAILY_PLAN_LIMIT - used - calls };
  },
});

export const reserveTripCall = internalMutation({
  args: {},
  handler: async (ctx): Promise<Reservation> => {
    const { day, usage } = await usageToday(ctx);
    const used = usage?.tripCalls ?? 0;
    if (used >= DAILY_TRIP_LIMIT) return { ok: false, day, left: 0 };
    if (usage) await ctx.db.patch(usage._id, { tripCalls: used + 1 });
    else await ctx.db.insert("usage", { day, planCalls: 0, tripCalls: 1 });
    return { ok: true, day, left: DAILY_TRIP_LIMIT - used - 1 };
  },
});
