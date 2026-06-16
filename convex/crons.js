// ============================ scheduled jobs ============================
// Daily housekeeping (see maintenance.js). Times are UTC and staggered so the
// two prunes don't contend.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "prune expired sessions",
  { hourUTC: 4, minuteUTC: 0 },
  internal.maintenance.pruneExpiredSessions,
);

crons.daily(
  "prune old matches",
  { hourUTC: 4, minuteUTC: 10 },
  internal.maintenance.pruneOldMatches,
);

export default crons;
