// ============================ data migrations ============================
// One-off backfills, run by hand after a deploy that needs them:
//   npx convex run migrations:<name>            (dev deployment)
//   npx convex run migrations:<name> --prod     (production)
// Each one is idempotent — running it twice changes nothing the second time —
// and walks its table in bounded pages, rescheduling itself until done, so a
// large table can never blow Convex's per-transaction limits.
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { retroXp } from "./lib/progression";

const PAGE = 200;

// Levels arrived after accounts did. Give every career that predates them the
// XP it would have earned (see retroXp), so nobody restarts at level 1 and the
// by_xp index orders old and new players alike. Reads already fall back to the
// same figure, so the game is correct before this has run — the migration only
// makes the number real. Rows that already carry `xp` are left alone.
export const backfillXp = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("stats").paginate({ numItems: PAGE, cursor: cursor ?? null });
    let patched = 0;
    for (const stat of page.page) {
      if (stat.xp !== undefined) continue;
      await ctx.db.patch(stat._id, { xp: retroXp(stat) });
      patched++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillXp, { cursor: page.continueCursor });
    }
    console.log(`backfillXp: ${patched} of ${page.page.length} rows given xp${page.isDone ? " — done" : ", continuing…"}`);
    return { scanned: page.page.length, patched, done: page.isDone };
  },
});
