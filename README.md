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

## Layout

```
index.html       markup + font links; loads src/main.js (Vite is the entry point)
styles.css       all UI / HUD styling
vite.config.mjs  Vite config; mounts the game's WebSocket server on the dev server
server.js        production static (dist/) server + multiplayer WebSocket relay
src/             the browser game, split into ES modules
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
| `hud.js`        | score tally, hearts, hit/hurt flourishes |
| `zones.js`      | named places and their parchment toasts |
| `controls.js`   | player state, input, collision, first-person movement |
| `villagers.js`  | other players: model, name tags, snapshot interpolation |
| `net.js`        | WebSocket link + inbound message routing |
| `combat.js`     | handgonne viewmodel, firing, hit/kill handling |
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
