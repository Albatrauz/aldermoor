// ============================ persistent stats ============================
// Lifetime aggregates + per-round history, written ONLY by the authoritative
// game server (server.js). The browser never calls recordMatch — it's guarded
// by SERVER_SHARED_SECRET, a value the client never sees. The leaderboard and
// myStats are public reads (stats carry no secrets).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function assertServer(secret) {
  const expected = process.env.SERVER_SHARED_SECRET;
  // fail closed: if the secret isn't configured, nobody may write
  if (!expected || secret !== expected) throw new Error("forbidden");
}

const matchResult = v.object({
  userId: v.id("users"),
  username: v.string(),
  roundKills: v.number(),
  roundDeaths: v.number(),
  headshots: v.number(),
  won: v.boolean(),
});

// One call per finished (or abandoned) round, carrying every authenticated
// participant's tally. Folds each into their lifetime `stats` and appends a
// `matches` history row.
export const recordMatch = mutation({
  args: { secret: v.string(), results: v.array(matchResult) },
  handler: async (ctx, { secret, results }) => {
    assertServer(secret);
    const now = Date.now();
    for (const r of results) {
      const stat = await ctx.db
        .query("stats")
        .withIndex("by_userId", (q) => q.eq("userId", r.userId))
        .unique();
      if (stat) {
        await ctx.db.patch(stat._id, {
          username: r.username, // keep the display name current
          kills: stat.kills + r.roundKills,
          deaths: stat.deaths + r.roundDeaths,
          headshots: stat.headshots + r.headshots,
          wins: stat.wins + (r.won ? 1 : 0),
          matchesPlayed: stat.matchesPlayed + 1,
          bestRoundKills: Math.max(stat.bestRoundKills, r.roundKills),
          lastSeen: now,
        });
      } else {
        // sign-up seeds a stats row, but be defensive if one's missing
        await ctx.db.insert("stats", {
          userId: r.userId,
          username: r.username,
          kills: r.roundKills,
          deaths: r.roundDeaths,
          headshots: r.headshots,
          wins: r.won ? 1 : 0,
          matchesPlayed: 1,
          bestRoundKills: r.roundKills,
          lastSeen: now,
        });
      }
      await ctx.db.insert("matches", {
        userId: r.userId,
        username: r.username,
        roundKills: r.roundKills,
        roundDeaths: r.roundDeaths,
        headshots: r.headshots,
        won: r.won,
        finishedAt: now,
      });
    }
  },
});

// Top players by lifetime kills, for the intro screen's public board.
export const leaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("stats")
      .withIndex("by_kills")
      .order("desc")
      .take(Math.min(limit ?? 20, 100));
    return rows.map((s) => ({
      userId: s.userId,
      username: s.username,
      kills: s.kills,
      deaths: s.deaths,
      headshots: s.headshots,
      wins: s.wins,
      matchesPlayed: s.matchesPlayed,
      bestRoundKills: s.bestRoundKills,
    }));
  },
});

// A single player's career, for their own intro/post-match panel.
export const myStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const s = await ctx.db
      .query("stats")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!s) return null;
    return {
      username: s.username,
      kills: s.kills,
      deaths: s.deaths,
      headshots: s.headshots,
      wins: s.wins,
      matchesPlayed: s.matchesPlayed,
      bestRoundKills: s.bestRoundKills,
    };
  },
});
