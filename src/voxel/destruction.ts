/* ============================ destruction simulation ============================ */
// What happens when a ball hits the world. Three layers, cheapest first:
//
//   1. CARVE — the hit removes a ragged sphere of voxels (how big depends on the
//      weapon and on how soft the material is) and scorches the rim it leaves.
//
//   2. SUPPORT — every voxel must be connected, through other voxels, to the
//      ground. After a carve, the voxels bordering the hole are flood-filled
//      toward the ground; any group that can no longer reach it has been cut
//      loose. Shoot the foot out from under a pillar and the top is such a group.
//
//   3. COLLAPSE — a loose group is lifted out of the grid and becomes an ISLAND:
//      a rigid body with its own mesh that falls and tumbles under gravity. When
//      it lands it shatters into DEBRIS — small instanced cubes that bounce,
//      settle on whatever is left of the map, and fade after a few seconds.
//
// Determinism matters here. There is no server-side world: each client breaks
// its own copy, driven by the same `shoot` messages. So everything that changes
// the GRID — which voxels a carve removes, which groups are loose — is a pure
// function of the shot and the grid, with any "randomness" hashed from voxel
// coordinates. Everything that is merely seen — how debris scatters, how an
// island tumbles — is free to use Math.random, because it never feeds back in.
import * as THREE from 'three';
import { scene, camera } from '../core';
import { VoxelGrid, SCORCH } from './grid';
import { ChunkSet, geometryFrom } from './chunks';
import { meshRegion } from './mesher';
import { matOf, PAL, h3 } from './palette';
import { spawnDust } from '../effects';
import { burst } from '../particles';
import { rumble } from '../audio';
import { addSkyLight, type SkyLight } from './skylight';

const GRAVITY = 13;               // matches the player's fall
const MAX_ISLAND = 60000;         // a loose group bigger than this is left standing
const SMALL_ISLAND = 10;          // …and one this small skips the rigid body: straight to debris

let grid: VoxelGrid | null = null;
let chunks: ChunkSet | null = null;
let material: THREE.Material | null = null;
let holder: THREE.Group | null = null;
let sky: SkyLight | null = null;
const opened: number[] = [];      // storage indices the carve in progress has turned to air

/* ============================ debris pool ============================ */
// One InstancedMesh for every loose cube in the world: one draw call however
// much is flying. Live cubes are kept packed at the front of the arrays
// (swap-remove), so `count` is simply how many to draw.
const MAXD = 4096;
const F = 16;                     // floats per cube
// px py pz  vx vy vz  ax ay az  ang spin  size ttl rest  life  -
const D = new Float32Array(MAXD * F);
let nd = 0;

const debrisMat = addSkyLight(new THREE.MeshStandardMaterial({ roughness: .9 }));
const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debrisMat, MAXD);
debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debris.frustumCulled = false;     // instances roam; the unit cube's bounds mean nothing
debris.castShadow = false; debris.receiveShadow = true;
debris.count = 0;
const _c = new THREE.Color();
debris.setColorAt(0, _c.setRGB(1, 1, 1));   // allocate instanceColor up front, before first compile
scene.add(debris);

function spawnDebris(x: number, y: number, z: number, vx: number, vy: number, vz: number, m: number, size: number, life: number) {
  // Full pool: recycle a random cube. Better a few old ones vanish early than
  // the newest hit throw nothing.
  const i = nd < MAXD ? nd++ : Math.floor(Math.random() * MAXD);
  const o = i * F;
  D[o] = x; D[o + 1] = y; D[o + 2] = z;
  D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz;
  const a = Math.random() * 6.283, c = Math.random() * 2 - 1, s = Math.sqrt(1 - c * c);
  D[o + 6] = Math.cos(a) * s; D[o + 7] = c; D[o + 8] = Math.sin(a) * s;
  D[o + 9] = Math.random() * 6.283; D[o + 10] = (Math.random() - .5) * 18;
  D[o + 11] = size; D[o + 12] = life; D[o + 13] = 0; D[o + 14] = life;
  const p = (m & 255) * 4, v = .82 + Math.random() * .3;
  debris.setColorAt(i, _c.setRGB(PAL[p] / 255 * v, PAL[p + 1] / 255 * v, PAL[p + 2] / 255 * v, THREE.SRGBColorSpace));
  (debris.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();

function updateDebris(dt: number) {
  const g = grid;
  for (let i = 0; i < nd; i++) {
    const o = i * F;
    D[o + 12] -= dt;
    if (D[o + 12] <= 0) {                         // expired: move the last cube into this slot
      nd--;
      if (i < nd) {
        D.copyWithin(o, nd * F, nd * F + F);
        debris.getColorAt(nd, _c); debris.setColorAt(i, _c);
        (debris.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
        i--;
      }
      continue;
    }
    const half = D[o + 11] * .5;
    let x = D[o], y = D[o + 1], z = D[o + 2];
    if (D[o + 13] === 0) {
      D[o + 4] -= GRAVITY * dt;
      let nx = x + D[o + 3] * dt, ny = y + D[o + 4] * dt, nz = z + D[o + 5] * dt;
      // floor: whatever voxel is under the cube, or flat ground beyond the grid
      let floorY = -Infinity;
      if (g && g.containsXZ(x, z)) {
        if (D[o + 4] < 0 && g.solidAt(x, ny - half, z)) floorY = g.oy + (g.iy(ny - half) + 1) * g.vs;
        else if (ny - half < g.oy) floorY = g.oy;
      } else if (ny - half < 0) floorY = 0;
      if (floorY > -Infinity) {
        ny = floorY + half;
        D[o + 4] *= -.28; D[o + 3] *= .6; D[o + 5] *= .6; D[o + 10] *= .5;
        if (Math.abs(D[o + 4]) < 1.1) {
          D[o + 4] = 0;
          if (D[o + 3] * D[o + 3] + D[o + 5] * D[o + 5] < .25) { D[o + 13] = 1; D[o + 10] = 0; }
        }
      }
      // walls: give back the axis that ran into something
      if (g && g.solidAt(nx, ny, nz)) {
        if (!g.solidAt(x, ny, nz)) { nx = x; D[o + 3] *= -.3; }
        else if (!g.solidAt(nx, ny, z)) { nz = z; D[o + 5] *= -.3; }
        else { nx = x; nz = z; D[o + 3] *= -.3; D[o + 5] *= -.3; }
      }
      x = D[o] = nx; y = D[o + 1] = ny; z = D[o + 2] = nz;
      D[o + 9] += D[o + 10] * dt;
    } else if (g && g.containsXZ(x, z) && y - half > g.oy + .01 && !g.solidAt(x, y - half - .05, z)) {
      D[o + 13] = 0;                              // what it was resting on is gone
    }
    const t = D[o + 12];
    const sc = D[o + 11] * (t < .5 ? t / .5 : 1); // shrink away rather than pop
    _q.setFromAxisAngle(_ax.set(D[o + 6], D[o + 7], D[o + 8]), D[o + 9]);
    debris.setMatrixAt(i, _m4.compose(_v.set(x, y, z), _q, _s.set(sc, sc, sc)));
  }
  if (debris.count !== nd || nd > 0) {
    debris.count = nd;
    debris.instanceMatrix.clearUpdateRanges();
    debris.instanceMatrix.addUpdateRange(0, nd * 16);
    debris.instanceMatrix.needsUpdate = true;
  }
}

/* ============================ islands ============================ */
interface Island {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;     // angular velocity
  probes: Float32Array;                   // local points tested against the grid
  bits: Float32Array;                     // local x,y,z,material of voxels kept for the shatter
  bitSize: number;
  count: number;                          // voxels in the island
  age: number;
}
const islands: Island[] = [];
const _dq = new THREE.Quaternion(), _p = new THREE.Vector3();

/* Quiet mode: change the grid, show nothing. Used when a round's earlier shots
   are replayed for someone who joined late — they should find the map as it
   stands now, not watch an hour of rubble fall in one frame. */
let quiet = false;
export function setQuiet(q: boolean) { quiet = q; }

function makeIsland(comp: number[]) {
  const g = grid as VoxelGrid, vs = g.vs, SY = g.SY, SX = g.SX;
  const n = comp.length;
  const I = new Int32Array(n), J = new Int32Array(n), K = new Int32Array(n), Mv = new Uint8Array(n);
  let i0 = 1e9, j0 = 1e9, k0 = 1e9, i1 = -1e9, j1 = -1e9, k1 = -1e9, si = 0, sj = 0, sk = 0;
  for (let a = 0; a < n; a++) {
    const id = comp[a], j = id % SY - 1, t = (id - j - 1) / SY, i = t % SX - 1, k = Math.floor(t / SX) - 1;
    I[a] = i; J[a] = j; K[a] = k; Mv[a] = g.data[id];
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
    si += i; sj += j; sk += k;
    g.data[id] = 0;
    opened.push(id);
    (chunks as ChunkSet).markVoxel(i, j, k);
  }
  // centre of mass, snapped to the voxel lattice so the shader's per-voxel
  // cells still line up with the island's own voxels (see material.ts)
  const ci = Math.round(si / n + .5), cj = Math.round(sj / n + .5), ck = Math.round(sk / n + .5);
  const cx = g.ox + ci * vs, cy = g.oy + cj * vs, cz = g.oz + ck * vs;

  if (quiet) return;   // it has long since fallen and shattered

  if (n <= SMALL_ISLAND) {
    for (let a = 0; a < n; a++)
      spawnDebris(g.ox + (I[a] + .5) * vs, g.oy + (J[a] + .5) * vs, g.oz + (K[a] + .5) * vs,
        (Math.random() - .5) * 1.5, Math.random() * 1.2, (Math.random() - .5) * 1.5, Mv[a], vs * .85, 4 + Math.random() * 3);
    return;
  }

  const ni = i1 - i0 + 1, nj = j1 - j0 + 1, nk = k1 - k0 + 1;
  const local = new VoxelGrid(ni, nj, nk, vs, g.ox + i0 * vs, g.oy + j0 * vs, g.oz + k0 * vs);
  for (let a = 0; a < n; a++) local.data[local.idx(I[a] - i0, J[a] - j0, K[a] - k0)] = Mv[a];
  const data = meshRegion(local, 0, 0, 0, ni, nj, nk, true, cx, cy, cz);
  if (!data) return;
  const mesh = new THREE.Mesh(geometryFrom(data), material as THREE.Material);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = false; mesh.receiveShadow = true;
  (holder as THREE.Group).add(mesh);

  // Collision probes: voxel centres, biased to the underside (that is what lands).
  const np = Math.min(n, 72), probes = new Float32Array(np * 3);
  const low: number[] = [];
  for (let a = 0; a < n; a++) if (J[a] <= j0 + 1) low.push(a);
  for (let a = 0; a < np; a++) {
    // first half: spread across the lowest two layers; second half: anywhere
    const pick = a < np / 2 ? low[Math.floor(a / (np / 2) * low.length)] : Math.floor(Math.random() * n);
    probes[a * 3] = (I[pick] + .5 - ci) * vs; probes[a * 3 + 1] = (J[pick] + .5 - cj) * vs; probes[a * 3 + 2] = (K[pick] + .5 - ck) * vs;
  }
  // What the island breaks into. A big one can't become one cube per voxel, so
  // it becomes fewer, larger cubes — same visual mass, bounded cost.
  const nb = Math.min(n, 420), bits = new Float32Array(nb * 4), stride = n / nb;
  for (let a = 0; a < nb; a++) {
    const pick = Math.floor(a * stride);
    bits[a * 4] = (I[pick] + .5 - ci) * vs; bits[a * 4 + 1] = (J[pick] + .5 - cj) * vs; bits[a * 4 + 2] = (K[pick] + .5 - ck) * vs;
    bits[a * 4 + 3] = Mv[pick];
  }
  const tumble = 1.6 / (1 + Math.cbrt(n) * .25);   // big masses turn slowly
  islands.push({
    mesh, vx: 0, vy: 0, vz: 0,
    wx: (Math.random() - .5) * tumble, wy: (Math.random() - .5) * tumble * .3, wz: (Math.random() - .5) * tumble,
    probes, bits, bitSize: vs * Math.min(3, Math.max(.9, Math.cbrt(stride))), count: n, age: 0,
  });
}

function shatter(isl: Island) {
  const m = isl.mesh;
  let lowY = Infinity;
  for (let a = 0; a < isl.bits.length; a += 4) {
    _p.set(isl.bits[a], isl.bits[a + 1], isl.bits[a + 2]);
    const r = _p.length() || 1, ox = _p.x / r, oz = _p.z / r;
    _p.applyQuaternion(m.quaternion).add(m.position);
    if (_p.y < lowY) lowY = _p.y;
    const sp = 1 + Math.random() * 2.6;
    spawnDebris(_p.x, _p.y, _p.z,
      isl.vx * .4 + ox * sp + (Math.random() - .5), isl.vy * .25 + Math.random() * 2.2, isl.vz * .4 + oz * sp + (Math.random() - .5),
      isl.bits[a + 3], isl.bitSize * (.7 + Math.random() * .5), 5 + Math.random() * 5);
  }
  // a skirt of dust where it came down, in the colour of what fell
  const first = (isl.bits[3] & 255) * 4;
  const hex = PAL[first] << 16 | PAL[first + 1] << 8 | PAL[first + 2];
  const puffs = Math.min(6, 2 + Math.floor(Math.cbrt(isl.count) / 4));
  const spread = Math.cbrt(isl.count) * (grid as VoxelGrid).vs * .6;
  for (let a = 0; a < puffs; a++)
    spawnDust(_p.set(m.position.x + (Math.random() - .5) * spread, lowY + .2, m.position.z + (Math.random() - .5) * spread),
      hex, 1.2 + Math.random() * 1.6, .9 + Math.random() * .6);
  const dist = m.position.distanceTo(camera.position);
  rumble(Math.min(.9, (.15 + Math.cbrt(isl.count) * .035) * 14 / Math.max(6, dist)), .35 + Math.min(.7, isl.count / 20000));
  (holder as THREE.Group).remove(m);
  m.geometry.dispose();
}

function updateIslands(dt: number) {
  const g = grid as VoxelGrid;
  for (let n = islands.length - 1; n >= 0; n--) {
    const isl = islands[n], m = isl.mesh;
    isl.age += dt;
    isl.vy -= GRAVITY * dt;
    m.position.x += isl.vx * dt; m.position.y += isl.vy * dt; m.position.z += isl.vz * dt;
    const w = Math.hypot(isl.wx, isl.wy, isl.wz);
    if (w > 1e-5) {
      _dq.setFromAxisAngle(_ax.set(isl.wx / w, isl.wy / w, isl.wz / w), w * dt);
      m.quaternion.premultiply(_dq);
    }
    let hit = isl.age > 8;                        // never let one fall forever
    for (let a = 0; a < isl.probes.length && !hit; a += 3) {
      _p.set(isl.probes[a], isl.probes[a + 1], isl.probes[a + 2]).applyQuaternion(m.quaternion).add(m.position);
      hit = _p.y < (g.containsXZ(_p.x, _p.z) ? g.oy : 0) || g.solidAt(_p.x, _p.y, _p.z);
    }
    if (hit) { shatter(isl); islands.splice(n, 1); }
  }
}

/* ============================ support check ============================ */
// Depth-first toward the ground. The neighbour order is deliberate: "down" is
// pushed last, so it is explored first, and a voxel in a standing wall reaches
// the ground in a couple of dozen steps without ever looking sideways. Only a
// genuinely severed group gets explored in full.
const marks = new Map<number, number>();   // storage index → 1 (known supported) | 2 (this search)
const stack: number[] = [];

function checkSupport(seeds: number[]) {
  const g = grid as VoxelGrid, data = g.data, SY = g.SY, si = g.si, sk = g.sk, gj = g.groundJ;
  marks.clear();
  for (const seed of seeds) {
    if (data[seed] === 0 || marks.has(seed)) continue;
    const comp: number[] = [];
    let supported = false;
    stack.length = 0;
    stack.push(seed); marks.set(seed, 2);
    while (stack.length) {
      const id = stack.pop() as number;
      if (id % SY <= gj) { marks.set(id, 1); supported = true; break; }   // reached the ground slab
      comp.push(id);
      if (comp.length > MAX_ISLAND) { supported = true; break; }  // too big to drop: let it stand
      for (let nb = 0; nb < 6; nb++) {
        const q = nb === 0 ? id + 1 : nb === 1 ? id + si : nb === 2 ? id - si : nb === 3 ? id + sk : nb === 4 ? id - sk : id - 1;
        if (data[q] === 0) continue;
        const mk = marks.get(q);
        if (mk === 1) { supported = true; break; }             // joins a group we already cleared
        if (mk === 2) continue;
        marks.set(q, 2); stack.push(q);
      }
      if (supported) break;
    }
    if (supported) {
      for (const id of comp) marks.set(id, 1);
      for (const id of stack) marks.set(id, 1);
    } else makeIsland(comp);
  }
}

/* ============================ carving ============================ */
const removed: number[] = [];   // i,j,k,m quads of what the last carve took
const seeds: number[] = [];

/* Take a ragged spherical bite centred on (cx,cy,cz). `n*` is the struck face's
   normal and `d*` the shot's direction — used only to throw the debris.
   Returns how many voxels went. */
export function carve(
  cx: number, cy: number, cz: number, radius: number,
  dx: number, dy: number, dz: number, nx: number, ny: number, nz: number, maxDebris: number,
) {
  const g = grid, ch = chunks;
  if (!g || !ch) return 0;
  const vs = g.vs, data = g.data, R = radius * 1.9 + vs * 2;
  const i0 = Math.max(0, g.ix(cx - R)), i1 = Math.min(g.nx - 1, g.ix(cx + R));
  const j0 = Math.max(0, g.iy(cy - R)), j1 = Math.min(g.ny - 1, g.iy(cy + R));
  const k0 = Math.max(0, g.iz(cz - R)), k1 = Math.min(g.nz - 1, g.iz(cz + R));
  removed.length = 0;
  let nearest = -1, nearestD = Infinity, ni = 0, nj = 0, nk = 0;
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
    const col = g.idx(i, 0, k);
    const ex = g.ox + (i + .5) * vs - cx, ez = g.oz + (k + .5) * vs - cz, exz = ex * ex + ez * ez;
    for (let j = j0; j <= j1; j++) {
      const m = data[col + j];
      if (m === 0) continue;
      const ey = g.oy + (j + .5) * vs - cy, dist = Math.sqrt(exz + ey * ey);
      // The bite's reach varies voxel by voxel (hashed, so identical on every
      // client): that is what makes the hole ragged instead of a neat ball.
      const r = radius * matOf(m).soft * (.78 + .44 * h3(i, j, k));
      if (dist <= r) {
        if (g.locked(i, j, k)) continue;
        data[col + j] = 0;
        opened.push(col + j);
        removed.push(i, j, k, m);
        ch.markVoxel(i, j, k);
      } else {
        if (dist < nearestD) { nearestD = dist; nearest = col + j; ni = i; nj = j; nk = k; }
        if (dist <= r + vs * 1.3 && !(m & SCORCH) && h3(k, i, j) < .55) { data[col + j] = m | SCORCH; ch.markVoxel(i, j, k); }
      }
    }
  }
  const count = removed.length / 4;
  if (count === 0) {
    // Too hard to break (or bedrock): at least leave a mark where it struck.
    if (nearest >= 0 && nearestD < vs * 1.5 && !(data[nearest] & SCORCH)) { data[nearest] |= SCORCH; ch.markVoxel(ni, nj, nk); }
    return 0;
  }

  // debris: a sample of what was removed, sprayed back out of the hole
  const step = Math.max(1, Math.ceil(count / maxDebris));
  for (let a = quiet ? count : Math.floor(Math.random() * step); a < count; a += step) {
    const o = a * 4, sp = 1.5 + Math.random() * 3.2;
    spawnDebris(g.ox + (removed[o] + .5) * vs, g.oy + (removed[o + 1] + .5) * vs, g.oz + (removed[o + 2] + .5) * vs,
      (nx * 1.1 - dx * .25) * sp + (Math.random() - .5) * 2.4,
      (ny * 1.1 - dy * .25) * sp + Math.random() * 2.2,
      (nz * 1.1 - dz * .25) * sp + (Math.random() - .5) * 2.4,
      removed[o + 3], vs * (.45 + Math.random() * .5), 3.5 + Math.random() * 4);
  }

  // support: every solid voxel that bordered the hole might just have lost its footing
  seeds.length = 0;
  const { si, sk } = g;
  for (let a = 0; a < removed.length; a += 4) {
    const id = g.idx(removed[a], removed[a + 1], removed[a + 2]);
    if (data[id + 1]) seeds.push(id + 1);
    if (data[id + si]) seeds.push(id + si);
    if (data[id - si]) seeds.push(id - si);
    if (data[id + sk]) seeds.push(id + sk);
    if (data[id - sk]) seeds.push(id - sk);
    if (data[id - 1]) seeds.push(id - 1);
  }
  checkSupport(seeds);
  // daylight into whatever the hole and the collapse just opened up
  sky?.opened(opened);
  opened.length = 0;
  return count;
}

/* ============================ lifecycle ============================ */
export function initDestruction(g: VoxelGrid, c: ChunkSet, mat: THREE.Material, group: THREE.Group, light: SkyLight | null = null) {
  sky = light; opened.length = 0;
  for (const isl of islands) isl.mesh.geometry.dispose();
  islands.length = 0;
  nd = 0; debris.count = 0;
  grid = g; chunks = c; material = mat; holder = group;
}

export function updateDestruction(dt: number) {
  if (!grid) return;
  if (islands.length) updateIslands(dt);
  if (nd > 0 || debris.count > 0) updateDebris(dt);
}

export const destructionStats = () => ({ debris: nd, islands: islands.length });

// re-exported so callers don't need to know burst lives in particles
export { burst };
