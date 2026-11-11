# Aldermoor

A small first-person three.js shooter with a tiny Node WebSocket server for
drop-in multiplayer — played in a **destructible voxel world**. Every wall,
crate, car and patch of ground is made of 25 cm voxels: shots knock real holes
in them, and anything cut loose from the ground comes down as rubble.

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
wins, matches, headshots, and a per-weapon kill/headshot breakdown) plus a
**public leaderboard**. Without it the game runs
exactly as before — anonymous, guest-only, no stats.

The live game still runs over the WebSocket relay in `server.js`; Convex is only
touched to verify a player's session token on join and to flush match results at
round end. Stats are written **server-authoritatively** (guarded by a shared
secret), so a client can't forge them. Two daily Convex crons keep things tidy:
pruning expired sessions and match history older than 90 days (see
`convex/crons.js` / `convex/maintenance.js`).

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

### Resetting a player's password

Accounts have no e-mail on file, so players can't reset their own password — the
operator does, with an internal action that the browser cannot call:

```sh
npx convex run auth:adminResetPassword '{"username":"Wat the Cooper","newPassword":"a-new-one"}'
# against production: add --prod
```

(or Functions → `auth:adminResetPassword` → Run function in the Convex dashboard.)
It hashes the new password exactly as sign-up does and signs the account out
everywhere, so any session opened with the old password stops working. Tell the
player the new password yourself; they can sign in with it straight away. The
first deploy after this change adds a `by_userId` index on `sessions`, which
Convex builds on its own.

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
| `world.js`      | map manager: shared sky/sun/fog, builds the active map and hands it to the voxel engine |
| `mapkit.js`, `maps/` | the map toolkit and the two maps, described as boxes, ramps and props |
| `voxel/`        | the voxel engine — see below |
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
| `grenades.ts`   | grenades: cooking on G, the fuse ring and trajectory arc, bounce flights, blasts |
| `stats.js`      | reactive leaderboard + own-career rendering on the intro screen |
| `main.js`       | entry point: wires the render loop and the `window.__town` debug hook |
| `visitor.js`    | bird's-eye camera and the top-down capture of a map |

### The voxel engine (`src/voxel/`)

The maps are still authored as plain boxes, ramps and cylinders. At load the
engine rasterises that description into voxels and discards the original meshes;
from then on the voxels are the world — what is drawn, shot, walked on and
destroyed. The rules of play (speeds, step height, weapons, the wire protocol,
the server) are the same as before; they are simply measured against voxels.

| Module           | Responsibility |
|------------------|----------------|
| `grid.js`        | the voxel array itself, plus ray traversal and the column queries movement uses |
| `palette.js`     | voxel materials, and the patterns that stand in for the old textures (masonry courses, window grids, crate frames) |
| `voxelize.js`    | map → voxels: a fine 0.25 m grid for the playable block, a coarse 1 m backdrop beyond the walls |
| `mesher.js`      | greedy meshing with baked ambient occlusion |
| `chunks.js`      | 32³ chunk meshes; only the chunks a hit touches are re-meshed |
| `material.js`    | the one shader that draws every voxel (per-voxel tint and outlines, computed per pixel) |
| `destruction.js` | carving, the support check, falling islands and debris |
| `rig.js`         | rebuilds the round parts of player and weapon models out of small blocks |
| `index.js`       | the facade the rest of the game calls: floor/wall queries, shot traces, shot damage |
| `skylight.js`    | how much sky each voxel sees: dims ambient light indoors, updates as walls come down |

**How destruction works.** A hit removes a ragged sphere of voxels — larger for
the handgonne than the AK, larger in wood and snow than in steel — and scorches
the rim. The voxels around the hole are then flood-filled toward the ground; any
group that can no longer reach it is lifted out of the grid as a rigid *island*
that falls, tumbles and shatters into debris cubes on impact.

**What can't be broken.** Bedrock, and the outer boundary walls a few layers
behind their inner face. A map can also mark inner walls `barrier: true` (see
`wallX` / `wallZ` in `mapkit.js`): walls that edge the playable lanes with open
ground or a sealed-off block behind them. A barrier takes damage from both
faces, but a core through its middle is locked from bedrock to its top, so no
hole ever goes all the way through. At most half a metre is diggable from each
face, less than the player's radius, so the notches never make a foothold to
climb over it. On Dust2 these are the walls around every lane and around the
four blocks between them.

**Light.** Every voxel of air stores how much open sky it can see: full under
open sky, fading over about 10 m as it floods sideways and down under cover.
The values live in a 3D texture (one byte per voxel, sharing the grid's memory
layout) that the shaders sample to scale ambient light, so tunnels and rooms
are dim and doorways glow. A carve only ever removes voxels, so light only ever
increases: after each hit the flood is continued from the new hole (a few ms at
most) and just the changed region of the texture is re-uploaded. Players, guns
and debris sample the same texture at their own position. If the GPU cannot
hold a 3D texture the size of the grid, the effect switches itself off.

**Multiplayer.** The server still knows nothing about geometry. Each client
breaks its own copy of the map from `shoot` messages, using only the values in
the message, so the damage is a pure function of the shots and the order they
arrive in. The server fixes that order: it relays every shot it accepts to
everyone, the shooter included, and a client knocks the hole only when the shot
comes back (offline it lands at once). The server also keeps the round's
accepted shots in a list (`shotLog`, capped at 20,000) and sends it in
`welcome`; a client that joins or reconnects mid-round rebuilds the map
undamaged and replays the list silently — about 0.2 s for 5,000 shots — to
arrive at the map everyone else is looking at. The list is cleared, and the
damage with it, when the map rotates at the end of a round.

## Grenades

Every life starts with **two grenades** (the ✹ above the ammo). **Hold G** to
pull the pin: a ring fills round the crosshair over the **5-second** fuse and a
dotted arc shows where the grenade will fly, bounce and come to rest; the ring at
its end turns red once the fuse will run out on that arc. **Let go** to throw it
with whatever fuse is left. Hold on past the end and it goes off in your hand —
certain death, counted as a death with no kill to anyone. While a grenade is in
hand you can't fire, reload or swap arms.

The blast deals up to **140** damage (well over a full bar) within 1.5 m of your
body, falling off with the square of the distance to nothing at 12 m: about 127
at 2 m, 103 at 3 m, 81 at 4 m, 62 at 5 m, 46 at 6 m, 20 at 8 m and 5 at 10 m — it
kills out to about 3 m. Cover counts. Damage is
scaled by how much of you the blast can see: rays to shins, chest and head, so
a wall between you and the grenade saves you and a corner halves it. Your own
grenade hurts you too. It also blows a ragged crater some three and a half metres
across in the world — and nearly three metres up any wall it lies against —
flinging the rubble outward; barrier cores and the outer walls hold as they do against shots.

The blast is built to feel heavy. On screen (`src/effects.ts`): a white flash, a
fireball that cools into smoke, a pressure ring racing 11 m over the ground, a
rolling dust ring, sparks and dirt, a smoke column that hangs for five seconds
and one long-reach light. In the camera (`src/grenades.ts`): noise-driven shake
that scales with distance, a shove away from the blast and a jump in field of
view; a wall between you and it takes most of that away. On the HUD a glare, and
after a close one a dark daze. In the ears (`src/audio.ts`): crack, body, sub
thump, a long rumble and rubble pattering down, delayed and dulled by distance;
inside 6 m everything goes muffled for a few seconds, with a ring.

On the wire the thrower's client works out the flight against its own map and
sends it as keyframes (`nade`: the throw and every bounce, plus the fuse and the
blast point). Everyone draws those same keyframes. The server keeps the fuse and
announces the blast (`boom`), which lands in the same order as shots and goes into
`shotLog` as `[2, x, y, z, 0, 0, 0, 0]`, so late joiners replay the crater too.
The thrower then reports who the blast could see and how much of each
(`nadehit`, once per grenade). The server works out the distance from the
positions it holds and deals the damage. It also enforces the two-per-life
limit, refuses throws from the felled, and kills a player whose grenade cooked
off without waiting to be told. The numbers live in `server.js` (`NADE_*`) and
`src/grenades.ts`.

## Debug hook

The client exposes `window.__town` for automated checks: `hideIntro()`,
`fire()`, `teleport(x, z, yaw, pitch)`, `over(stats)` / `restart()` (raise and
clear the end-of-round overview), and getters `pos`, `me`, `remotes`. For the
voxel world: `voxels()` (quad count, pending re-meshes, live debris and falling
islands, shots applied so far), `grid` (the live voxel grid),
`blast([x,y,z],[dx,dy,dz],len,weapon)` to land a shot on the world without
firing one, `replay(shots)` to land a list of them silently, and
`skyAt(x,y,z)` for the sky light (0–255) at a point. For grenades:
`throwNade(heldFor)` throws one with the current aim as though G had been held
`heldFor` seconds (5 or more cooks it off), and `nades` reports the count left,
whether one is in hand, grenades in flight, and the arc's predicted end.

`captureMap('dust2')` and `captureMap('skidrow')` render a top-down plate of
that map (north up, east right) and download `<map>-top.png`. `captureMaps()`
does both, then puts back the map that was loaded. Each call also returns
`{ name, label, width, height, url }` where `url` is a PNG data URL. The camera
is `visitor`, aimed by `frameVisitor(width, height)` — an orthographic view of
the whole voxel world, kept off the first-person camera so a later map overlay
can render it without moving the player.

### Screenshots (dev server only)

Press **P** while playing under `npm run dev` to save the current view as
`screenshots/<map>-<timestamp>.png` (git-ignored). The HUD is never in the
frame and the gun is hidden for the shot, so the picture is usable as a style
reference — e.g. as input for an image-to-3D tool. From the console,
`__town.screenshot()` does the same and `__town.screenshot({ viewmodel: true })`
keeps the gun in. The PNG is written by the Vite dev server, so neither the key
nor the hook exists in a production build.

## Rounds & the lobby

Connecting puts you in the **lobby** — the intro screen, where the leaderboard
and your dossier live. There you're a spectator: invisible to others, unable to
shoot, and impossible to shoot. You become a live combatant only when you
**Take the Field** (the client sends a `spawn`; the server marks you `active`).
A player reading the leaderboard is never a target.

Once you're on the field, **Esc keeps you in the fight** — it opens the menu but
your body stays put and shootable, so it's no escape hatch from a losing trade.
You return to the safe lobby only two ways: a **felled** player (while the
killscreen counts down) may bow out with Esc, and the **end of a round** sends
everyone back (a `spectate` / `lobby` message). Re-taking the field while still
alive just resumes you in place — no respawn.

A contest runs to **10 kills** (`KILL_CAP` in `server.js`). The first player to
reach it wins: the server freezes scoring and shows every *combatant* the
overview screen with a **20-second** countdown (`RESTART_DELAY`); lobby
spectators keep their menu. When the countdown elapses the server wipes all
scores and sends every combatant back to the **lobby** (a `lobby` message), where
the freshly-updated leaderboard is waiting — no refresh needed. The next contest
begins when players take the field again. Dev practice dummies stay in the field
across rounds so a lone developer always has foes.
