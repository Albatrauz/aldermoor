/* ============================ Convex read client ============================ */
// A single reactive client for the leaderboard and the player's own career
// stats. Reads stream in over a WebSocket via `convex.onUpdate`. Sign-up/in and
// other one-shot calls go through ConvexHttpClient in auth.js instead.
//
// Functions are referenced through `anyApi` (e.g. api.stats.leaderboard) so the
// browser bundle never depends on the generated `convex/_generated` — the same
// names are resolved by string on the wire. VITE_CONVEX_URL is baked in at
// build time; when it's absent the client is null and the game runs guest-only.
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

const URL = import.meta.env.VITE_CONVEX_URL || "";
export const api = anyApi;
export const convex = URL ? new ConvexClient(URL) : null;
export const hasConvex = !!convex;

if (!hasConvex) {
  console.info("[convex] VITE_CONVEX_URL not set — accounts & stats disabled (guest-only).");
}
