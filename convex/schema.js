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
    // Last client IP seen when this account connected to the game, and when.
    // Written ONLY by server.js (the sole place with the real request IP) via
    // auth.recordLogin. Optional so a schema push never fails against rows
    // created before these fields existed.
    lastIp: v.optional(v.string()),
    lastLoginAt: v.optional(v.number()),
  }).index("by_username", ["username"]),

  // Bearer tokens handed to the browser on sign-in. server.js trades a token
  // for an identity via auth.userByToken; the client keeps it in localStorage.
  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"]) // lets the cleanup cron find expired sessions cheaply
    .index("by_userId", ["userId"]), // lets a password reset sign an account out everywhere

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
    // per-weapon lifetime tallies, indexed by weapon id (0=handgonne, 1=ak47).
    // Arrays grow as weapons are added — no schema change needed. Optional so a
    // schema push never fails against rows created before these fields existed;
    // reads default to [] (see myStats / addArr).
    weaponKills: v.optional(v.array(v.number())),
    weaponHeadshots: v.optional(v.array(v.number())),
    // Lifetime experience — the ONE stored progression number. Level, progress
    // and unlocks are all derived from it (convex/lib/progression.js), so the
    // curve can be retuned without touching rows. Optional because accounts
    // predate it: reads fall back to retroXp(stat), and migrations:backfillXp
    // writes that figure in for good.
    xp: v.optional(v.number()),
    lastSeen: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_username", ["username"])
    .index("by_kills", ["kills"])
    .index("by_xp", ["xp"]), // for a levels board; rows without xp sort first until backfilled

  // What a player has chosen to wear, and what they own beyond their level.
  // Kept apart from `stats` on purpose: stats are written only by the game
  // server, a profile is written by its owner (progression.equip). Created
  // lazily on the first equip or grant — no row simply means "all defaults".
  profiles: defineTable({
    userId: v.id("users"),
    // slot id → item id (see SLOTS / ITEMS in convex/lib/progression.js). A
    // record rather than fixed fields so a new slot needs no schema change.
    loadout: v.record(v.string(), v.string()),
    // item ids owned by grant rather than by level (events, feats, favours)
    grants: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Append-only history: one row per finished round per participant. Lets us
  // rebuild `stats` if it ever drifts, and powers a future match-history view.
  matches: defineTable({
    userId: v.id("users"),
    username: v.string(),
    roundKills: v.number(),
    roundDeaths: v.number(),
    headshots: v.number(),
    weaponKills: v.optional(v.array(v.number())),
    weaponHeadshots: v.optional(v.array(v.number())),
    won: v.boolean(),
    // false when the player left before the final tally. Optional: older rows
    // (and an older game server) don't carry it.
    completed: v.optional(v.boolean()),
    xp: v.optional(v.number()), // XP this round paid out — the audit trail behind stats.xp
    finishedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_finishedAt", ["finishedAt"]),
});
