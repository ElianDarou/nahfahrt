import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Stops kept for 30 days; the table would otherwise grow with every search ever made.
crons.daily("place cache prune", { hourUTC: 3, minuteUTC: 17 }, internal.placeCache.prune);

export default crons;
