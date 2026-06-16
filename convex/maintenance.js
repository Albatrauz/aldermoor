// ============================ housekeeping ============================
// Periodic cleanup driven by crons.js. Both mutations work in bounded batches so
// a backlog can never blow Convex's per-transaction limits — the daily cadence
// drains any remainder over subsequent runs. At hobby scale one run clears all.
import { internalMutation } from "./_generated/server";

const BATCH = 500;
const MATCH_RETENTION_MS = 1000 * 60 * 60 * 24 * 90; // keep 90 days of match history

// Drop sessions whose tokens have expired, so the table doesn't accumulate dead
// rows. userByToken already treats an expired session as logged-out.
export const pruneExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(BATCH);
    for (const s of stale) await ctx.db.delete(s._id);
    return stale.length;
  },
});

// Age out old per-round history. Lifetime aggregates live in `stats`, so trimming
// the `matches` audit trail beyond the retention window is safe.
export const pruneOldMatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MATCH_RETENTION_MS;
    const old = await ctx.db
      .query("matches")
      .withIndex("by_finishedAt", (q) => q.lt("finishedAt", cutoff))
      .take(BATCH);
    for (const m of old) await ctx.db.delete(m._id);
    return old.length;
  },
});
