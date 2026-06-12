# Implementation Brief: Reproduce CS:Dust2 in Aldermoor

> Handoff document. Self-contained — assumes the implementing model has **not** explored
> this repo. Read "Codebase orientation" first, then execute Phases 1–4 in order.

---

## 1. Goal & scope (decided with the user)

Replace the medieval-town map in this first-person three.js multiplayer game with a
**faithful reproduction of Counter-Strike's Dust2**, including **real elevation** (climbable
crates, ramps, the raised A site, sunken tunnels). **Keep the existing free-for-all
handgonne combat exactly as-is.** The town is being **replaced**, not kept as an option.

Fidelity target: a **recognizable, pragmatic** recreation — correct lanes, choke points,
sightlines, and iconic props. Not metric-exact to the real BSP.

---

## 2. Codebase orientation

**Stack:** Vanilla JS + `three@^0.160`, bundled by `vite@^5`. Multiplayer via a raw `ws`
WebSocket server. No TypeScript, no test framework.

**Run it:**
- Dev: `npm install && npm run dev` → http://localhost:5173 (Vite HMR; the WebSocket game
  server is mounted on `/ws` by the Vite plugin in `vite.config.mjs`).
- Prod: `npm run build && npm start` → http://localhost:4174.

**Module map** (`src/`, loaded roughly top→bottom):
| File | Responsibility |
|---|---|
| `core.js` | Renderer, scene, camera, `EYE=1.65`, seeded RNG, geom helpers (`mesh`, `prismGeo`, `uvBox`). Scene fog set here. |
| `textures.js` | All textures are **procedurally painted to a 2D canvas** then wrapped as `CanvasTexture`. No image files. |
| `materials.js` | Shared `MeshStandardMaterial`s built from those textures. |
| `world.js` | **The entire static map**, built imperatively on import. Exports `colliders` (array) and `updateAmbient(time)`. Also currently exports `WELL`. |
| `controls.js` | First-person player state, input, jump, and **circle-vs-AABB collision**. Owns `player`. |
| `effects.js` | Tracers, muzzle flash, and the shooting raycaster (`rayAABB`, `rayPlayer`). |
| `combat.js` | Handgonne firing, hit handling, respawn. |
| `zones.js` | Named-area "toasts" (location callouts). Imports `WELL` from world.js. |
| `villagers.js` | Remote-player meshes + interpolation. |
| `net.js` | WebSocket client + message routing. |
| `main.js` | Render loop; calls `world.updateAmbient(time)`, `controls.update`, etc. Exposes `window.__town` debug hooks. |
| `server.js` (root) | Authoritative-ish server: relays positions, validates shots by **distance only**. Knows **nothing** about geometry. |

**Key architectural facts that make this tractable:**
- The map is **100% client-side geometry**. The server never sees it → **no server changes
  needed** for a new map (only the spawn coordinate is worth updating).
- Geometry is plain primitives positioned with `mesh(geo, mat, x,y,z, {ry,rx,rz,cast,receive})`.
  Box centers sit at their center, so a wall of height `H` is placed at `y=H/2`.
- Obstacles register an axis-aligned collider via `addCollider(x,z,hx,hz,h)` — `x,z` =
  center, `hx,hz` = half-extents, `h` = top height (base assumed `y=0`).
- **Collision today is 2D only.** `controls.js collide()` reads `c.x,c.z,c.hx,c.hz` and
  never `c.h`; the player is pinned to a flat `y=0` floor at eye height `1.65`. This is the
  gap Phase 1 closes.

**The two collider consumers** (audit before changing the schema):
1. `controls.js` `collide()` — movement push-out (XZ only).
2. `effects.js` `rayAABB()` — shot/hit raycast; builds the box slab as
   `lo=[x-hx, 0, z-hz]`, `hi=[x+hx, c.h??5, z+hz]`. **Any schema change must keep `c.h`
   meaning "top" or update this in lockstep.** Plan keeps `h` as a top alias.

**Networking constraint that simplifies elevation:** `net.js` sends `player.y` raw; the
server clamps/echoes it; receivers derive remote feet as `y - EYE` and place the villager
mesh there (`villagers.js`). **So the wire `y` means eye/camera world height.** Therefore
**keep `player.y` as eye height** and add a separate `player.feet`. Result: **net.js,
server.js, villagers.js, combat.js need no changes**, and remote players automatically
render standing on crates because true eye height already travels over the wire and
`rayPlayer` tests an absolute-world capsule.

---

## 3. Build in four phases (order matters)

Phase 1 (movement) lands first so climbable colliders behave correctly. Phases 2–4 are
content/polish.

---

### Phase 1 — Elevation-capable movement & collision

**Files:** `src/controls.js`, `src/world.js` (collider schema), `src/effects.js`.

**Collider schema (world.js).** Extend `addCollider` to carry a vertical span, keeping `h`
as a backward-compatible top alias so the raycaster keeps working; add a ramp type:
```js
export const colliders = [];
const addCollider = (x,z,hx,hz,top=5,base=0) =>
  colliders.push({ x, z, hx, hz, base, top, h: top, kind:'box' });
// sloped surface for ramps/stairs: top interpolates loTop→hiTop along axis 'x' or 'z'
const addRamp = (x,z,hx,hz,loTop,hiTop,axis='x') =>
  colliders.push({ x, z, hx, hz, base:0, loTop, hiTop, axis,
                   top:Math.max(loTop,hiTop), h:Math.max(loTop,hiTop), kind:'ramp' });
// height of a collider's top surface at world point (px,pz)
function colliderTopAt(c, px, pz){
  if(c.kind!=='ramp') return c.top;
  const a = c.axis==='x' ? (px-(c.x-c.hx))/(2*c.hx) : (pz-(c.z-c.hz))/(2*c.hz);
  const t = Math.max(0, Math.min(1, a));
  return c.loTop + (c.hiTop-c.loTop)*t;
}
```

**Player state (controls.js).** Keep `player.y` as eye height; add `player.feet`. Invariant
each frame: `player.y = player.feet + EYE`.
```js
export const player = { x:-105, z:0, feet:0, y:EYE, vy:0, yaw:0, pitch:0, grounded:true };
```

**Constants:** `R_PLAYER = 0.55`, `STEP_UP = 0.55`, `PLAYER_H = 1.8`.

**`groundAt(px,pz,feet)`** — floor height under the footprint: the **highest**
`colliderTopAt` of any collider whose XZ footprint contains `(px,pz)` and whose top is
`<= feet + STEP_UP`; baseline `0`. (Max-over-colliders closes ramp/platform seams.)

**Vertical-aware `collide(feet)`** — reuse the existing two-pass circle-vs-AABB push, but
gate each collider so the player walks over low things and under high overhangs:
```js
const topHere = colliderTopAt(c, player.x, player.z);
if (topHere <= feet + STEP_UP) continue;     // low enough → step onto, don't block
if (c.base   >= feet + PLAYER_H) continue;    // high overhang → walk under, don't block
// ...existing push-out math unchanged...
```

**Gravity / step / fall** (replaces the current `controls.js` vertical block):
```js
const ground = groundAt(player.x, player.z, player.feet);
if (player.grounded) {
  if (player.feet <= ground + STEP_UP) player.feet = ground;   // glue / small step up-down
  else { player.grounded = false; player.vy = 0; }             // walked off an edge → fall
} else {
  player.vy -= 13*dt; player.feet += player.vy*dt;
  if (player.feet <= ground) { player.feet = ground; player.vy = 0; player.grounded = true; }
}
player.y = player.feet + EYE;
```
Jump stays gated on `player.grounded`. Consider nudging jump `vy` to ~`5.2` and authoring
crate stacks in jumpable risers (~0.7–0.8 each); raised sites get **ramps/short stairs**
(via `addRamp`) so they're reachable without precise boosting.

**Shooting raycaster (effects.js).** `rayAABB` hardcodes the slab bottom to `0`; honor the
new base so shots clear under arch lintels and hit raised geometry:
```js
const lo = [c.x-c.hx, (c.base ?? 0),        c.z-c.hz];
const hi = [c.x+c.hx, (c.h ?? c.top ?? 5),  c.z+c.hz];
```
(`rayPlayer` already uses absolute world height — no change.)

**Risks & mitigations:** wedging between boxes → keep two-pass push, author ≥1.2u lane
gaps; tunneling → run 7.4 × dt(≤.05) ≈ 0.37u/frame ≪ wall thickness 0.6, fine; ramp seams →
`groundAt` max-over-colliders; gate/arch → author as side jambs + a lintel box with
`base ≈ 4.5` so the overhang is passable.

---

### Phase 2 — Desert palette: materials, textures, lighting

**Files:** `src/textures.js`, `src/materials.js`, `src/core.js`, sky/lights block in
`src/world.js`.

- **New canvas textures** (mirror the existing procedural idiom): `sandTex` (ground),
  `sandstoneTex` (walls/arches/sites, courses like the existing `stoneTex`), `concreteTex`
  (CT spawn / tunnels). Reuse `plankTex` for crates.
- **New materials** (extend; keep `matIron`/`matPlank` — still used): `matSand`,
  `matSandstone`, `matSandstoneDark`, `matConcrete`, `matContainerBlue` (`0x2f6fb0`),
  `matCarRed` (`0xb5402e`), `matSandbag` (`0xb8a878`), `matMetalDoor` (`0x5a6b3a`).
- **Daylight relight** (replaces dusk/night):
  - Sky shader colours → blue: `top 0x4a78b8`, `mid 0x9fc0e0`, `low 0xe8d9b0`.
  - `sun`: warm-white `0xfff0d8`, intensity ~2.6, high angle `sunDir ≈ (0.4,0.85,0.3)`.
  - Hemisphere: sky `0x9fc0e0`, ground `0x8a7350`.
  - Fog (`core.js`, `FogExp2`): recolour `0xcdbb94`, density ~`0.0025`.
  - **Remove** stars, moon, fireflies, torches, chimney smoke, bunting. Keep `updateAmbient`
    exported (main.js calls it) but make it a near no-op (optionally a few dust motes).

---

### Phase 3 — Build the Dust2 layout (world.js rewrite)

Rewrite the body of `src/world.js`, keeping exports `colliders` and `updateAmbient`.

**Scale** 1u≈1m. **Orientation:** T→CT along **+X** (T west `−X`, CT east `+X`); **A north
(+Z)**, **B south (−Z)**. Sand ground plane ~260×210 at `y=0`; lighter worn-path planes down
Long/Mid/Tunnels (thin planes at `y=0.02`). Outer boundary: 6u sandstone walls; decorative
skybox blocks/domes beyond (no colliders).

**Gameplay-critical (get numbers ~right): the three lanes & chokes** — A Long (long straight
doors→A sightline), Mid (open AWP lane through mid doors), B Tunnels (enclosed dogleg).
**Decorative (fake freely):** skyline, palms, decals, exact arch curves.

Approximate centers / footprints / heights (`top` = collider top y; **climb** = walkable top
via Phase 1, reached by ramp/jump):

| Area | Center (x,z) | Footprint x×z | Key elements (center, top) |
|---|---|---|---|
| **T Spawn** | (−105, 0) | 26×40 | open pad; split block (−88,0) top5; N exit→Long/Mid @ z+13; S exit→Tunnels @ z−13 |
| **Long A** | (−40, +40) | corridor 60×9 | double doors @ (−66,+30) gap~2.5; blue container (−58,+43) **climb** top2.6; barrels top1.0; **red car** (−14,+41) top1.6 |
| **Bombsite A** | (+10, +44) | 30×26, floor raised ~1.2 (ramp up) | A-box stack (+8,+48) **climb** tops 0.8/1.6; "goose" sandbags (+2,+38) top1.4; Short/Catwalk gap @ (+4,+30) |
| **Catwalk / Short A** | (+3, +16) | 8×24 + ledge | raised ledge (+5,+14) floor1.4 (ramp/box up); rail walls |
| **Mid** | (−20, 0) | open lane 70×10 | **mid doors** (−2,0) gap~2.5; **xbox** crate (−8,0) **climb** top1.5; CT-mid choke (+14,0); Mid→B gap @ (+8,−5) |
| **Tunnels** | (−55, −30) | lower 40×9 + upper 28×9, ceilings top4.5 | mouth (−84,−22); lower→upper dogleg (−38,−34); tunnel boxes **climb**; exit→B @ (−10,−24) |
| **Bombsite B** | (+2, −34) | 28×26 | back-plat (+12,−44) floor1.6 (ramp up); B box stack **climb**; doorway from tunnels @ (−10,−34); **B window** wall→CT @ (+16,−28) sill1.2; sandbags top1.2 |
| **CT Spawn** | (+95, +2) | 30×40 | open; CT→A connector (+50,+30); CT→B connector (+50,−18); CT→Mid (+30,+2) |

**Iconic props & recipes:**
- **Blue shipping container** — Box `~6×2.6×2.4`, `0x2f6fb0`, climbable flat top (real collider via Phase 1).
- **Red car (Long)** — body Box `4.4×1.0×1.9` @ y0.7 + cabin Box `2.2×0.8×1.7` @ y1.4 + 4 cylinder wheels; `0xb5402e`; solid cover, collider top ~1.6.
- **Wooden crates** — `matPlank` boxes, climbable, stacked in jumpable risers (tops e.g. 0.8 / 1.6).
- **Barrels** — cylinders r~0.42 h~0.95 (same idiom as the old `addBarrel`), rust/blue, top ~1.0.
- **Sandbags** — low boxes `~4×1.2×2`, `0xb8a878`, top ~1.2.
- **Double doors (Long & Mid)** — a wall box with a ~2.5 gap + two thin door-leaf planes; you pass through the gap.
- **Arches/doorways** — two jamb colliders + a lintel box with high `base` (~4.5) so you walk under.

**Build order in world.js:** sky/lights → ground + paths → `colliders=[]` + helpers → outer
walls → T spawn → Long → A → Catwalk/Short → Mid → Tunnels → B → CT spawn → props pass →
skybox decoration.

---

### Phase 4 — Spawn, bounds, callouts, theme text

- **Spawn → T spawn.** `controls.js` `player` init `x:-105, z:0, yaw≈+π/2` (face into map);
  `server.js` spawn `x:-105, z:0`; respawn in `combat.js` `x:-105+jitter, z:0`. (FFA → a
  single T-side spawn is fine; optionally alternate T/CT.)
- **World bounds** — `controls.js` clamps → `x:[-118,118]`, `z:[-92,92]`.
- **Callouts** — rewrite `src/zones.js` to Dust2 names and **remove the `WELL` import**
  (drop it, or keep a stub `export const WELL={x:0,z:0}` in world.js):
  `T Spawn (-105,0)`, `Long A (-40,40)`, `Bombsite A (10,44)`, `Catwalk (3,16)`,
  `Mid (-20,0)`, `Tunnels (-55,-30)`, `Bombsite B (2,-34)`, `CT Spawn (95,2)`.
- **Theme text** (optional) — update intro/menu copy in `index.html` (and any
  "Aldermoor / Anno Domini 1347" flavour) to a Dust2 title. Audio and the handgonne
  viewmodel can stay as-is.

---

## 4. Files to change (summary)

| File | Change |
|---|---|
| `src/controls.js` | `player.feet`; `groundAt`; elevation-aware `collide`; gravity/step/fall; spawn; bounds. |
| `src/world.js` | New collider schema (`addCollider`/`addRamp`/`colliderTopAt`); full Dust2 rebuild; daylight sky/lights; slimmed `updateAmbient`. |
| `src/effects.js` | `rayAABB` slab bottom uses `c.base`. |
| `src/materials.js` / `src/textures.js` | Desert palette (new materials + canvas textures). |
| `src/core.js` | Fog colour/density. |
| `src/zones.js` | Dust2 callouts; drop `WELL` dependency. |
| `server.js`, `src/combat.js` | Spawn coordinates only. |
| `index.html` | Title/intro copy (optional). |
| `src/net.js`, `src/villagers.js` | **Unchanged** — wire protocol already carries true eye height. |

---

## 5. Verification

1. `npm run dev` → http://localhost:5173. Watch the browser console for errors.
2. **Elevation** (use `window.__town.teleport(x,z)` + look around): walk up the A ramp onto
   the raised site; jump/step onto crate stacks; stand on the Long container; drop off the
   catwalk; walk *under* the gate arch; fall when stepping off a ledge; can't pass solid walls.
3. **Layout:** teleport to each callout (T Spawn, Long, A, Mid, Tunnels, B, CT); confirm the
   three lanes read correctly and doors/chokes line up.
4. **Combat:** `window.__town.fire()`; confirm tracers/hit tests against the new geometry;
   shots pass under lintels and hit a player standing on a crate.
5. **Multiplayer:** open two tabs; a remote player on a crate renders at the right height and
   is hittable.
6. **Theme:** desert daylight — blue sky, sand ground, no torches/fireflies/fog murk.

---

## 6. `window.__town` debug hooks (handy during dev)

`hideIntro()` (skip menu), `fire()`, `teleport(x,z,yaw?,pitch?)`, `pos` (getter → `[x,z]`),
`me`, `remotes`. Defined in `src/main.js`.
