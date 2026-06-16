# Aldermoor

A small first-person three.js game — a medieval market town at dusk — with a
tiny Node WebSocket server for drop-in multiplayer.

## Run it

```sh
npm install      # installs three, ws, and vite

npm run dev      # Vite dev server with HMR on http://localhost:5173
```

Then open the printed URL and click **Enter the Gates**. The multiplayer
WebSocket game runs on the same port (mounted on Vite's dev server at `/ws`),
so live-editing the `src/` modules hot-reloads while you stay in town.

### Production

```sh
npm run build    # bundles the client into dist/
npm start        # serves dist/ + the WebSocket game on http://localhost:4174
```

`PORT` overrides the port for both `npm run dev` and `npm start`.

## Accounts & stats (Convex)

Optional but recommended: a [Convex](https://convex.dev) backend adds player
**accounts with a fixed username** and **persistent stats** (kills, deaths, K/D,
wins, matches, headshots) plus a **public leaderboard**. Without it the game runs
exactly as before — anonymous, guest-only, no stats.

The live game still runs over the WebSocket relay in `server.js`; Convex is only
touched to verify a player's session token on join and to flush match results at
round end. Stats are written **server-authoritatively** (guarded by a shared
secret), so a client can't forge them.

### First-time setup

1. **Create the deployment** — one-time, interactive (opens a browser to log in):

   ```sh
   npx convex dev
   ```

   This creates a Convex project, writes `CONVEX_DEPLOYMENT` to `.env.local`, and
   prints your deployment URL (e.g. `https://your-app-123.convex.cloud`). Leave it
   running — it pushes the `convex/` functions and watches for changes.

2. **Fill in `.env.local`** (copy `.env.example`) with that URL + a secret:

   ```sh
   VITE_CONVEX_URL=https://your-app-123.convex.cloud   # browser read client
   CONVEX_URL=https://your-app-123.convex.cloud        # server.js
   SERVER_SHARED_SECRET=<a long random string>         # guards stat writes
   ```

3. **Give Convex the same secret** so the stat-write mutation trusts the server:

   ```sh
   npx convex env set SERVER_SHARED_SECRET <the same long random string>
   ```

4. **Run both** (separate terminals): `npm run convex:dev` and `npm run dev`.

Sign up on the intro screen to claim a fixed username; play a round and your
stats persist and climb the leaderboard. Guests can still jump in with a free
name — they just aren't tracked. Set `ALLOW_GUESTS=false` to require an account.

### Production (Convex Cloud)

Deploy the functions once per release, then build/run the game as usual:

```sh
npx convex deploy        # pushes convex/ to the prod deployment (needs CONVEX_DEPLOY_KEY)
```

In Coolify, set `VITE_CONVEX_URL` at **build** time (a build arg — Vite inlines it
into the bundle), and `CONVEX_URL` + `SERVER_SHARED_SECRET` (and optional
`ALLOW_GUESTS=false`) at **runtime**. Also set `SERVER_SHARED_SECRET` in the
Convex deployment env. The game's Docker image needs only the `convex` npm
package (already a dependency) — the functions live in Convex Cloud, not the image.

## Layout

```
index.html       markup + font links; loads src/main.js (Vite is the entry point)
styles.css       all UI / HUD styling
vite.config.mjs  Vite config; mounts the game's WebSocket server on the dev server
server.js        production static (dist/) server + multiplayer WebSocket relay
src/             the browser game, split into ES modules
convex/          Convex backend functions: schema, auth, stats (deployed separately)
```

`server.js` exports `attachGame(httpServer)` — the WebSocket game logic — which
is shared by both the Vite dev server (in `vite.config.mjs`) and the production
server, so dev and prod run identical multiplayer code on the `/ws` path.

### Client modules (`src/`)

Loaded as ES modules; `three` is a regular npm dependency resolved by Vite. The
dependency flow runs roughly top-to-bottom:

| Module          | Responsibility |
|-----------------|----------------|
| `core.js`       | renderer, scene, camera, seeded RNG, low-level geometry helpers |
| `textures.js`   | procedurally painted canvas textures |
| `materials.js`  | shared materials built from those textures |
| `world.js`      | builds the entire static town (one-time on import) + per-frame ambient animation |
| `audio.js`      | synthesized black-powder / UI sounds (WebAudio) |
| `effects.js`    | transient tracers / muzzle flashes / smoke + ray-cast hit tests |
| `hud.js`        | score tally, health bar, hit/hurt flourishes, death summary |
| `zones.js`      | named places and their parchment toasts |
| `controls.js`   | player state, input, collision, first-person movement |
| `villagers.js`  | other players: model, name tags, snapshot interpolation |
| `convex.js`     | reactive Convex read client (leaderboard / career); `null` without `VITE_CONVEX_URL` |
| `auth.js`       | sign-up / sign-in, the session token, and the intro account panel |
| `net.js`        | WebSocket link + inbound message routing; hands the session token to the server |
| `combat.js`     | handgonne viewmodel, firing, hit/kill handling |
| `stats.js`      | reactive leaderboard + own-career rendering on the intro screen |
| `main.js`       | entry point: wires the render loop and the `window.__town` debug hook |

> **Note on `world.js`:** the town is laid out by a seeded RNG, so the order of
> the build steps is load-bearing — reordering them reshuffles the whole town.

## Debug hook

The client exposes `window.__town` for automated checks: `hideIntro()`,
`fire()`, `teleport(x, z, yaw, pitch)`, `over(stats)` / `restart()` (raise and
clear the end-of-round overview), and getters `pos`, `me`, `remotes`.

## Rounds

A contest runs to **15 kills** (`KILL_CAP` in `server.js`). The first player to
reach it wins: the server freezes scoring, broadcasts the final tally, and every
client raises the overview screen with a **20-second** countdown
(`RESTART_DELAY`). When it elapses the server wipes all scores, sends everyone
back to the gates, and a fresh contest begins. Players who join mid-overview are
shown it too, with the countdown's remaining time.
