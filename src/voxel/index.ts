/* ============================ the live voxel world ============================ */
// The one place the rest of the game talks to the voxel engine. world.ts hands a
// freshly built map here and gets back a group to put in the scene; from then on
// controls asks it where the floor and the walls are, combat asks it what a shot
// hits and tells it what a shot did, and main ticks it once a frame.
//
// The rules of the game are unchanged — same speeds, same step height, same
// weapons, same messages on the wire. What changed is what those rules are
// measured against: voxels instead of a list of boxes, so when the voxels
// change, the game changes with them. A hole shot in a wall is a hole you can
// see through, shoot through and eventually walk through.
import * as THREE from 'three';
import { VoxelGrid, makeHit, type RayHit } from './grid';
import { voxelizeMap, VS, FAR_VS } from './voxelize';
import { ChunkSet } from './chunks';
import { makeVoxelMaterial } from './material';
import { matOf } from './palette';
import { SkyLight } from './skylight';
import { carve, initDestruction, updateDestruction, destructionStats, setQuiet } from './destruction';
import { spawnImpact, clearChips } from '../effects';
import type { BuiltMap } from '../mapkit';
import type { Surface } from '../materials';

const fineMat = makeVoxelMaterial(VS);
const farMat = makeVoxelMaterial(FAR_VS);

let grid: VoxelGrid | null = null;
let chunks: ChunkSet | null = null;
let farChunks: ChunkSet | null = null;
let sky: SkyLight | null = null;
let groundSurface: Surface = 'sand';
let touched = false;   // has a shot landed on this map since it was built?
let silent = false;    // replaying old shots: damage only, no dust or debris
let applied = 0;       // shots run against this map so far (two clients on the same count hold the same map)
export const voxelsTouched = () => touched;

/* ============================ geometry-changed signal ============================ */
// The sun's shadow map is baked, not live (see world.ts). When voxels go, the
// bake is stale — but re-rendering it for every single bullet would give back
// the cost the bake exists to avoid. So changes are coalesced: at most one
// re-bake every SHADOW_GAP seconds while the shooting lasts, plus a final one.
const SHADOW_GAP = .12;
let onChange: (() => void) | null = null;
let shadowStale = false, sinceBake = 0;
export function onGeometryChange(fn: () => void) { onChange = fn; }

/* ============================ build ============================ */
export function buildVoxelWorld(built: BuiltMap, ground: Surface): THREE.Group {
  chunks?.dispose(); farChunks?.dispose(); sky?.dispose();
  clearChips();
  groundSurface = ground;

  const t0 = performance.now();
  const { fine, far } = voxelizeMap(built, ground);
  const t1 = performance.now();
  grid = fine;
  chunks = new ChunkSet(fine, fineMat, true);
  chunks.buildAll();
  // The backdrop receives shadow but casts none: it lies outside the walls,
  // beyond the shadow camera's useful range.
  farChunks = new ChunkSet(far, farMat, false);
  farChunks.buildAll();
  for (const m of farChunks.group.children) m.receiveShadow = true;
  const t2 = performance.now();
  sky = new SkyLight(fine);
  sky.bind();
  const t3 = performance.now();

  const group = new THREE.Group();
  group.add(chunks.group, farChunks.group);
  initDestruction(fine, chunks, fineMat, group, sky);
  shadowStale = false; touched = false; applied = 0;
  console.info(`voxel world: ${fine.nx}×${fine.ny}×${fine.nz} @ ${VS}m — voxelize ${(t1 - t0).toFixed(0)}ms, ` +
    `mesh ${(t2 - t1).toFixed(0)}ms, light ${(t3 - t2).toFixed(0)}ms, ${chunks.quads + farChunks.quads} quads`);
  return group;
}

/* ============================ per frame ============================ */
export function updateVoxels(dt: number) {
  if (!chunks) return;
  updateDestruction(dt);
  sky?.flush();
  if (chunks.flush(6) > 0) shadowStale = true;
  sinceBake += dt;
  if (shadowStale && sinceBake >= SHADOW_GAP) { shadowStale = false; sinceBake = 0; onChange?.(); }
}

/* ============================ player queries ============================ */
/* The floor under (x,z): the highest surface at or below `maxY`. */
export function floorUnder(x: number, z: number, maxY: number) {
  return grid ? grid.groundBelow(x, z, maxY) : 0;
}
/* Where a body `height` tall can stand at (x,z) — the lowest clear spot. */
export function standHeight(x: number, z: number, height: number) {
  return grid ? grid.standAt(x, z, height) : 0;
}
export function solidAt(x: number, y: number, z: number) {
  return !!grid && grid.solidAt(x, y, z);
}

/* Push a circle (the player) out of every voxel column that is solid anywhere
   between yLo and yHi. The deepest overlap is resolved first, then the search
   repeats: against a flat wall that leaves exactly one push, straight out along
   the wall's normal, so sliding along a wall built from hundreds of little
   cells feels the same as sliding along one long box did. */
export function resolveCircle(p: { x: number; z: number }, r: number, yLo: number, yHi: number) {
  const g = grid;
  if (!g) return;
  const vs = g.vs, r2 = r * r - 1e-9;
  for (let iter = 0; iter < 8; iter++) {
    const i0 = g.ix(p.x - r), i1 = g.ix(p.x + r), k0 = g.iz(p.z - r), k1 = g.iz(p.z + r);
    let best = r2, bi = 0, bk = 0, found = false;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const minx = g.ox + i * vs, minz = g.oz + k * vs;
      const cx = Math.max(minx, Math.min(p.x, minx + vs)), cz = Math.max(minz, Math.min(p.z, minz + vs));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < best && g.columnBlocked(i, k, yLo, yHi)) { best = d2; bi = i; bk = k; found = true; }
    }
    if (!found) return;
    const minx = g.ox + bi * vs, minz = g.oz + bk * vs;
    if (best < 1e-9) {
      // centre is inside the cell: leave through its nearest side
      const mx = minx + vs / 2, mz = minz + vs / 2, dx = p.x - mx, dz = p.z - mz;
      if (Math.abs(dx) > Math.abs(dz)) p.x = mx + Math.sign(dx || 1) * (vs / 2 + r);
      else p.z = mz + Math.sign(dz || 1) * (vs / 2 + r);
    } else {
      const cx = Math.max(minx, Math.min(p.x, minx + vs)), cz = Math.max(minz, Math.min(p.z, minz + vs));
      const dx = p.x - cx, dz = p.z - cz, d = Math.sqrt(best), push = (r - d) / d;
      p.x += dx * push; p.z += dz * push;
    }
  }
}

/* Keep a circle (the player) out of the locked columns — the outer walls behind
   their diggable face, and everything beyond them. The walls themselves already
   do this at ground level; this is the same wall carried up past its top, so a
   staircase shot into the diggable face leads onto nothing. Measured from the
   live grid's lock planes, so it fits whichever map is loaded.
   Once `reach` (the top of what the player can step onto: feet + step height,
   the yLo resolveCircle is given) gets to the wall top, the barrier moves in to
   the walls' inner faces: otherwise the top of the diggable strip, lock plane
   deep, is a ledge to run along. Switching at the step reach, not the feet,
   leaves no gap: while the wall top is out of step reach resolveCircle treats
   the wall as a wall, and the moment it comes within reach — when the player
   could step up onto it — the clamp is already at the face. Holes shot lower in
   the wall can still be walked into, lock plane deep. */
export function confine(p: { x: number; z: number }, r: number, reach: number) {
  const g = grid;
  if (!g) return;
  const vs = g.vs, up = reach >= g.wallTop - 1e-3;
  const i0 = up ? g.faceI0 : g.lockI0, i1 = up ? g.faceI1 : g.lockI1;
  const k0 = up ? g.faceK0 : g.lockK0, k1 = up ? g.faceK1 : g.lockK1;
  p.x = Math.max(g.ox + i0 * vs + r, Math.min(g.ox + i1 * vs - r, p.x));
  p.z = Math.max(g.oz + k0 * vs + r, Math.min(g.oz + k1 * vs - r, p.z));
}

/* ============================ shots ============================ */
export interface ShotHit { end: number; hit: boolean; outside: boolean; ray: RayHit; }
const _shot: ShotHit = { end: 0, hit: false, outside: false, ray: makeHit() };

/* Trace a shot against the world. Beyond the playable block the world is open
   ground at y = 0 (the skyline is scenery, as it always was). */
export function traceWorld(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxLen: number, out = _shot): ShotHit {
  out.end = maxLen; out.hit = false; out.outside = false;
  const g = grid;
  if (g && g.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxLen, out.ray)) { out.end = out.ray.t; out.hit = true; return out; }
  if (d.y < -1e-6) {
    const t = -o.y / d.y;
    if (t > 0 && t < maxLen && !(g && g.containsXZ(o.x + d.x * t, o.z + d.z * t))) {
      out.end = t; out.hit = true; out.outside = true;
      out.ray.nx = 0; out.ray.ny = 1; out.ray.nz = 0; out.ray.m = 0;
    }
  }
  return out;
}

// How big a bite each weapon takes: [handgonne, ak47]. `depth` sinks the centre
// of the bite below the struck face, which is what lets a single heavy ball
// punch clean through a wall instead of only cratering its near side.
const BITE = [
  { radius: .62, depth: .30, debris: 36 },
  { radius: .27, depth: .10, debris: 7 },
];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _pt = new THREE.Vector3(), _n = new THREE.Vector3();
const _impact: ShotHit = { end: 0, hit: false, outside: false, ray: makeHit() };

/* Land a shot on the world: dust, debris, and the damage itself.
   The arguments are exactly what travels in a `shoot` message — origin,
   direction, length, weapon — and the shooter calls this with the very same
   rounded values it sent. Every client therefore runs this function on
   identical inputs, which is what keeps everyone's walls broken the same way
   without the server knowing a thing about geometry. */
export function shotImpact(o: ArrayLike<number>, d: ArrayLike<number>, len: number, weapon: number) {
  applied++;
  _o.set(o[0], o[1], o[2]);
  _d.set(d[0], d[1], d[2]).normalize();
  // `len` is rounded to a decimetre and the direction to three places, so reach
  // a little past it — further at range, where the rounding fans out.
  const hit = traceWorld(_o, _d, len + .1 + len * .006, _impact);
  if (!hit.hit) return;
  const r = hit.ray;
  _pt.copy(_o).addScaledVector(_d, hit.end);
  _n.set(r.nx, r.ny, r.nz);
  if (hit.outside) { if (!silent) spawnImpact(_pt, _n, groundSurface); return; }
  const g = grid as VoxelGrid;
  touched = true;
  if (!silent) spawnImpact(_pt, _n, matOf(r.m).surface, g.locked(r.i, r.j, r.k));
  const b = BITE[weapon === 1 ? 1 : 0];
  carve(_pt.x - _n.x * b.depth, _pt.y - _n.y * b.depth, _pt.z - _n.z * b.depth, b.radius,
    _d.x, _d.y, _d.z, _n.x, _n.y, _n.z, b.debris);
}

/* Bring a freshly built map up to date with a round already under way: land
   every shot the server has let through so far ([weapon, origin×3, direction×3,
   length] each, in order), silently, then re-mesh in one go. Because damage is
   a pure function of those numbers and the map they land on, the result is the
   map every other client is already looking at. */
const _ro = [0, 0, 0], _rd = [0, 0, 0];
export function replayShots(log: ArrayLike<number>[]) {
  if (!grid || !chunks || !log.length) return;
  const t0 = performance.now();
  silent = true; setQuiet(true);
  try {
    for (const s of log) {
      if (!s || s.length < 8) continue;
      _ro[0] = s[1]; _ro[1] = s[2]; _ro[2] = s[3];
      _rd[0] = s[4]; _rd[1] = s[5]; _rd[2] = s[6];
      shotImpact(_ro, _rd, s[7], s[0]);
    }
  } finally { silent = false; setQuiet(false); }
  chunks.flush(Infinity);
  onChange?.(); shadowStale = false; sinceBake = 0;
  console.info(`voxel world: replayed ${log.length} shots in ${(performance.now() - t0).toFixed(0)}ms`);
}

export function voxelStats() {
  return {
    quads: (chunks?.quads ?? 0) + (farChunks?.quads ?? 0),
    pending: chunks?.pending ?? 0,
    shots: applied,
    ...destructionStats(),
    grid: grid ? [grid.nx, grid.ny, grid.nz] : null,
  };
}
export const voxelGrid = () => grid;
/* Sky light (0–255) at a world position — what the shader would look up there. */
export function skyAt(x: number, y: number, z: number) {
  if (!grid || !sky || !sky.ok) return 255;
  const i = grid.ix(x), j = grid.iy(y), k = grid.iz(z);
  return grid.inside(i, j, k) ? sky.light[grid.idx(i, j, k)] : 255;
}
