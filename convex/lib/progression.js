// ============================ progression rules ============================
// The single source of truth for levels: what earns XP, how much XP a level
// costs, and what each level unlocks. Pure functions and plain data — no Convex
// imports — so the same file is read by the mutations that award XP, the
// queries that describe it to the browser, and a plain `node` test.
//
// Only TOTAL xp is ever stored (stats.xp). Level, progress and unlocks are
// derived from it on read, so every number below can be retuned later without
// touching a single row.

/* ---- what earns XP ---- */
// Awarded per finished round, from the tally the game server already keeps.
export const XP = {
  kill: 100,        // every enemy felled
  headshot: 50,     // …on top, when the felling ball found the head
  grenadeKill: 50,  // …on top, when a grenade did it
  roundPlayed: 150, // saw the round through to the final tally (and took part)
  win: 300,         // first to the kill cap
};
// The same table with player-facing labels, in the order the UI lists it.
export const XP_SOURCES = [
  { key: "kill", label: "Enemy felled", xp: XP.kill },
  { key: "headshot", label: "Headshot bonus", xp: XP.headshot },
  { key: "grenadeKill", label: "Grenade bonus", xp: XP.grenadeKill },
  { key: "roundPlayed", label: "Round seen through", xp: XP.roundPlayed },
  { key: "win", label: "Round won", xp: XP.win },
];
// Slot of the grenade in the per-weapon tallies — mirrors W_GRENADE in server.js.
const GRENADE_SLOT = 2;

/* ---- the level curve ---- */
// Level L → L+1 costs 500 + 250·(L−1) XP: 500, 750, 1000, … so each level asks
// one more "good half-round" than the last. Cumulative XP to REACH level L is
// the closed form 125·(L−1)·(L+2):
//   L2 500 · L5 3 500 · L10 13 500 · L20 52 250 · L30 116 000 · L50 318 500
// An average round is worth ~750 XP and a win ~1 600, so that is roughly
// 1 round to L2, ~1 h to L10, ~5 h to L20 and ~30 h to the cap.
export const MAX_LEVEL = 50;
export const xpToNext = (level) => 500 + 250 * (level - 1);
export const xpForLevel = (level) => 125 * (level - 1) * (level + 2);

export function levelForXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

// Everything a progress bar needs. XP keeps counting past the cap (the total is
// the truth, and a later prestige tier can spend it), but the bar reads full.
export function levelInfo(rawXp) {
  const xp = Math.max(0, Math.floor(rawXp || 0));
  const level = levelForXp(xp);
  const atCap = level >= MAX_LEVEL;
  const need = atCap ? 0 : xpToNext(level);
  const into = atCap ? 0 : xp - xpForLevel(level);
  return { xp, level, into, need, atCap, maxLevel: MAX_LEVEL };
}

/* ---- scoring a round ---- */
const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// `r` is one player's match result as server.js reports it. Returns the total
// and the line items behind it (only the lines that paid out).
export function xpForRound(r) {
  const kills = n(r.roundKills);
  const heads = Math.min(n(r.headshots), kills);
  const nades = Math.min(n((r.weaponKills || [])[GRENADE_SLOT]), kills);
  // Seeing a round through pays only if you took part in it — standing in the
  // field untouched for a whole round earns nothing. An older game server that
  // doesn't send `completed` yet is taken to mean "finished".
  const played = (r.completed ?? true) && kills + n(r.roundDeaths) > 0;
  const parts = [
    { key: "kill", count: kills, xp: kills * XP.kill },
    { key: "headshot", count: heads, xp: heads * XP.headshot },
    { key: "grenadeKill", count: nades, xp: nades * XP.grenadeKill },
    { key: "roundPlayed", count: played ? 1 : 0, xp: played ? XP.roundPlayed : 0 },
    { key: "win", count: r.won ? 1 : 0, xp: r.won ? XP.win : 0 },
  ]
    .filter((p) => p.xp > 0)
    .map((p) => ({ ...p, label: XP_SOURCES.find((s) => s.key === p.key).label }));
  return { total: parts.reduce((sum, p) => sum + p.xp, 0), parts };
}

// XP a career would have earned had progression always existed, rebuilt from
// the lifetime aggregates. Used for accounts older than the feature: by the
// backfill migration, and as the read-time fallback until it has run.
export function retroXp(stat) {
  return (
    n(stat.kills) * XP.kill +
    n(stat.headshots) * XP.headshot +
    n((stat.weaponKills || [])[GRENADE_SLOT]) * XP.grenadeKill +
    n(stat.matchesPlayed) * XP.roundPlayed +
    n(stat.wins) * XP.win
  );
}
export const xpOf = (stat) => (stat ? stat.xp ?? retroXp(stat) : 0);

/* ---- the catalog: everything a player can own and wear ---- */
// A SLOT is one place on a player something can be equipped. Adding a kind of
// customisation = add a slot here, add items for it below, and teach the game
// to draw it (see publicLook). Nothing in the database changes.
export const SLOTS = [
  { id: "title", label: "Titles", blurb: "worn beside your name" },
  { id: "tunic", label: "Tunics", blurb: "the cloth you take the field in" },
];

// An ITEM belongs to one slot and is owned either by reaching `level`, or — when
// `level` is null — only by being granted (profiles.grants: events, feats, the
// operator's favour). Item ids are stored in rows, so never rename or reuse one;
// retire an item by deleting it here (a stale id in a loadout is simply ignored).
// Extra fields are the item's payload: a tunic carries its `color`.
export const ITEMS = [
  // titles — the rank ladder. With nothing equipped you wear the highest you own.
  { id: "title.stranger", slot: "title", name: "Stranger", level: 1 },
  { id: "title.recruit", slot: "title", name: "Recruit", level: 2 },
  { id: "title.footman", slot: "title", name: "Footman", level: 4 },
  { id: "title.man-at-arms", slot: "title", name: "Man-at-Arms", level: 7 },
  { id: "title.serjeant", slot: "title", name: "Serjeant", level: 10 },
  { id: "title.handgonner", slot: "title", name: "Handgonner", level: 14 },
  { id: "title.veteran", slot: "title", name: "Veteran", level: 18 },
  { id: "title.captain", slot: "title", name: "Captain", level: 22 },
  { id: "title.knight", slot: "title", name: "Knight", level: 27 },
  { id: "title.banneret", slot: "title", name: "Banneret", level: 32 },
  { id: "title.marshal", slot: "title", name: "Marshal", level: 38 },
  { id: "title.warden", slot: "title", name: "Warden of the Sand", level: 44 },
  { id: "title.champion", slot: "title", name: "Champion of Aldermoor", level: 50 },
  { id: "title.old-guard", slot: "title", name: "Old Guard", level: null }, // granted only

  // tunics — with nothing equipped the server hands out a cloth by seat, as before
  { id: "tunic.madder", slot: "tunic", name: "Madder Red", level: 3, color: 0x9c2f2a },
  { id: "tunic.woad", slot: "tunic", name: "Woad Blue", level: 6, color: 0x2f4f8a },
  { id: "tunic.forest", slot: "tunic", name: "Forest Green", level: 9, color: 0x2f6b3a },
  { id: "tunic.saffron", slot: "tunic", name: "Saffron", level: 12, color: 0xc99a2e },
  { id: "tunic.tyrian", slot: "tunic", name: "Tyrian Purple", level: 16, color: 0x6a2c70 },
  { id: "tunic.bone", slot: "tunic", name: "Bone White", level: 20, color: 0xd9cfb8 },
  { id: "tunic.charcoal", slot: "tunic", name: "Charcoal", level: 25, color: 0x2a2a2e },
  { id: "tunic.verdigris", slot: "tunic", name: "Verdigris", level: 30, color: 0x2aa6a0 },
  { id: "tunic.ember", slot: "tunic", name: "Ember Orange", level: 36, color: 0xd2601f },
  { id: "tunic.rose", slot: "tunic", name: "Damask Rose", level: 42, color: 0xc4587e },
  { id: "tunic.gold", slot: "tunic", name: "Cloth of Gold", level: 50, color: 0xd8a948 },
];

const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id) => ITEM_BY_ID.get(id) || null;
export const isSlot = (slot) => SLOTS.some((s) => s.id === slot);

// `profile` is the player's profiles row, or null if they never made one.
export function ownsItem(item, level, profile) {
  if (!item) return false;
  if (item.level != null && level >= item.level) return true;
  return !!profile && (profile.grants || []).includes(item.id);
}

// The item actually worn in a slot: the equipped one if it is still owned and
// still exists, else the slot's default (titles fall back to the highest rank
// reached; every other slot falls back to nothing).
export function wornItem(slot, level, profile) {
  const picked = itemById(profile?.loadout?.[slot]);
  if (picked && picked.slot === slot && ownsItem(picked, level, profile)) return picked;
  if (slot !== "title") return null;
  let best = null;
  for (const i of ITEMS) {
    if (i.slot === "title" && i.level != null && i.level <= level && (!best || i.level > best.level)) best = i;
  }
  return best;
}

// What the game server (and through it every other player) needs to draw
// someone. A new slot that shows in the field gets its line here.
export function publicLook(xp, profile) {
  const { level } = levelInfo(xp);
  return {
    level,
    title: wornItem("title", level, profile)?.name ?? "",
    color: wornItem("tunic", level, profile)?.color ?? null,
  };
}

// Level-gated items first reached in the half-open range (fromLevel, toLevel].
export function unlockedBetween(fromLevel, toLevel) {
  return ITEMS.filter((i) => i.level != null && i.level > fromLevel && i.level <= toLevel)
    .sort((a, b) => a.level - b.level)
    .map((i) => ({ id: i.id, slot: i.slot, name: i.name, level: i.level }));
}
