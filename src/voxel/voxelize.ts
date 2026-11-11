/* ============================ voxelizer: map → voxels ============================ */
// The maps are still authored exactly as before: build() lays out boxes, ramps,
// cylinders and ground planes with the map toolkit. This module is the bridge to
// the voxel engine. It walks the group a map built and rasterises every
// primitive into voxels — the original meshes are then thrown away.
//
// Two grids come out of it:
//   fine — the playable block, at 0.25 m. This is the world: it is what gets
//          drawn, shot, walked on and destroyed.
//   far  — everything beyond the boundary walls (the open ground and the
//          skyline), at 1 m. Purely a backdrop: it is meshed once and never
//          touched again, so it can afford to be coarse.
//
// Shapes are rasterised by the centre rule: a voxel is filled when its centre
// lies inside the primitive. Axis-aligned boxes (nearly everything) take a fast
// path that fills index ranges directly; anything rotated or round goes through
// the general path, which maps each candidate voxel back into the primitive's
// own space and asks an implicit inside-test.
import * as THREE from 'three';
import { VoxelGrid } from './grid';
import { patternFor, subsoil, type Ctx, type Pattern } from './palette';
import type { BuiltMap, Bounds } from '../mapkit';
import type { Surface } from '../materials';

export const VS = 0.25;            // fine voxel edge, metres
export const FAR_VS = 1;           // backdrop voxel edge
const GROUND_LAYERS = 3;           // fine ground slab: bedrock + two diggable layers
const WALL_LAYERS = 3;             // outer walls: diggable this deep from the inner face, locked behind
const LOCK = 4;                    // fallback rim at the grid edge (1 m), for a map that declares no bounds

const ctx: Ctx = { x: 0, y: 0, z: 0, vs: VS, box: false, li: 0, lj: 0, lk: 0, ni: 0, nj: 0, nk: 0, top: 0 };

type Inside = (x: number, y: number, z: number) => boolean;

/* An implicit inside-test for a primitive, in the primitive's local space. Box
   tests also record where in the box the point is, for the surface patterns. */
/* What primitive a geometry is. Stock three geometries say so themselves; ones
   that went through core's uvBox (or mapkit's wedge) carry it in userData. */
export function shapeOf(geo: THREE.BufferGeometry): { type: string; [k: string]: any } {
  return geo.userData.shape ?? { type: geo.type, ...(geo as any).parameters };
}

export function tester(geo: THREE.BufferGeometry, vs: number): Inside | null {
  const p = shapeOf(geo);
  const min = vs * .5;                        // nothing gets thinner than one voxel
  switch (p.type) {
    case 'BoxGeometry': {
      const hx = Math.max(p.width / 2, min), hy = Math.max(p.height / 2, min), hz = Math.max(p.depth / 2, min);
      const ni = Math.max(1, Math.round(2 * hx / vs)), nj = Math.max(1, Math.round(2 * hy / vs)), nk = Math.max(1, Math.round(2 * hz / vs));
      return (x, y, z) => {
        if (Math.abs(x) > hx || Math.abs(y) > hy || Math.abs(z) > hz) return false;
        ctx.box = true; ctx.ni = ni; ctx.nj = nj; ctx.nk = nk;
        ctx.li = Math.min(ni - 1, Math.max(0, Math.floor((x + hx) / vs)));
        ctx.lj = Math.min(nj - 1, Math.max(0, Math.floor((y + hy) / vs)));
        ctx.lk = Math.min(nk - 1, Math.max(0, Math.floor((z + hz) / vs)));
        return true;
      };
    }
    case 'CylinderGeometry':
    case 'ConeGeometry': {
      const rt = p.type === 'ConeGeometry' ? 0 : p.radiusTop, rb = p.type === 'ConeGeometry' ? p.radius : p.radiusBottom;
      const h = p.height, hh = Math.max(h / 2, min);
      return (x, y, z) => {
        if (Math.abs(y) > hh) return false;
        const r = Math.max(rb + (rt - rb) * (y + h / 2) / h, min);
        ctx.box = false;
        return x * x + z * z <= r * r;
      };
    }
    case 'SphereGeometry': {
      const r = p.radius, yMin = r * Math.cos(Math.min(Math.PI, (p.thetaStart ?? 0) + (p.thetaLength ?? Math.PI)));
      return (x, y, z) => { ctx.box = false; return y >= yMin - 1e-6 && x * x + y * y + z * z <= r * r; };
    }
    case 'Wedge':
      return (x, y, z) => {
        ctx.box = false;
        return Math.abs(x) <= p.w / 2 && Math.abs(z) <= p.d / 2 && y >= 0 && y <= p.h * (x + p.w / 2) / p.w;
      };
    default:
      return null;
  }
}

const _box = new THREE.Box3(), _inv = new THREE.Matrix4();

function worldBox(m: THREE.Mesh, out = new THREE.Box3()) {
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  return out.copy(m.geometry.boundingBox as THREE.Box3).applyMatrix4(m.matrixWorld);
}

const isAxisAligned = (e: ArrayLike<number>) =>
  Math.abs(e[0] - 1) < 1e-6 && Math.abs(e[5] - 1) < 1e-6 && Math.abs(e[10] - 1) < 1e-6 &&
  Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) < 1e-6;

/* first / last voxel whose centre lies in [lo,hi]; never fewer than one */
function span(lo: number, hi: number, o: number, inv: number): [number, number] {
  let a = Math.ceil((lo - o) * inv - .5 - 1e-6), b = Math.floor((hi - o) * inv - .5 + 1e-6);
  if (b < a) a = b = Math.floor(((lo + hi) / 2 - o) * inv);
  return [a, b];
}

function fillMesh(g: VoxelGrid, m: THREE.Mesh, pat: Pattern) {
  const wb = worldBox(m, _box), vs = g.vs, inv = g.inv;
  ctx.vs = vs; ctx.top = wb.max.y;
  const data = g.data;

  if (shapeOf(m.geometry).type === 'BoxGeometry' && isAxisAligned(m.matrixWorld.elements)) {
    const [i0, i1] = span(wb.min.x, wb.max.x, g.ox, inv);
    const [j0, j1] = span(wb.min.y, wb.max.y, g.oy, inv);
    const [k0, k1] = span(wb.min.z, wb.max.z, g.oz, inv);
    ctx.box = true; ctx.ni = i1 - i0 + 1; ctx.nj = j1 - j0 + 1; ctx.nk = k1 - k0 + 1;
    for (let k = Math.max(0, k0); k <= Math.min(g.nz - 1, k1); k++) {
      ctx.z = g.oz + (k + .5) * vs; ctx.lk = k - k0;
      for (let i = Math.max(0, i0); i <= Math.min(g.nx - 1, i1); i++) {
        ctx.x = g.ox + (i + .5) * vs; ctx.li = i - i0;
        const col = g.idx(i, 0, k);
        for (let j = Math.max(0, j0); j <= Math.min(g.ny - 1, j1); j++) {
          ctx.y = g.oy + (j + .5) * vs; ctx.lj = j - j0;
          data[col + j] = pat(ctx);
        }
      }
    }
    return;
  }

  const inside = tester(m.geometry, vs);
  if (!inside) { console.warn('voxelizer: unsupported shape skipped', shapeOf(m.geometry).type); return; }
  const e = _inv.copy(m.matrixWorld).invert().elements;
  const pad = vs * .5;   // thin shapes are thickened to a voxel, so widen the search to match
  const i0 = Math.max(0, g.ix(wb.min.x - pad)), i1 = Math.min(g.nx - 1, g.ix(wb.max.x + pad));
  const j0 = Math.max(0, g.iy(wb.min.y - pad)), j1 = Math.min(g.ny - 1, g.iy(wb.max.y + pad));
  const k0 = Math.max(0, g.iz(wb.min.z - pad)), k1 = Math.min(g.nz - 1, g.iz(wb.max.z + pad));
  for (let k = k0; k <= k1; k++) {
    const wz = g.oz + (k + .5) * vs;
    for (let i = i0; i <= i1; i++) {
      const wx = g.ox + (i + .5) * vs, col = g.idx(i, 0, k);
      for (let j = j0; j <= j1; j++) {
        const wy = g.oy + (j + .5) * vs;
        const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
        const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
        const lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
        if (!inside(lx, ly, lz)) continue;
        ctx.x = wx; ctx.y = wy; ctx.z = wz;
        data[col + j] = pat(ctx);
      }
    }
  }
}

/* A flat ground plane (the open ground, a worn path, the road): repaint the top
   layer of the ground slab wherever the plane's rectangle covers it. */
function paintPlane(g: VoxelGrid, m: THREE.Mesh, pat: Pattern) {
  const p = shapeOf(m.geometry), hw = p.width / 2, hh = p.height / 2;
  const wb = worldBox(m, _box), vs = g.vs;
  const e = _inv.copy(m.matrixWorld).invert().elements, wy = m.matrixWorld.elements[13];
  const j = g.groundJ - 1;
  ctx.vs = vs; ctx.box = false; ctx.y = g.oy + (j + .5) * vs; ctx.top = 0;
  const i0 = Math.max(0, g.ix(wb.min.x)), i1 = Math.min(g.nx - 1, g.ix(wb.max.x));
  const k0 = Math.max(0, g.iz(wb.min.z)), k1 = Math.min(g.nz - 1, g.iz(wb.max.z));
  for (let k = k0; k <= k1; k++) {
    const wz = g.oz + (k + .5) * vs;
    for (let i = i0; i <= i1; i++) {
      const wx = g.ox + (i + .5) * vs;
      const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      if (Math.abs(lx) > hw || Math.abs(ly) > hh) continue;
      ctx.x = wx; ctx.z = wz;
      g.data[g.idx(i, j, k)] = pat(ctx);
    }
  }
}

/* ============================ the locked ring ============================ */
// Where shots stop for good. Each outer wall's inner face is found on the lattice
// by the same centre rule the wall was filled with; WALL_LAYERS voxels behind it
// may be dug, and every column beyond that — at every height, the wall's top and
// the stubs past its corners included, out to the grid edge — is locked, exactly
// as the bottom of the ground slab is. Measured from the walls, not the grid:
// where a wall stands back from the grid edge (dust2's east and west walls sit a
// metre in, behind the ends of the north and south walls) a rim counted from the
// edge locks only the empty air outside and leaves the wall diggable end to end.
// Each side stands alone: one whose wall the map didn't mark gets the edge rim,
// and only that side does. The faces are kept too, for the player clamp (grid.ts).
function lockBounds(g: VoxelGrid, b: Bounds | undefined) {
  if (!b) {
    // Not silent: a rim at the grid edge only holds where the walls happen to stand on it.
    console.warn('voxelizer: map declares no outer walls (boundary: true on all four) — locking a rim at the grid edge instead');
    g.setLock(LOCK, g.nx - LOCK, LOCK, g.nz - LOCK); return;
  }
  // The face column on the lattice, by the centre rule: past a low-side wall the
  // first column whose centre is > face, of a high-side wall the first whose centre
  // is ≥ it. Undefined (no wall that side) → undefined.
  const lo = (f: number | undefined, o: number) => f === undefined ? f : Math.floor((f - o) * g.inv - .5 + 1e-6) + 1;
  const hi = (f: number | undefined, o: number) => f === undefined ? f : Math.ceil((f - o) * g.inv - .5 - 1e-6);
  const fi0 = lo(b.x0, g.ox), fi1 = hi(b.x1, g.ox), fk0 = lo(b.z0, g.oz), fk1 = hi(b.z1, g.oz);
  const L = WALL_LAYERS;
  g.setLock(fi0 === undefined ? LOCK : fi0 - L, fi1 === undefined ? g.nx - LOCK : fi1 + L,
    fk0 === undefined ? LOCK : fk0 - L, fk1 === undefined ? g.nz - LOCK : fk1 + L);
  g.faceI0 = fi0 ?? g.lockI0; g.faceI1 = fi1 ?? g.lockI1;
  g.faceK0 = fk0 ?? g.lockK0; g.faceK1 = fk1 ?? g.lockK1;
  g.wallTop = b.top;
  const missing = [fi0 === undefined && 'west', fi1 === undefined && 'east', fk0 === undefined && 'south', fk1 === undefined && 'north']
    .filter(Boolean);
  if (missing.length) console.warn(`voxelizer: no outer wall marked boundary: true on the ${missing.join(', ')} side — ` +
    'locking a rim at the grid edge there instead');
}

/* The ring of columns just inside the locked zone must be one unbroken wall,
   solid from the ground to the wall top: nothing locked can be dug, so that ring
   is what nobody gets past. A column of it that isn't solid is a way out of the
   map — a map bug, so say so once, at load. */
function checkRing(g: VoxelGrid, top: number) {
  const j1 = Math.min(g.ny, Math.round((top - g.oy) * g.inv));
  const { lockI0: a, lockI1: b, lockK0: c, lockK1: d } = g;
  let open = 0, at = '';
  const col = (i: number, k: number) => {
    let ok = g.inside(i, 0, k);
    for (let j = g.groundJ; ok && j < j1; j++) ok = g.data[g.idx(i, j, k)] !== 0;
    if (!ok && open++ === 0) at = `x ${(g.ox + (i + .5) * g.vs).toFixed(2)}, z ${(g.oz + (k + .5) * g.vs).toFixed(2)}`;
  };
  for (let i = a - 1; i <= b; i++) { col(i, c - 1); col(i, d); }   // corners included
  for (let k = c; k < d; k++) { col(a - 1, k); col(b, k); }
  if (open) console.warn(`voxelizer: locked ring has ${open} open column(s), first at ${at}: players can get out of the map there`);
}

export interface VoxelMap { fine: VoxelGrid; far: VoxelGrid; }

export function voxelizeMap(built: BuiltMap, ground: Surface): VoxelMap {
  built.group.updateMatrixWorld(true);

  // The playable block is whatever the colliders span — the boundary walls are
  // colliders too, so this is exactly "inside the walls, walls included".
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of built.colliders) {
    x0 = Math.min(x0, c.x - c.hx); x1 = Math.max(x1, c.x + c.hx);
    z0 = Math.min(z0, c.z - c.hz); z1 = Math.max(z1, c.z + c.hz);
  }
  x0 = Math.floor(x0); z0 = Math.floor(z0); x1 = Math.ceil(x1); z1 = Math.ceil(z1);

  const planes: THREE.Mesh[] = [], near: THREE.Mesh[] = [], distant: THREE.Mesh[] = [];
  const all = new THREE.Box3(), wb = new THREE.Box3();
  let nearTop = 4;
  built.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    worldBox(m, wb); all.union(wb);
    if (shapeOf(m.geometry).type === 'PlaneGeometry') {
      if (Math.abs(m.matrixWorld.elements[9]) > .9) planes.push(m);   // lying flat
      return;
    }
    const cx = (wb.min.x + wb.max.x) / 2, cz = (wb.min.z + wb.max.z) / 2;
    if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) { near.push(m); nearTop = Math.max(nearTop, wb.max.y); }
    else distant.push(m);
  });

  const oy = -GROUND_LAYERS * VS;
  const fine = new VoxelGrid(
    Math.round((x1 - x0) / VS), Math.ceil((nearTop + 1 - oy) / VS), Math.round((z1 - z0) / VS), VS, x0, oy, z0);
  fine.groundJ = GROUND_LAYERS; lockBounds(fine, built.bounds);

  const fx0 = Math.floor(all.min.x), fz0 = Math.floor(all.min.z);
  const far = new VoxelGrid(
    Math.ceil(all.max.x) - fx0, Math.ceil(all.max.y) + 2, Math.ceil(all.max.z) - fz0, FAR_VS, fx0, -FAR_VS, fz0);
  far.groundJ = 1;

  // the ground slab: subsoil all the way down, repainted on top by the planes
  const sub = subsoil(ground);
  for (const g of [fine, far]) {
    for (let k = 0; k < g.nz; k++) for (let i = 0; i < g.nx; i++) {
      const col = g.idx(i, 0, k);
      for (let j = 0; j < g.groundJ; j++) g.data[col + j] = sub;
    }
    for (const m of planes) paintPlane(g, m, patternFor(m.material as THREE.Material));
  }

  for (const m of near) fillMesh(fine, m, patternFor(m.material as THREE.Material));
  for (const m of distant) fillMesh(far, m, patternFor(m.material as THREE.Material));

  // the backdrop's ground has a hole where the fine grid stands, so the two
  // never draw the same patch of floor twice
  for (let k = z0 - fz0; k < z1 - fz0; k++) for (let i = x0 - fx0; i < x1 - fx0; i++) far.set(i, 0, k, 0);

  if (built.bounds) checkRing(fine, built.bounds.top);
  fine.sealPadding(); far.sealPadding();
  return { fine, far };
}
