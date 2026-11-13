// ============================ levels, unlocks & loadouts ============================
// The Convex face of convex/lib/progression.js (where the rules live).
//
// Two kinds of data, two kinds of authority:
//   • XP is EARNED. It sits on `stats.xp` and is written only by the game server
//     through stats.recordMatch (guarded by SERVER_SHARED_SECRET).
//   • A loadout is CHOSEN. It sits in `profiles` and is written by its owner
//     through `equip`, which proves ownership with the session token and checks
//     every pick against what the player has actually unlocked.
// Everything here that reads is public: levels and looks are no more secret than
// the leaderboard.
import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  ITEMS,
  SLOTS,
  XP_SOURCES,
  isSlot,
  itemById,
  levelInfo,
  ownsItem,
  publicLook,
  wornItem,
  xpOf,
} from "./lib/progression";

async function statFor(ctx, userId) {
  return await ctx.db
    .query("stats")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}
async function profileFor(ctx, userId) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}
async function userByName(ctx, username) {
  const key = String(username || "").replace(/\s+/g, " ").trim().toLowerCase();
  const user = await ctx.db
    .query("users")
    .withIndex("by_username", (q) => q.eq("username", key))
    .unique();
  if (!user) throw new ConvexError(`No account named "${username}".`);
  return user;
}

// A player's whole progression, ready to render: level and progress, how XP is
// earned, and every slot with its items marked owned / worn / equipped.
export const mine = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const info = levelInfo(xpOf(await statFor(ctx, userId)));
    const profile = await profileFor(ctx, userId);

    const slots = SLOTS.map((slot) => {
      const worn = wornItem(slot.id, info.level, profile);
      const equipped = profile?.loadout?.[slot.id] ?? null;
      return {
        ...slot,
        // `equipped` is the player's explicit pick; `worn` also counts the default
        equipped: worn && worn.id === equipped ? equipped : null,
        worn: worn?.id ?? null,
        items: ITEMS.filter((i) => i.slot === slot.id)
          .map((i) => ({
            id: i.id,
            name: i.name,
            level: i.level,
            color: i.color ?? null,
            owned: ownsItem(i, info.level, profile),
          }))
          // the level track in order, then granted-only items — hidden until owned
          .filter((i) => i.level != null || i.owned)
          .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity)),
      };
    });

    // the next thing the level track hands out, for the "next reward" line
    const next = ITEMS.filter((i) => i.level != null && i.level > info.level)
      .sort((a, b) => a.level - b.level)[0];

    return {
      ...info,
      title: wornItem("title", info.level, profile)?.name ?? "",
      slots,
      next: next ? { name: next.name, level: next.level, slot: next.slot } : null,
      sources: XP_SOURCES,
    };
  },
});

// What the game server needs to show a player to the others: level, title and
// tunic colour. Read on connect and again whenever the player says their
// loadout changed.
export const look = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    publicLook(xpOf(await statFor(ctx, userId)), await profileFor(ctx, userId)),
});

// Put an item on (or, with itemId null, take the slot's item off). The session
// token proves who is asking; nothing is trusted about what they may wear.
export const equip = mutation({
  args: { token: v.string(), slot: v.string(), itemId: v.union(v.string(), v.null()) },
  handler: async (ctx, { token, slot, itemId }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!session || session.expiresAt < Date.now()) throw new ConvexError("Sign in again to change your gear.");
    if (!isSlot(slot)) throw new ConvexError("No such slot.");

    const userId = session.userId;
    const profile = await profileFor(ctx, userId);
    if (itemId !== null) {
      const item = itemById(itemId);
      if (!item || item.slot !== slot) throw new ConvexError("No such item.");
      const { level } = levelInfo(xpOf(await statFor(ctx, userId)));
      if (!ownsItem(item, level, profile)) throw new ConvexError("You have not earned that yet.");
    }

    const loadout = { ...(profile?.loadout ?? {}) };
    if (itemId === null) delete loadout[slot];
    else loadout[slot] = itemId;
    if (profile) await ctx.db.patch(profile._id, { loadout, updatedAt: Date.now() });
    else await ctx.db.insert("profiles", { userId, loadout, grants: [], updatedAt: Date.now() });
  },
});

/* ---- operator tools (internal: dashboard or `npx convex run` only) ---- */
// Hand a player an item outside the level track — the hook for events, feats
// and favours:
//   npx convex run progression:adminGrantItem '{"username":"Name","itemId":"title.old-guard"}'
export const adminGrantItem = internalMutation({
  args: { username: v.string(), itemId: v.string() },
  handler: async (ctx, { username, itemId }) => {
    if (!itemById(itemId)) throw new ConvexError(`No item "${itemId}" in the catalog.`);
    const user = await userByName(ctx, username);
    const profile = await profileFor(ctx, user._id);
    const grants = [...new Set([...(profile?.grants ?? []), itemId])];
    if (profile) await ctx.db.patch(profile._id, { grants, updatedAt: Date.now() });
    else await ctx.db.insert("profiles", { userId: user._id, loadout: {}, grants, updatedAt: Date.now() });
    return { username: user.displayUsername, grants };
  },
});

// Add (or with a negative amount, take back) XP by hand:
//   npx convex run progression:adminGrantXp '{"username":"Name","amount":500}'
export const adminGrantXp = internalMutation({
  args: { username: v.string(), amount: v.number() },
  handler: async (ctx, { username, amount }) => {
    const user = await userByName(ctx, username);
    const stat = await statFor(ctx, user._id);
    if (!stat) throw new ConvexError(`"${username}" has no stats row.`);
    const xp = Math.max(0, Math.floor(xpOf(stat) + amount));
    await ctx.db.patch(stat._id, { xp });
    return { username: user.displayUsername, ...levelInfo(xp) };
  },
});
