// ============================ accounts & sessions ============================
// A small custom username+password auth. Hashing and token generation need real
// randomness, so they live in `action`s (the default Convex runtime ships Web
// Crypto: crypto.subtle + crypto.getRandomValues). Actions can't touch the DB
// directly, so they call the internal mutations/queries below via ctx.run*.
//
// server.js trades a session token for an identity through `userByToken`; the
// browser keeps the token in localStorage. Usernames are fixed: set once at
// sign-up, with no rename function exposed anywhere.
import {
  action,
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
// OWASP-recommended floor for PBKDF2-HMAC-SHA256. NOTE: this count is baked into
// every stored hash — changing it later won't verify existing passwords, so a
// bump after accounts exist needs a migration (or rehash-on-successful-login).
const PBKDF2_ITERATIONS = 600_000;

/* ---- crypto helpers (Web Crypto, available in the default action runtime) ---- */
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(n) {
  return toHex(crypto.getRandomValues(new Uint8Array(n)));
}
async function derive(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}
// constant-time compare for equal-length hex digests
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- username rules (mirror cleanName/charset in server.js) ---- */
const USERNAME_RE = /^[\p{L}\p{N} _.'-]{3,20}$/u;
function normalizeUsername(raw) {
  const display = String(raw || "").replace(/\s+/g, " ").trim();
  return { display, key: display.toLowerCase() };
}

/* ---- public actions: sign up / sign in ---- */
export const signUp = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }) => {
    const { display, key } = normalizeUsername(username);
    if (!USERNAME_RE.test(display))
      throw new Error("Username must be 3–20 of: letters, numbers, space _ . ' -");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");

    const taken = await ctx.runQuery(internal.auth.userByUsernameKey, { key });
    if (taken) throw new Error("That name is already taken.");

    const salt = randomHex(16);
    const passwordHash = await derive(password, salt);
    const token = randomHex(32);
    await ctx.runMutation(internal.auth.createUserAndSession, {
      username: key,
      displayUsername: display,
      passwordHash,
      salt,
      token,
    });
    return { token, username: display };
  },
});

export const signIn = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }) => {
    const { key } = normalizeUsername(username);
    const user = await ctx.runQuery(internal.auth.userByUsernameKey, { key });
    // same message either way — don't reveal which accounts exist
    const fail = "No such account, or the password is wrong.";
    if (!user) throw new Error(fail);
    const hash = await derive(password, user.salt);
    if (!safeEqual(hash, user.passwordHash)) throw new Error(fail);

    const token = randomHex(32);
    await ctx.runMutation(internal.auth.createSession, { userId: user._id, token });
    return { token, username: user.displayUsername };
  },
});

/* ---- public query/mutation: who-is-this / log out ---- */
export const userByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!session || session.expiresAt < Date.now()) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return { userId: user._id, username: user.displayUsername };
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

/* ---- internal helpers (only callable by other Convex functions) ---- */
export const userByUsernameKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", key))
      .unique(),
});

export const createUserAndSession = internalMutation({
  args: {
    username: v.string(),
    displayUsername: v.string(),
    passwordHash: v.string(),
    salt: v.string(),
    token: v.string(),
  },
  handler: async (ctx, a) => {
    // re-check inside the transaction: two sign-ups racing for the same name
    const clash = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", a.username))
      .unique();
    if (clash) throw new Error("That name is already taken.");

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      username: a.username,
      displayUsername: a.displayUsername,
      passwordHash: a.passwordHash,
      salt: a.salt,
      createdAt: now,
    });
    await ctx.db.insert("sessions", {
      token: a.token,
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    // seed a zeroed career so the leaderboard/profile have a row from day one
    await ctx.db.insert("stats", {
      userId,
      username: a.displayUsername,
      kills: 0,
      deaths: 0,
      headshots: 0,
      wins: 0,
      matchesPlayed: 0,
      bestRoundKills: 0,
      weaponKills: [],
      weaponHeadshots: [],
      lastSeen: now,
    });
  },
});

export const createSession = internalMutation({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => {
    const now = Date.now();
    await ctx.db.insert("sessions", {
      token,
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
  },
});
