/* ============================ kantoor — furniture ============================ */
// The things an office is recognised by, as a few boxes each. All sizes are in
// game metres and sit on the 0.25 m lattice. Horizontal distances in this map
// are 2.5× life size (see kit.ts), so a desk is 4 m wide — but it stands 1 m
// high, because the player is life size and furniture is cover: low enough to
// shoot over and to jump onto, high enough to stop a bullet at the waist.
//
// `dir` is always the way a thing FACES — the way someone sitting at the desk,
// on the chair or the sofa looks; the way a cabinet's doors or a mural point.
// 'n' is −Z (plan north), 's' +Z, 'e' +X, 'w' −X. `y0` is the floor it stands on.
import * as THREE from 'three';
import type { Kit } from './kit';
import {
  matKDeskTop, matKWhite, matKBlack, matKGrey, matKGreyDark, matKGreyLight, matKSteel,
  matKGreen, matKPot, matKLight,
} from '../../materials';

export type Dir = 'n' | 'e' | 's' | 'w';
const FWD: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const RIGHT: Record<Dir, [number, number]> = { n: [1, 0], s: [-1, 0], e: [0, 1], w: [0, -1] };

/* A box given in a thing's own frame: `u` runs to its right, `v` forward (the
   way it faces), both measured from (cx, cz). */
export function lbox(k: Kit, cx: number, cz: number, dir: Dir,
  u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, mat: THREE.Material) {
  const [fx, fz] = FWD[dir], [rx, rz] = RIGHT[dir];
  const ax = cx + rx * u0 + fx * v0, az = cz + rz * u0 + fz * v0;
  const bx = cx + rx * u1 + fx * v1, bz = cz + rz * u1 + fz * v1;
  k.box(Math.min(ax, bx), Math.max(ax, bx), y0, y1, Math.min(az, bz), Math.max(az, bz), mat);
}

/* ---- seating ---- */
/* office chair: 1 × 1 m, seat at 0.5, back to 1.25 */
export function chair(k: Kit, cx: number, cz: number, dir: Dir, y0: number, mat: THREE.Material = matKBlack) {
  lbox(k, cx, cz, dir, -.25, .25, -.25, .25, y0, y0 + .25, matKGreyDark);     // pedestal
  lbox(k, cx, cz, dir, -.5, .5, -.5, .5, y0 + .25, y0 + .5, mat);             // seat
  lbox(k, cx, cz, dir, -.5, .5, -.5, -.25, y0 + .5, y0 + 1.25, mat);          // back
}
/* sofa `w` wide and 1.75 deep, back to 1.25 */
export function sofa(k: Kit, cx: number, cz: number, w: number, dir: Dir, y0: number, mat: THREE.Material) {
  const h = w / 2;
  lbox(k, cx, cz, dir, -h, h, -.875, .875, y0, y0 + .5, mat);                 // seat
  lbox(k, cx, cz, dir, -h, h, -.875, -.375, y0 + .5, y0 + 1.25, mat);         // back
  lbox(k, cx, cz, dir, -h, -h + .5, -.375, .875, y0 + .5, y0 + 1, mat);       // arms
  lbox(k, cx, cz, dir, h - .5, h, -.375, .875, y0 + .5, y0 + 1, mat);
}
/* bar stool: a post and a round seat at 1.0 */
export function stool(k: Kit, cx: number, cz: number, y0: number, mat: THREE.Material = matKBlack) {
  k.box(cx - .125, cx + .125, y0, y0 + .75, cz - .125, cz + .125, matKSteel);
  k.box(cx - .375, cx + .375, y0 + .75, y0 + 1, cz - .375, cz + .375, mat);
}

/* ---- desks and tables ---- */
export interface DeskOpts { w?: number; d?: number; top?: THREE.Material; monitors?: number; chair?: boolean; screen?: THREE.Material | null; }
/* A workstation: worktop at 1.0 on two side panels, monitors along the far
   edge, a chair on the near side. `dir` is the way the sitter faces. A `screen`
   material adds a low privacy panel behind the monitors (to 1.75). */
export function desk(k: Kit, cx: number, cz: number, dir: Dir, y0: number, o: DeskOpts = {}) {
  const w = o.w ?? 4, d = o.d ?? 2, hw = w / 2, hd = d / 2, top = o.top ?? matKDeskTop;
  lbox(k, cx, cz, dir, -hw, hw, -hd, hd, y0 + .75, y0 + 1, top);
  lbox(k, cx, cz, dir, -hw, -hw + .25, -hd, hd, y0, y0 + .75, matKGreyLight);
  lbox(k, cx, cz, dir, hw - .25, hw, -hd, hd, y0, y0 + .75, matKGreyLight);
  const n = o.monitors ?? 2;
  for (let i = 0; i < n; i++) {
    const u = (i - (n - 1) / 2) * 1.75 + (n % 2 ? .125 : 0);   // keeps every edge on the 0.25 lattice
    lbox(k, cx, cz, dir, u - .125, u + .125, hd - .75, hd - .5, y0 + 1, y0 + 1.25, matKBlack);   // stand
    lbox(k, cx, cz, dir, u - .625, u + .625, hd - .75, hd - .5, y0 + 1.25, y0 + 2, matKBlack);   // panel
  }
  if (o.screen) lbox(k, cx, cz, dir, -hw, hw, hd - .25, hd, y0 + 1, y0 + 1.75, o.screen);
  if (o.chair !== false) chair(k, cx - FWD[dir][0] * (hd + .75), cz - FWD[dir][1] * (hd + .75), dir, y0);
}
/* rectangular table by its extents: a top at `h` on a recessed plinth */
export function table(k: Kit, x0: number, x1: number, z0: number, z1: number, y0: number,
  top: THREE.Material = matKWhite, h = 1, base: THREE.Material = matKGrey) {
  k.box(x0, x1, y0 + h - .25, y0 + h, z0, z1, top);
  const ix = Math.min(.75, (x1 - x0) / 4), iz = Math.min(.75, (z1 - z0) / 4);
  k.box(x0 + ix, x1 - ix, y0, y0 + h - .25, z0 + iz, z1 - iz, base);
}
/* round table: a disc at `h` on a column */
export function roundTable(k: Kit, cx: number, cz: number, r: number, y0: number,
  top: THREE.Material = matKWhite, h = 1, base: THREE.Material = matKGrey) {
  k.cyl(cx, cz, r, y0 + h - .25, y0 + h, top);
  k.cyl(cx, cz, Math.max(.25, r * .3), y0, y0 + h - .25, base);
}
/* chairs along both long sides of a table (and optionally its ends), facing in */
export function chairsAround(k: Kit, x0: number, x1: number, z0: number, z1: number, y0: number,
  mat: THREE.Material = matKBlack, pitch = 1.75, ends = false) {
  if (x1 - x0 >= z1 - z0) {
    for (let x = x0 + pitch / 2; x <= x1 - .5; x += pitch) {
      chair(k, x, z0 - .75, 's', y0, mat); chair(k, x, z1 + .75, 'n', y0, mat);
    }
    if (ends) { chair(k, x0 - .75, (z0 + z1) / 2, 'e', y0, mat); chair(k, x1 + .75, (z0 + z1) / 2, 'w', y0, mat); }
  } else {
    for (let z = z0 + pitch / 2; z <= z1 - .5; z += pitch) {
      chair(k, x0 - .75, z, 'e', y0, mat); chair(k, x1 + .75, z, 'w', y0, mat);
    }
    if (ends) { chair(k, (x0 + x1) / 2, z0 - .75, 's', y0, mat); chair(k, (x0 + x1) / 2, z1 + .75, 'n', y0, mat); }
  }
}

/* ---- storage, kitchen, sanitary ---- */
/* cupboard by its extents; an optional darker plinth keeps it off the floor */
export function cabinet(k: Kit, x0: number, x1: number, z0: number, z1: number, y0: number, h: number,
  mat: THREE.Material = matKWhite, plinth: THREE.Material | null = matKGreyDark) {
  if (plinth) { k.box(x0, x1, y0, y0 + .25, z0, z1, plinth); k.box(x0, x1, y0 + .25, y0 + h, z0, z1, mat); }
  else k.box(x0, x1, y0, y0 + h, z0, z1, mat);
}
/* open shelving against a wall: uprights and boards, `dir` the open side */
export function shelves(k: Kit, cx: number, cz: number, w: number, dir: Dir, y0: number, h = 2.5,
  mat: THREE.Material = matKWhite) {
  const hw = w / 2;
  lbox(k, cx, cz, dir, -hw, hw, -.5, -.25, y0, y0 + h, mat);                  // back
  lbox(k, cx, cz, dir, -hw, -hw + .25, -.25, .25, y0, y0 + h, mat);
  lbox(k, cx, cz, dir, hw - .25, hw, -.25, .25, y0, y0 + h, mat);
  for (let y = y0 + .5; y <= y0 + h; y += .75) lbox(k, cx, cz, dir, -hw, hw, -.25, .25, y - .25, y, mat);
}
/* a kitchen run against a wall: base units with a worktop at 1.0, wall units
   above (2.0–3.0) leaving a gap to work in. `dir` is the side you stand on. */
export function kitchenRun(k: Kit, cx: number, cz: number, w: number, dir: Dir, y0: number,
  front: THREE.Material = matKWhite, worktop: THREE.Material = matKGreyDark, wallUnits = true) {
  const hw = w / 2;
  lbox(k, cx, cz, dir, -hw, hw, -.75, .5, y0, y0 + .75, front);
  lbox(k, cx, cz, dir, -hw, hw, -.75, .75, y0 + .75, y0 + 1, worktop);
  if (wallUnits) lbox(k, cx, cz, dir, -hw, hw, -.75, 0, y0 + 2, y0 + 3, front);
}
/* toilet pan + cistern */
export function toilet(k: Kit, cx: number, cz: number, dir: Dir, y0: number) {
  lbox(k, cx, cz, dir, -.375, .375, -.375, .625, y0, y0 + .5, matKWhite);
  lbox(k, cx, cz, dir, -.5, .5, -.625, -.375, y0, y0 + 1.25, matKWhite);
}
/* wash basin on a wall */
export function basin(k: Kit, cx: number, cz: number, dir: Dir, y0: number) {
  lbox(k, cx, cz, dir, -.625, .625, -.375, .375, y0 + .75, y0 + 1, matKWhite);
  lbox(k, cx, cz, dir, -.25, .25, -.375, 0, y0, y0 + .75, matKGreyLight);
}

/* ---- greenery and light ---- */
export function plant(k: Kit, cx: number, cz: number, y0: number, h = 2.25, pot: THREE.Material = matKPot) {
  k.box(cx - .375, cx + .375, y0, y0 + .75, cz - .375, cz + .375, pot);
  k.box(cx - .125, cx + .125, y0 + .75, y0 + h - .75, cz - .125, cz + .125, matKGreen);
  k.box(cx - .625, cx + .625, y0 + h - 1, y0 + h - .25, cz - .625, cz + .625, matKGreen);
  k.box(cx - .375, cx + .375, y0 + h - .25, y0 + h, cz - .375, cz + .375, matKGreen);
}
/* a drum pendant hanging from the ceiling at `yCeil` */
export function pendant(k: Kit, cx: number, cz: number, yCeil: number, r = 1, drop = 1, shade: THREE.Material = matKLight) {
  k.box(cx - .125, cx + .125, yCeil - drop, yCeil, cz - .125, cz + .125, matKGreyDark);
  k.cyl(cx, cz, r, yCeil - drop - .5, yCeil - drop, shade);
}

/* ---- pictures ---- */
/* A flat panel of "pixels" on a wall — murals, signs, whiteboards, screens.
   `rows` is the picture, top row first, one character per cell; `legend` maps a
   character to a material, and any character not in it (use '.') is left empty.
   The panel is one voxel thick and `dir` is the way it faces, so the wall it
   hangs on is behind it. (cx, cz) is the centre of its BACK face at floor
   level — put that on the wall's surface — and `y0` the bottom of the picture.
   The picture reads correctly, left to right, to someone looking at it. */
export function pixelPanel(k: Kit, cx: number, cz: number, dir: Dir, y0: number, cell: number,
  rows: string[], legend: Record<string, THREE.Material>) {
  const nr = rows.length, nc = Math.max(...rows.map((r) => r.length));
  for (let r = 0; r < nr; r++) {
    const y = y0 + (nr - 1 - r) * cell;
    let c = 0;
    while (c < nc) {
      const ch = rows[r][c], mat = ch === undefined ? undefined : legend[ch];
      if (!mat) { c++; continue; }
      let e = c + 1;
      while (e < nc && rows[r][e] === ch) e++;                 // merge a run of one colour into one box
      // seen from the front, the picture's left is the panel's own right-hand side (−u)
      const uA = (nc / 2 - c) * cell, uB = (nc / 2 - e) * cell;
      lbox(k, cx, cz, dir, uB, uA, 0, .25, y, y + cell, mat);
      c = e;
    }
  }
}
/* A panel filled with one colour (a whiteboard, a TV, a blank sign). */
export function panel(k: Kit, cx: number, cz: number, dir: Dir, w: number, y0: number, y1: number, mat: THREE.Material) {
  lbox(k, cx, cz, dir, -w / 2, w / 2, 0, .25, y0, y1, mat);
}
