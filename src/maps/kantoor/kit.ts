/* ============================ kantoor — building kit ============================ */
// The office map is a replica of a real building, drawn from its floor plans.
// Those plans are not a grid of axis-aligned lanes like the other two maps: the
// west facade is slanted, glass partitions curve, and there are two storeys. This
// kit is the small layer on top of the map toolkit that makes that comfortable:
//
//   • one coordinate transform from the plan (metres, as drawn) to the game;
//   • the storey heights, named once;
//   • boxes by their extents, walls at any angle with door / window cuts,
//     extruded polygons (floors with a void in them), cylinders, stairs.
//
// Nothing here adds colliders. The voxel engine resolves movement and shots
// against voxels; colliders only tell the voxelizer how far the playable block
// reaches, and the four boundary walls (grounds.ts) already say that.
//
// Everything lands on the 0.25 m voxel lattice on purpose: an axis-aligned box
// whose faces sit on the lattice fills exactly the voxels it covers, so walls
// come out a whole number of voxels thick and floors a whole number high.
import * as THREE from 'three';
import { mesh } from '../../core';
import type { Builder } from '../../mapkit';

export const VS = 0.25;

/* ============================ plan → game ============================ */
// The plan frame is the one the floor plans were vectorised in: origin at the
// outer north-east corner of the building, x east (so the building is x < 0),
// y south, in real metres. The game frame is three's: X east, Z south, Y up —
// the same handedness seen from above, so nothing is mirrored.
//
// Horizontal distances are stretched 2.5×. The player is a 1.1 m wide circle
// that runs at 9 m/s; a real 0.9 m door is a wall to them and a real 27 m
// building is three seconds end to end. At 2.5× the doors are passable, the
// corridors are lanes and the offices are rooms you can fight across. Heights
// are stretched far less (a 2.7 m ceiling becomes 4.25 m), as on the other maps.
export const S = 2.5;
export const PLAN_CX = -14, PLAN_CY = 14;   // the plan point that lands on the game origin
export const snap = (v: number) => Math.round(v / VS) * VS;
export const gx = (px: number) => (px - PLAN_CX) * S;
export const gz = (py: number) => (py - PLAN_CY) * S;
/* a plan point as a game [x, z] pair */
export const P = (px: number, py: number): [number, number] => [gx(px), gz(py)];

/* ============================ storey heights (game metres) ============================ */
export const L0 = 0;          // ground-floor finish = the ground outside
export const CEIL0 = 4.25;    // underside of the upper-floor slab
export const L1 = 5;          // upper-floor finish
export const CEIL1 = 9;       // underside of the roof
export const ROOF = 9.75;     // top of the roof slab
export const PARAPET = 10.5;  // top of the roof edge
export const DOOR_H = 3;      // clear height of a doorway, above its floor
export const SILL = 1;        // window sill above its floor: waist high, and vaultable
export const HEAD = 3.25;     // window head above its floor

export type Pt = [number, number];

/* A hole in a wall. `a`..`b` are distances along the wall from its first point,
   in game metres. The wall is solid below `sill` and above `head` (both measured
   from the wall's base); between them it is open. A door is sill 0. */
export interface Cut {
  a: number; b: number;
  sill?: number; head?: number;
  sillMat?: THREE.Material; headMat?: THREE.Material;
}
export interface WallOpts {
  mat: THREE.Material;
  t?: number;            // thickness, a multiple of 0.25 (default 0.5)
  y0?: number; y1?: number;
  cuts?: Cut[];
  ext?: number;          // how far each end runs past its point (default t/2, which closes corners)
}

export interface Kit {
  B: Builder;
  /* axis-aligned box by its extents */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material): void;
  /* box of length `len` (along the direction `deg`, measured from +X toward +Z) and thickness `t`, centred on (cx, cz) */
  obox(cx: number, cz: number, len: number, t: number, y0: number, y1: number, deg: number, mat: THREE.Material): void;
  /* wall from (x1,z1) to (x2,z2) at any angle, with cuts */
  wall(x1: number, z1: number, x2: number, z2: number, o: WallOpts): void;
  /* a wall along each edge of a polyline */
  polyline(pts: Pt[], o: WallOpts, closed?: boolean): void;
  /* extruded polygon (game x,z points), minus optional holes */
  poly(pts: Pt[], y0: number, y1: number, mat: THREE.Material, holes?: Pt[][]): void;
  /* repaint the surface of the ground inside a polygon (ground level only) */
  paint(pts: Pt[], mat: THREE.Material, holes?: Pt[][]): void;
  /* repaint a rectangle of ground */
  paintRect(x0: number, x1: number, z0: number, z1: number, mat: THREE.Material): void;
  /* upright cylinder */
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, mat: THREE.Material): void;
  /* a flight of stairs: `from`..`to` along `axis` is the run, bottom to top;
     `lo`..`hi` is its width across. Open underneath (a stringer `thick` deep).
     `tread` dresses the top of each step in another material. */
  stairs(axis: 'x' | 'z', from: number, to: number, lo: number, hi: number, y0: number, y1: number,
    mat: THREE.Material, thick?: number, tread?: THREE.Material): void;
}

/* x-intervals where the horizontal line z = zc is inside the polygon */
function crossings(pts: Pt[], zc: number): number[] {
  const xs: number[] = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    if ((az <= zc) === (bz <= zc)) continue;
    xs.push(ax + (bx - ax) * (zc - az) / (bz - az));
  }
  return xs.sort((p, q) => p - q);
}
/* subtract interval list `b` from interval list `a` (both flat, sorted pairs) */
function subtract(a: number[], b: number[]): number[] {
  let out = a;
  for (let j = 0; j + 1 < b.length; j += 2) {
    const h0 = b[j], h1 = b[j + 1], next: number[] = [];
    for (let i = 0; i + 1 < out.length; i += 2) {
      const s0 = out[i], s1 = out[i + 1];
      if (h1 <= s0 || h0 >= s1) { next.push(s0, s1); continue; }
      if (h0 > s0) next.push(s0, h0);
      if (h1 < s1) next.push(h1, s1);
    }
    out = next;
  }
  return out;
}
/* Walk a polygon one voxel row at a time and hand back rectangles on the voxel
   lattice: exactly the voxels whose centre lies inside. Rows that cover the same
   span are merged, so a rectangle comes out as one piece. */
function rows(pts: Pt[], holes: Pt[][], emit: (x0: number, x1: number, z0: number, z1: number) => void) {
  let zmin = Infinity, zmax = -Infinity;
  for (const p of pts) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  const k0 = Math.floor(zmin / VS), k1 = Math.ceil(zmax / VS);
  let key = '', run: number[] = [], rz0 = 0, rz1 = 0;
  const flush = () => { for (let i = 0; i + 1 < run.length; i += 2) emit(run[i], run[i + 1], rz0, rz1); };
  for (let k = k0; k < k1; k++) {
    const zc = (k + .5) * VS;
    let iv = crossings(pts, zc);
    for (const h of holes) iv = subtract(iv, crossings(h, zc));
    const q: number[] = [];
    for (let i = 0; i + 1 < iv.length; i += 2) {
      const a = Math.ceil(iv[i] / VS - .5 - 1e-6) * VS, b = (Math.floor(iv[i + 1] / VS - .5 + 1e-6) + 1) * VS;
      if (b > a) q.push(a, b);
    }
    const kk = q.join(',');
    if (kk === key) { rz1 = (k + 1) * VS; continue; }
    flush();
    key = kk; run = q; rz0 = k * VS; rz1 = (k + 1) * VS;
  }
  flush();
}

export function createKit(B: Builder): Kit {
  const box: Kit['box'] = (x0, x1, y0, y1, z0, z1, mat) => {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    B.add(mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  };

  const obox: Kit['obox'] = (cx, cz, len, t, y0, y1, deg, mat) => {
    if (len < 1e-4 || y1 - y0 < 1e-4) return;
    const d = ((deg % 180) + 180) % 180;
    if (d < .01 || d > 179.99) return box(cx - len / 2, cx + len / 2, y0, y1, cz - t / 2, cz + t / 2, mat);
    if (Math.abs(d - 90) < .01) return box(cx - t / 2, cx + t / 2, y0, y1, cz - len / 2, cz + len / 2, mat);
    B.add(mesh(new THREE.BoxGeometry(len, y1 - y0, t), mat, cx, (y0 + y1) / 2, cz, { ry: -deg * Math.PI / 180 }));
  };

  const wall: Kit['wall'] = (x1, z1, x2, z2, o) => {
    const t = o.t ?? .5, y0 = o.y0 ?? L0, y1 = o.y1 ?? CEIL0, ext = o.ext ?? t / 2;
    const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
    if (L < 1e-4) return;
    const ux = dx / L, uz = dz / L;
    const alongX = Math.abs(uz) < 1e-6, alongZ = Math.abs(ux) < 1e-6;
    const deg = Math.atan2(uz, ux) * 180 / Math.PI;
    // one piece of the wall, from s0 to s1 along it and ya to yb up it
    const seg = (s0: number, s1: number, ya: number, yb: number, mat: THREE.Material) => {
      if (s1 - s0 < 1e-3 || yb - ya < 1e-3) return;
      const ax = x1 + ux * s0, az = z1 + uz * s0, bx = x1 + ux * s1, bz = z1 + uz * s1;
      if (alongX) { const lo = snap(z1 - t / 2); box(snap(Math.min(ax, bx)), snap(Math.max(ax, bx)), ya, yb, lo, lo + t, mat); }
      else if (alongZ) { const lo = snap(x1 - t / 2); box(lo, lo + t, ya, yb, snap(Math.min(az, bz)), snap(Math.max(az, bz)), mat); }
      else obox((ax + bx) / 2, (az + bz) / 2, s1 - s0, t, ya, yb, deg, mat);
    };
    const cuts = [...(o.cuts ?? [])]
      .map((c) => ({ ...c, a: Math.max(-ext, Math.min(c.a, c.b)), b: Math.min(L + ext, Math.max(c.a, c.b)) }))
      .filter((c) => c.b - c.a > 1e-3)
      .sort((p, q) => p.a - q.a);
    let cur = -ext;
    for (const c of cuts) {
      if (c.a > cur + 1e-3) seg(cur, c.a, y0, y1, o.mat);
      const a = Math.max(cur, c.a);
      if (c.b > a) {
        if ((c.sill ?? 0) > 0) seg(a, c.b, y0, Math.min(y1, y0 + (c.sill as number)), c.sillMat ?? o.mat);
        if (c.head !== undefined && y0 + c.head < y1) seg(a, c.b, y0 + c.head, y1, c.headMat ?? o.mat);
      }
      cur = Math.max(cur, c.b);
    }
    if (cur < L + ext - 1e-3) seg(cur, L + ext, y0, y1, o.mat);
  };

  const polyline: Kit['polyline'] = (pts, o, closed = false) => {
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      wall(a[0], a[1], b[0], b[1], o);
    }
  };

  const poly: Kit['poly'] = (pts, y0, y1, mat, holes = []) =>
    rows(pts, holes, (x0, x1, z0, z1) => box(x0, x1, y0, y1, z0, z1, mat));

  const paintRect: Kit['paintRect'] = (x0, x1, z0, z1, mat) => {
    if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) return;
    B.add(mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat, (x0 + x1) / 2, .02, (z0 + z1) / 2,
      { rx: -Math.PI / 2, cast: false }));
  };
  const paint: Kit['paint'] = (pts, mat, holes = []) =>
    rows(pts, holes, (x0, x1, z0, z1) => paintRect(x0, x1, z0, z1, mat));

  const cyl: Kit['cyl'] = (cx, cz, r, y0, y1, mat) => {
    if (y1 - y0 < 1e-4) return;
    B.add(mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 16), mat, cx, (y0 + y1) / 2, cz));
  };

  const stairs: Kit['stairs'] = (axis, from, to, lo, hi, y0, y1, mat, thick = .75, tread) => {
    const n = Math.max(1, Math.round((y1 - y0) / VS)), dir = Math.sign(to - from) || 1;
    for (let i = 0; i < n; i++) {
      const a = snap(from + (to - from) * i / n), b = snap(from + (to - from) * (i + 1) / n);
      const top = y0 + (i + 1) * VS, bot = Math.max(y0, top - thick);
      // each step reaches one voxel under the next, so the flight is one connected piece
      const b2 = i < n - 1 ? b + dir * VS : b;
      const put = (ya: number, yb: number, e: number, m: THREE.Material) =>
        axis === 'z' ? box(lo, hi, ya, yb, a, e, m) : box(a, e, ya, yb, lo, hi, m);
      put(bot, top, b2, mat);
      if (tread) put(top - VS, top, b, tread);
    }
  };

  return { B, box, obox, wall, polyline, poly, paint, paintRect, cyl, stairs };
}

/* ============================ small geometry helpers ============================ */
/* distance along the segment a→b of the point nearest to p (may fall outside 0..length) */
export function along(a: Pt, b: Pt, p: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L;
}
export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/* centre of a polygon's bounding box, and the box itself */
export function bbox(pts: Pt[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}
