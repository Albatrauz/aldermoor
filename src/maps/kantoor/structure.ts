/* ============================ kantoor — the shell ============================ */
// Walls, floors, roof and stair, generated from the vectorised floor plans in
// plan.ts rather than typed in by hand: every wall here is a line somebody drew
// on the estate agent's plan, and every door and window a gap in it.
//
// What the plan cannot say, this file decides:
//   • how thick a wall is in the game (outer 0.75, inner 0.5, glass 0.25/0.5);
//   • how wide a door is — never under 2.5 m, or the player does not fit;
//   • what a window is. The voxel engine has no transparency, so a window is a
//     hole: a sill at 1 m (vaultable), a head at 3.25 m, a dark frame round it.
//     A glass partition is a pale glass band to the same sill, open above, with
//     posts — cover you can see and shoot over, as the real thing lets you see.
import * as THREE from 'three';
import { GROUND, UPPER, type PFloor, type PWall, type POpening, type PPt } from './plan';
import {
  type Kit, type Cut, type Pt, P, gx, gz, along, dist, snap,
  L0, CEIL0, L1, CEIL1, ROOF, PARAPET, DOOR_H, SILL, HEAD, VS,
} from './kit';
import {
  matKBrick, matKBrickWhite, matKFrame, matKGlass, matKGlassPale, matKRoof, matKWall,
  matKCeiling, matKCarpet, matKTile, matKGreyLight, matKGrey, matKSteel, matKDeskTop, matKGreyDark,
} from '../../materials';

export const toGame = (poly: PPt[]): Pt[] => poly.map(([x, y]) => P(x, y));

/* The outlines (outer wall faces) of the two storeys, the hole in the upper
   floor that the stair climbs through, and the footprint of the raised glass
   roof over the atrium — all in game coordinates. */
export const G_OUTLINE = toGame(GROUND.outline);
export const U_OUTLINE = toGame(UPPER.outline);
export const VOID = toGame(UPPER.void as PPt[]).map(([x, z]) => [snap(x), snap(z)] as Pt);
export const VOID_BOX = {
  x0: Math.min(...VOID.map((p) => p[0])), x1: Math.max(...VOID.map((p) => p[0])),
  z0: Math.min(...VOID.map((p) => p[1])), z1: Math.max(...VOID.map((p) => p[1])),
};
// The atrium strip: as wide as the entrance, from the upper floor's glass front
// back to the wall behind the head of the stair. The roof is left open over it;
// facade.ts stands the raised roof lantern on this footprint, and its tall south
// glass front in place of the plan's own (skipped here).
export const LANTERN_BOX = { x0: snap(gx(-15.51)), x1: snap(gx(-10.103)), z0: snap(gz(13.082)), z1: snap(gz(24.75)) };
export const LANTERN: Pt[] = [
  [LANTERN_BOX.x0, LANTERN_BOX.z0], [LANTERN_BOX.x1, LANTERN_BOX.z0],
  [LANTERN_BOX.x1, LANTERN_BOX.z1], [LANTERN_BOX.x0, LANTERN_BOX.z1],
];
// The stair: a straight flight inside the void, foot at the south (toward the
// entrance), head at the void's north edge.
export const STAIR = { x0: VOID_BOX.x0, x1: VOID_BOX.x1, zFoot: snap(gz(21.689)), zHead: VOID_BOX.z0 };

function inPoly(pts: Pt[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const SKIP_WALLS = new Set(['O_glassfront']);
// Openings the plan draws as glazing but which are doors in the building: the
// upper floor's two emergency exits beside the fire-escape, and the middle pane
// of the receptie's glass wall (the photographs show a glass door there).
const ESCAPE_DOORS = new Set(['ESC1', 'ESC2', 'O_REC2']);
const MIN_DOOR = 2.5;
const PANE = 3;           // widest pane of a glazed front before it gets a post

/* A gap in a wall, measured along it, with heights above the storey's floor. */
interface Gap { a: number; b: number; sill: number; head: number; kind: POpening['kind']; }

function gapsOf(w: PWall, ops: POpening[], A: Pt, B: Pt, L: number): Gap[] {
  const out: Gap[] = [];
  for (const o of ops) {
    let a = along(A, B, P(o.a[0], o.a[1])), b = along(A, B, P(o.b[0], o.b[1]));
    if (a > b) [a, b] = [b, a];
    a = Math.max(0, a); b = Math.min(L, b);
    if (b - a < .2) continue;
    if (o.kind === 'door' || o.kind === 'double-door' || o.kind === 'opening' || ESCAPE_DOORS.has(o.id)) {
      if (b - a < MIN_DOOR) {
        const mid = (a + b) / 2, lo = Math.min(a, .25), hi = Math.max(b, L - .25);
        a = Math.max(lo, mid - MIN_DOOR / 2); b = Math.min(hi, a + MIN_DOOR); a = Math.max(lo, b - MIN_DOOR);
      }
      out.push({ a: snap(a), b: snap(b), sill: 0, head: DOOR_H, kind: 'door' });
    } else if (o.kind === 'window') {
      out.push({ a: snap(a), b: snap(b), sill: SILL, head: HEAD, kind: o.kind });
    } else {
      // a glazed front: split into panes with a post between
      const n = Math.max(1, Math.ceil((b - a) / PANE)), w1 = (b - a - (n - 1) * VS) / n;
      for (let i = 0; i < n; i++) {
        const pa = a + i * (w1 + VS);
        out.push({ a: pa, b: pa + w1, sill: SILL, head: HEAD + .25, kind: o.kind });
      }
    }
  }
  return out;
}

export interface StoreyOpts {
  y0: number;              // the storey's floor
  ceil: number;            // underside of what is above it
  outerBase: number;       // where the facade starts (the upper storey's runs down past its slab)
  outerTop: number;        // …and stops
  outline: Pt[];
  skin(w: PWall): THREE.Material;
}

function storey(k: Kit, f: PFloor, o: StoreyOpts) {
  const ops = new Map<string, POpening[]>();
  for (const p of f.openings) { if (!ops.has(p.wall)) ops.set(p.wall, []); (ops.get(p.wall) as POpening[]).push(p); }
  const linings: (() => void)[] = [], frames: (() => void)[] = [];
  // A curved partition is drawn as a run of short chords, and a door in one can
  // be wider than the chord it sits on. So the doors of curved walls are kept as
  // points, and every chord near one opens for it.
  const kindOf = new Map(f.walls.map((w) => [w.id, w.kind] as const));
  const curvedDoors: Pt[] = f.openings
    .filter((p) => kindOf.get(p.wall) === 'curved' && (p.kind === 'door' || p.kind === 'double-door'))
    .map((p) => P((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2));

  for (const w of f.walls) {
    const A = P(w.a[0], w.a[1]), B = P(w.b[0], w.b[1]), L = dist(A, B);
    if (L < .05 || SKIP_WALLS.has(w.id)) continue;
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
    const at = (s: number): Pt => [A[0] + ux * s, A[1] + uz * s];
    const gaps = gapsOf(w, ops.get(w.id) ?? [], A, B, L);
    const sub = (s0: number, s1: number, opts: Parameters<Kit['wall']>[4]) => {
      const p = at(s0), q = at(s1); k.wall(p[0], p[1], q[0], q[1], { ext: 0, ...opts });
    };

    if (w.kind === 'outer') {
      const mat = o.skin(w), off = o.y0 - o.outerBase, t = .75;
      const cuts: Cut[] = gaps.map((g) => ({
        a: g.a, b: g.b, sill: off + g.sill, head: off + g.head,
        sillMat: g.kind === 'glass-front' ? matKGlass : undefined,
      }));
      k.wall(A[0], A[1], B[0], B[1], { t, mat, y0: o.outerBase, y1: o.outerTop, cuts });
      // the plaster face inside: one voxel, on whichever side is indoors
      let nx = -uz, nz = ux;
      const m = at(L / 2);
      if (!inPoly(o.outline, m[0] + nx * 1.5, m[1] + nz * 1.5)) { nx = -nx; nz = -nz; }
      linings.push(() => k.wall(A[0] + nx * .25, A[1] + nz * .25, B[0] + nx * .25, B[1] + nz * .25, {
        t: .25, ext: .125, mat: matKWall, y0: o.y0, y1: o.ceil,
        cuts: gaps.map((g) => ({ a: g.a, b: g.b, sill: g.sill, head: g.head, sillMat: g.kind === 'glass-front' ? matKGlass : undefined })),
      }));
      // frames: a dark strip on the sill and under the head; posts between the panes of a glazed front
      frames.push(() => {
        for (const g of gaps) {
          if (g.kind === 'window' || g.kind === 'glass-front') {
            sub(g.a, g.b, { t, mat: matKFrame, y0: o.y0 + g.sill - VS, y1: o.y0 + g.sill });
            sub(g.a, g.b, { t, mat: matKFrame, y0: o.y0 + g.head, y1: o.y0 + g.head + VS });
          }
        }
        const gf = gaps.filter((g) => g.kind === 'glass-front').sort((p, q) => p.a - q.a);
        for (let i = 0; i + 1 < gf.length; i++) {
          if (gf[i + 1].a - gf[i].b < VS * 1.5) sub(gf[i].b, gf[i + 1].a, { t, mat: matKFrame, y0: o.y0, y1: o.y0 + HEAD + .5 });
        }
      });
    } else if (w.kind === 'inner') {
      k.wall(A[0], A[1], B[0], B[1], {
        t: .5, mat: matKWall, y0: o.y0, y1: o.ceil,
        cuts: gaps.map((g) => ({ a: g.a, b: g.b, sill: g.sill, head: g.head, sillMat: g.sill > 0 ? matKGlassPale : undefined })),
      });
    } else {
      // glass partition: a pale band to sill height, a header under the ceiling, posts
      const axis = Math.abs(ux) < 1e-6 || Math.abs(uz) < 1e-6, t = axis ? .25 : .5;
      const doors = gaps.filter((g) => g.sill === 0);
      if (w.kind === 'curved') {
        for (const c of curvedDoors) {
          const sc = along(A, B, c), off = Math.abs((c[0] - A[0]) * uz - (c[1] - A[1]) * ux);
          if (off > 1 || sc < -MIN_DOOR / 2 || sc > L + MIN_DOOR / 2) continue;
          doors.push({ a: Math.max(-.25, sc - MIN_DOOR / 2), b: Math.min(L + .25, sc + MIN_DOOR / 2), sill: 0, head: DOOR_H, kind: 'door' });
        }
      }
      k.wall(A[0], A[1], B[0], B[1], {
        t, mat: matKGlassPale, y0: o.y0, y1: o.y0 + SILL, cuts: doors.map((g) => ({ a: g.a, b: g.b })),
      });
      k.wall(A[0], A[1], B[0], B[1], { t, mat: matKFrame, y0: o.y0 + SILL - VS, y1: o.y0 + SILL, cuts: doors.map((g) => ({ a: g.a, b: g.b })) });
      k.wall(A[0], A[1], B[0], B[1], { t, mat: matKWall, y0: o.y0 + HEAD, y1: o.ceil });
      const inDoor = (s: number) => doors.some((g) => s > g.a - .3 && s < g.b + .3);
      const n = Math.max(1, Math.round(L / PANE));
      for (let i = 0; i <= n; i++) {
        const s = L * i / n;
        if (inDoor(s)) continue;
        const p = at(s);
        k.box(snap(p[0]) - .125, snap(p[0]) + .125, o.y0, o.y0 + HEAD, snap(p[1]) - .125, snap(p[1]) + .125, matKFrame);
      }
      for (const g of doors) for (const s of [g.a - .125, g.b + .125]) {
        if (s < 0 || s > L) continue;
        const p = at(s);
        k.box(snap(p[0]) - .125, snap(p[0]) + .125, o.y0, o.y0 + HEAD, snap(p[1]) - .125, snap(p[1]) + .125, matKFrame);
      }
    }
  }
  for (const fn of linings) fn();
  for (const fn of frames) fn();
}

/* ---- floor finishes ---- */
// What each room is floored with. Anything not listed follows the plan's own
// colour coding: grey circulation = stone tile, blue = sanitary tile, the rest carpet.
const FLOOR_BY_ROOM: Record<string, THREE.Material> = {};
export function floorMat(r: { id: string; floor: string }): THREE.Material {
  return FLOOR_BY_ROOM[r.id] ?? (r.floor === 'grey' ? matKTile : r.floor === 'blue' ? matKGreyLight : matKCarpet);
}
export function setFloor(id: string, mat: THREE.Material) { FLOOR_BY_ROOM[id] = mat; }

/* ---- facade skins ---- */
// The building is a two-tone box: white brick round the ground storey, mottled
// anthracite brick above it. A wall listed here wears something else.
const SKIN: Record<string, THREE.Material> = {};
export function setSkin(wallId: string, mat: THREE.Material) { SKIN[wallId] = mat; }
const skinGround = (w: PWall) => SKIN[w.id] ?? matKBrickWhite;
const skinUpper = (w: PWall) => SKIN[w.id] ?? matKBrick;

export function buildStructure(k: Kit) {
  /* ---- floors and roof first: the facades are laid over their edges ---- */
  // ground floor: finishes painted onto the ground itself
  k.paint(G_OUTLINE, matKCarpet);
  for (const r of GROUND.rooms) k.paint(toGame(r.poly), floorMat(r));

  // upper floor slab, with the stair void cut out of it: ceiling below, finish on top
  k.poly(U_OUTLINE, CEIL0, L1 - VS, matKCeiling, [VOID]);
  k.poly(U_OUTLINE, L1 - VS, L1, matKCarpet, [VOID]);
  // (upstairs even the circulation is carpeted; only the toilets are tiled)
  for (const r of UPPER.rooms) {
    const m = FLOOR_BY_ROOM[r.id] ?? (r.floor === 'blue' ? matKGrey : matKCarpet);
    if (m !== matKCarpet) k.poly(toGame(r.poly), L1 - VS, L1, m, [VOID]);
  }
  // the low roof over whatever the ground floor has that the upper floor does not (the entrance porch)
  k.poly(G_OUTLINE, CEIL0, CEIL0 + VS, matKCeiling, [U_OUTLINE]);
  k.poly(G_OUTLINE, CEIL0 + VS, L1, matKRoof, [U_OUTLINE]);

  // main roof, open over the atrium strip
  k.poly(U_OUTLINE, CEIL1, CEIL1 + VS, matKCeiling, [LANTERN]);
  k.poly(U_OUTLINE, CEIL1 + VS, ROOF, matKRoof, [LANTERN]);

  /* ---- walls ---- */
  storey(k, GROUND, { y0: L0, ceil: CEIL0, outerBase: L0, outerTop: L1, outline: G_OUTLINE, skin: skinGround });
  storey(k, UPPER, { y0: L1, ceil: CEIL1, outerBase: CEIL0, outerTop: PARAPET, outline: U_OUTLINE, skin: skinUpper });

  /* ---- stair and the railing round its void ---- */
  k.stairs('z', STAIR.zFoot, STAIR.zHead, STAIR.x0, STAIR.x1, L0, L1, matKSteel, .75, matKDeskTop);
  const { x0, x1, z0, z1 } = VOID_BOX, rail = L1 + 1.25;
  k.box(x0 - VS, x0, L1, rail, z0, z1 + VS, matKGreyDark);        // west
  k.box(x1, x1 + VS, L1, rail, z0, z1 + VS, matKGreyDark);        // east
  k.box(x0 - VS, x1 + VS, L1, rail, z1, z1 + VS, matKGreyDark);   // south end; the north end is where the stair arrives
}

/* ---- rooms, for dressing and for callouts ---- */
export interface Room { id: string; label: string; storey: 0 | 1; y: number; poly: Pt[]; cx: number; cz: number; x0: number; x1: number; z0: number; z1: number; }
function roomsOf(f: PFloor, storeyNo: 0 | 1): Room[] {
  return f.rooms.map((r) => {
    const poly = toGame(r.poly);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); sx += x; sz += z; }
    // the box is snapped to the lattice, so furniture placed from it lands on whole voxels
    return {
      id: r.id, label: r.label, storey: storeyNo, y: storeyNo ? L1 : L0, poly, cx: sx / poly.length, cz: sz / poly.length,
      x0: snap(x0), x1: snap(x1), z0: snap(z0), z1: snap(z1),
    };
  });
}
export const ROOMS: Room[] = [...roomsOf(GROUND, 0), ...roomsOf(UPPER, 1)];
export const room = (id: string): Room => {
  const r = ROOMS.find((q) => q.id === id);
  if (!r) throw new Error(`kantoor: no room ${id}`);
  return r;
};
