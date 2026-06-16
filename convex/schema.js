// ============================ Convex schema ============================
// The persistence layer behind the game's accounts and stats. The live game
// (positions, shots, kills) still flows through server.js over WebSocket —
// Convex only stores who you are and what you've done across matches.
//
// Auth secrets (passwordHash/salt) live ONLY in `users`. The leaderboard reads
// `stats`, which carries no secrets, so public queries can return whole rows.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per account. `username` is normalized (lowercase) and unique;
  // `displayUsername` keeps the casing the player chose, for the scoreboard.
  users: defineTable({
    username: v.string(),
    displayUsername: v.string(),
    passwordHash: v.string(), // hex PBKDF2-derived key
    salt: v.string(), // hex random salt
    createdAt: v.number(),
  }).index("by_username", ["username"]),

  // Bearer tokens handed to the browser on sign-in. server.js trades a token
  // for an identity via auth.userByToken; the client keeps it in localStorage.
  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // Lifetime aggregates, written server-authoritatively by server.js. K/D and
  // headshot % are derived on read, never stored, so they can't drift.
  stats: defineTable({
    userId: v.id("users"),
    username: v.string(), // denormalized display name for the leaderboard
    kills: v.number(),
    deaths: v.number(),
    headshots: v.number(),
    wins: v.number(),
    matchesPlayed: v.number(),
    bestRoundKills: v.number(),
    lastSeen: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_username", ["username"])
    .index("by_kills", ["kills"]),

  // Append-only history: one row per finished round per participant. Lets us
  // rebuild `stats` if it ever drifts, and powers a future match-history view.
  matches: defineTable({
    userId: v.id("users"),
    username: v.string(),
    roundKills: v.number(),
    roundDeaths: v.number(),
    headshots: v.number(),
    won: v.boolean(),
    finishedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_finishedAt", ["finishedAt"]),
});
