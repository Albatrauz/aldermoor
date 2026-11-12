/* ============================ kantoor — the grounds ============================ */
// Everything on the plot round the building: the street along the south, the
// planting and the parking strip in front of the entrance, a driveway down each
// side, the paved yard at the back, the four boundary walls that close the level
// and the estate beyond them. Built BEFORE the shell, so the building paints its
// own floors over the ground wherever the two overlap.
//
// Distances out here are not the interior's 2.5×. Whatever hangs off the building
// (the slanted west driveway, the paving under the overhangs) follows its outline;
// the open ground is drawn in so the level stays compact, in bands:
//   south  z 35…39 apron · 39…46 planting · 46…57 parking strip · 57…58 kerb ·
//          58…70 street · 70…71 kerb · 71…76 far footway (the wall = the buildings across)
//   north  z −35…−72 paved yard · −72…−76 low hedge, fence and a row of conifers
//   east   x 36…46.5 driveway · 47.5…50.5 beech hedge · 50.75 fence · 51…58 the neighbour's drive
//   west   an 11.5 m driveway along the slanted wall, hedge then fence on its far side,
//          the neighbour's garden and yard beyond
// Cars, bins and signs are life size, because the player is.
import * as THREE from 'three';
import { mesh } from '../../core';
import type { Spawn } from '../../mapkit';
import { type Kit, type Pt, snap } from './kit';
import { PLOT, WALL_H } from './plot';
import { G_OUTLINE, U_OUTLINE } from './structure';
import {
  matAsphalt, matCarGrey, matCarBlue, matCarRed,
  matKPaver, matKPaverLine, matKHedge, matKGrass, matKShed, matKShedDark, matKFence,
  matKBrick, matKBrickWhite, matKGlass, matKFrame, matKWhite, matKBlack,
  matKGreyLight, matKGrey, matKGreyDark, matKSteel, matKGreen, matKWoodDark,
  matKRed, matKBlue, matKOrange, matKPurple,
} from '../../materials';

/* ---- the slanted west wall, as a line ---- */
// Taken from the upper floor's outline (the ground floor's slant lies on the same
// line): its north-west corner and its south-west corner.
const NW = U_OUTLINE.reduce((a, p) => (p[1] < a[1] - 1e-6 || (Math.abs(p[1] - a[1]) < 1e-6 && p[0] < a[0]) ? p : a));
const SW = U_OUTLINE.reduce((a, p) => (p[0] < a[0] ? p : a));
/* x of the west wall at a given z (runs on past both corners) */
const wx = (z: number) => NW[0] + (SW[0] - NW[0]) * (z - NW[1]) / (SW[1] - NW[1]);
const SL = Math.hypot(NW[0] - SW[0], NW[1] - SW[1]);
const UX = (NW[0] - SW[0]) / SL, UZ = (NW[1] - SW[1]) / SL;   // unit step up the slant, toward the yard
const SLANT_DEG = Math.atan2(UZ, UX) * 180 / Math.PI;         // for k.obox
const SLANT_RY = Math.atan2(-UZ, UX);                         // a car's rotation.y, nose up the slant
const SLANT_YAW = Math.atan2(-UX, -UZ);                       // a spawn looking up the slant
/* a strip alongside the slanted wall, `o0`..`o1` metres west of it (along x), from z0 to z1 */
const band = (o0: number, o1: number, z0: number, z1: number): Pt[] =>
  [[wx(z0) - o0, z0], [wx(z1) - o0, z1], [wx(z1) - o1, z1], [wx(z0) - o1, z0]];

const DRIVE = 11.5;                      // west driveway width, out from the wall
const W_HEDGE: [number, number] = [11.75, 14.5];
const W_FENCE = 12.5;                    // west fence line, north of the gate
const W_GATE = 15.5;                     // z of the west gate
const E_GATE = 18.75;                    // z of the east gate
const FW = snap(wx(-35) - W_FENCE);      // past the building the west fence runs due north, here
const FENCE_H = 2.5;
const HB = 1.5;                          // hedge blocks: shoot over standing, hide behind crouched
const HT = 3.25;                         // the tall driveway hedges

export function buildGrounds(k: Kit): { spawns: Spawn[] } {
  const B = k.B;
  const { x0, x1, z0, z1 } = PLOT;

  /* ============================ small helpers ============================ */
  // a square post of width `w` centred near (x, z), snapped to the lattice
  const post = (x: number, z: number, h: number, mat: THREE.Material = matKFence, w = .5) => {
    const a = snap(x - w / 2), b = snap(z - w / 2);
    k.box(a, a + w, 0, h, b, b + w, mat);
  };
  // chain-link: a thin dark wall (the voxels have no see-through) with a post every ~5 m
  const fence = (a: Pt, b: Pt, h = FENCE_H) => {
    k.wall(a[0], a[1], b[0], b[1], { mat: matKFence, t: .25, y0: 0, y1: h });
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
    for (let i = 0; i <= n; i++) post(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, h + .25);
  };
  // a gate leaf of black bars, standing open: two rails and a bar every 0.5 m
  const leaf = (xa: number, xb: number, za: number, zb: number) => {
    const alongX = xb - xa > zb - za, L = alongX ? xb - xa : zb - za;
    k.box(xa, xb, .25, .5, za, zb, matKFence);
    k.box(xa, xb, 1.5, 1.75, za, zb, matKFence);
    for (let s = 0; s + .25 <= L + 1e-6; s += .5) {
      if (alongX) k.box(xa + s, xa + s + .25, .5, 1.5, za, zb, matKFence);
      else k.box(xa, xb, .5, 1.5, za + s, za + s + .25, matKFence);
    }
  };
  // a round traffic sign facing the street; (x, z) is the post's lattice corner
  const sign = (x: number, z: number, face: THREE.Material, inner: THREE.Material | null, arrow: boolean) => {
    k.box(x, x + .25, 0, 2.75, z, z + .25, matKGrey);
    const disc = (r: number, m: THREE.Material) =>
      B.add(mesh(new THREE.CylinderGeometry(r, r, .25, 16), m, x + .125, 2.5, z + .375, { rx: Math.PI / 2 }));
    disc(.625, face);
    if (inner) disc(.375, inner);
    if (arrow) k.box(x, x + .25, 2.125, 2.875, z + .25, z + .5, matKWhite);
  };
  // a street lamp: a pole, an arm out over the road (+1 toward +Z, −1 toward −Z), a head
  const lamp = (x: number, z: number, dir: 1 | -1) => {
    k.box(x, x + .25, 0, 7, z, z + .25, matKGrey);
    const end = dir > 0 ? z + 1.75 : z - 1.5;
    k.box(x, x + .25, 6.75, 7, Math.min(z, end), Math.max(z + .25, end), matKGrey);
    k.box(x, x + .25, 6.5, 6.75, dir > 0 ? end - .5 : end, dir > 0 ? end : end + .5, matKGreyDark);
  };
  // a bare winter tree: a trunk and a few twigs crossing at different heights
  const tree = (x: number, z: number) => {
    k.box(x - .25, x + .25, 0, 5.25, z - .25, z + .25, matKWoodDark);
    for (const [y, len, deg] of [[2.75, 3.5, 20], [3.5, 3, 75], [4.25, 2.5, 130], [5, 2, 170]])
      k.obox(x, z, len, .25, y, y + .25, deg, matKWoodDark);
  };
  // Parked cars: body, dark glass, roof, wheels. Life size, 2 m wide, the length
  // along the car's own X; `ry` turns it. They are the main cover outdoors.
  const car = (cx: number, cz: number, ry: number, body: THREE.Material, kind: 'hatch' | 'suv' | 'van' = 'suv') => {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz); g.rotation.y = ry;
    const put = (sx: number, ya: number, yb: number, sz: number, x: number, m: THREE.Material) =>
      g.add(mesh(new THREE.BoxGeometry(sx, yb - ya, sz), m, x, (ya + yb) / 2, 0));
    const L = kind === 'hatch' ? 4 : kind === 'suv' ? 4.5 : 5.5;
    if (kind === 'van') {
      put(L, .25, 2.5, 2, 0, body);
      put(.25, 1.25, 2.25, 1.5, L / 2 - .125, matKBlack);        // windscreen
      put(1.5, 1.5, 2.25, 2, L / 2 - 1, matKBlack);              // cab side windows
    } else {
      const glass = kind === 'hatch' ? 2 : 2.5;
      put(L, .25, 1, 2, 0, body);
      put(glass, 1, 1.5, 1.5, -.25, matKBlack);
      put(glass, 1.5, 1.75, 1.5, -.25, body);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(mesh(new THREE.CylinderGeometry(.375, .375, .25, 12), matKBlack,
        sx * (L / 2 - .875), .375, sz * .875, { rx: Math.PI / 2 }));
    }
    B.add(g);
  };

  /* ============================ ground ============================ */
  B.add(mesh(new THREE.PlaneGeometry(360, 360), matKPaver, 0, 0, 0, { rx: -Math.PI / 2, cast: false }));
  // the street, kerb to kerb; it runs on past the walls for the view off the roof
  k.paintRect(-180, 180, 57, 58, matKPaverLine);
  k.paintRect(-180, 180, 58, 70, matAsphalt);
  k.paintRect(-180, 180, 70, 71, matKPaverLine);
  for (const x of [-40, -6, 28]) k.paintRect(x, x + .75, 58, 58.5, matKBlack);   // gully grates
  k.paintRect(-8, -6.5, 62, 63, matKGreyDark);                                   // manhole covers
  k.paintRect(-24, -22.5, 65, 66, matKGreyDark);
  // grey concrete tiles: the apron along the front, and under both overhangs
  k.paintRect(-35.5, 35, 35, 39, matKGreyLight);
  k.paint(U_OUTLINE, matKGreyLight, [G_OUTLINE]);
  // soil and winter grass: the planting band, the foot of the east hedge and the cotoneaster
  k.paintRect(-41, 36, 39, 46, matKGrass);
  k.paintRect(46.5, 50.75, -37.5, 46, matKGrass);
  k.paintRect(48.5, 50.75, -72, -37.5, matKGrass);
  // the west driveway cuts through the planting; a mossy strip at the foot of its fence
  k.paint(band(0, DRIVE, -35, 57), matKPaver);
  k.paint(band(DRIVE, W_FENCE, -35, W_GATE), matKGrass);
  k.paintRect(FW + .25, FW + 1.25, -72, -35, matKGrass);
  // the neighbour's grass bed beyond the west hedge
  k.paint([[x0, 21], [wx(21) - W_HEDGE[1], 21], [wx(46) - W_HEDGE[1], 46], [x0, 46]], matKGrass);
  // the tiled path from the strip to the apron, wide enough to run
  k.paintRect(-10.75, -6.25, 39, 46, matKGreyLight);
  // nine bays nose-in at the back hedge
  for (let i = 0; i <= 9; i++) k.paintRect(-12 + 4 * i, -11.75 + 4 * i, -72, -66.5, matKPaverLine);

  /* ============================ outer boundary ============================ */
  // Inner faces exactly on PLOT; the X walls run over the ends of the Z walls.
  B.wallX(z0 - 1, x0 - 2, x1 + 2, { h: WALL_H, t: 2, mat: matKShed, boundary: true });     // north: backs of the sheds
  B.wallX(z1 + 1, x0 - 2, x1 + 2, { h: WALL_H, t: 2, mat: matKShed, boundary: true });     // south: across the street
  B.wallZ(x0 - 1, z0 - 2, z1 + 2, { h: WALL_H, t: 2, mat: matKShedDark, boundary: true }); // west: grey-blue sheds
  B.wallZ(x1 + 1, z0 - 2, z1 + 2, { h: WALL_H, t: 2, mat: matKShed, boundary: true });     // east: the neighbour's silver shed

  // Dressing is painted INTO the walls, flush with their inner face, so it never
  // makes a ledge. `deep` 2 recolours the wall right through.
  const onS = (xa: number, xb: number, ya: number, yb: number, m: THREE.Material, deep = .5) => k.box(xa, xb, ya, yb, z1, z1 + deep, m);
  const onN = (xa: number, xb: number, ya: number, yb: number, m: THREE.Material, deep = .5) => k.box(xa, xb, ya, yb, z0 - deep, z0, m);
  const onW = (za: number, zb: number, ya: number, yb: number, m: THREE.Material, deep = .5) => k.box(x0 - deep, x0, ya, yb, za, zb, m);
  const onE = (za: number, zb: number, ya: number, yb: number, m: THREE.Material, deep = .5) => k.box(x1, x1 + deep, ya, yb, za, zb, m);

  // south, west half: a white building with a dark top, two rows of windows, a door
  onS(x0 - 2, -6, 0, WALL_H, matKBrickWhite, 2);
  onS(x0 - 2, -6, 7.5, WALL_H, matKGreyDark, 2);
  for (let x = -56; x <= -11; x += 5) { onS(x, x + 2.5, 1.25, 3.25, matKGlass); onS(x, x + 2.5, 4.5, 6.5, matKGlass); }
  onS(-31, -28, 0, 3, matKFrame);
  onS(-24, -16, 7.75, 8.75, matKRed); onS(-23, -17, 8, 8.5, matKWhite);   // a red-and-white sign, nothing legible
  // south, east half: grey office-and-workshop, dark band, glazed corner, roller doors
  onS(-6, x1 + 2, 3.75, 4.25, matKShedDark, 2);
  onS(-4, 16, 1, 3.25, matKGlass); onS(-4, 16, 5, 7, matKGlass);
  for (let x = -4; x <= 16; x += 2.5) { onS(x, x + .25, 1, 3.25, matKFrame); onS(x, x + .25, 5, 7, matKFrame); }
  onS(20, 21.5, 0, 2.75, matKFrame);
  onS(26, 32, 0, 5, matKShedDark); onS(36, 42, 0, 5, matKShedDark);
  onS(-2, 10, 7.5, 8.5, matKBlack);
  // east: the silver shed with a window band; its office front; a brick building where the street turns
  onE(-70, 36, 5, 6, matKGlass);
  for (let z = -70; z <= 36; z += 3) onE(z, z + .25, 5, 6, matKFrame);
  onE(28, 33, 0, 4.5, matKShedDark);                   // roller door onto the neighbour's drive
  onE(34.5, 35.75, 0, 2.5, matKFrame);
  onE(38, 46, 0, WALL_H, matKShedDark, 2);
  onE(40, 43, 0, 3, matKGlass);
  onE(46, z1 + 2, 0, WALL_H, matKBrick, 2);
  for (let z = 48; z <= 72; z += 4.5) { onE(z, z + 2, 1.25, 3.25, matKGlass); onE(z, z + 2, 4.75, 6.75, matKGlass); }
  // west: roller doors into the neighbour's yard, a side door by the garden, brick at the street end
  for (const z of [-64, -44, -24, -4]) onW(z, z + 6, 0, 5, matKShed);
  onW(30, 31.25, 0, 2.5, matKFrame);
  onW(46, z1 + 2, 0, WALL_H, matKBrick, 2);
  for (let z = 48; z <= 72; z += 4.5) { onW(z, z + 2, 1.25, 3.25, matKGlass); onW(z, z + 2, 4.75, 6.75, matKGlass); }
  // north: a second, darker shed behind the east half; windows showing over the conifers
  onN(20, x1 + 2, 0, WALL_H, matKShedDark, 2);
  onN(-50, 10, 7, 7.75, matKGlass);

  /* ============================ south: planting, strip, street ============================ */
  // square-clipped beech blocks in their orange winter leaf, the low green hedge
  // before the entrance, a bed of bare brown shrubs, the path left open to the doors
  k.box(-35.5, -28, 0, HB, 39.75, 42.75, matKHedge);   // under the poster corner
  k.box(-22, -11, 0, HB, 39.5, 42.5, matKHedge);
  k.box(14, 24, 0, HB, 40, 43, matKHedge);
  k.box(27, 35.75, 0, HB, 40.5, 43.5, matKHedge);      // up to the east driveway
  k.box(-5, 11, 0, 1, 40, 44.5, matKGreen);
  k.box(24, 27, 0, 1, 40.5, 44, matKGreen);
  k.box(-24, -16.5, 0, .75, 43.25, 45.75, matKWoodDark);
  // the sign pylon: black, a violet light strip down its east edge, a white glyph and stroke (nothing readable)
  k.box(-26.5, -24.75, 0, 3.5, 44.75, 45.5, matKBlack);
  k.box(-24.75, -24.5, 0, 3.5, 44.75, 45.5, matKPurple);
  k.box(-26, -25.25, 2.5, 3.25, 45.25, 45.5, matKWhite);
  k.box(-25.75, -25.5, .75, 2.25, 45.25, 45.5, matKWhite);
  k.box(-5.75, -5.25, 0, 1.25, 45, 45.5, matKSteel);   // mailbox pillar beside the path
  lamp(-30, 46.5, 1); lamp(30, 46.5, 1);
  // parallel-parked along the street side of the strip
  car(-36, 55.25, 0, matCarRed, 'hatch');
  car(-20, 55.25, Math.PI, matCarGrey);
  car(-3, 55.25, 0, matKWhite);
  car(12, 55.25, Math.PI, matCarGrey);
  car(27, 55.25, 0, matCarBlue);
  // and along the far kerb, so the street itself has something to hide behind
  car(-40, 68.75, Math.PI, matCarGrey, 'hatch');
  car(-12, 68.75, Math.PI, matCarBlue);
  car(15, 68.75, Math.PI, matCarRed, 'hatch');
  car(42, 68.5, Math.PI, matKWhite, 'van');
  lamp(-45, 75.5, -1); lamp(25, 75.5, -1);
  k.box(5, 5.75, 0, 1, 72, 72.75, matKGreyDark);       // litter bin on the far footway

  /* ============================ east driveway ============================ */
  // the tall beech hedge, broken in three; the gap at z 30 lets onto the neighbour's drive
  for (const [za, zb] of [[33, 46], [-9, 30], [-37.5, -12]]) k.box(47.5, 50.5, 0, HT, za, zb, matKHedge);
  // the gate, both leaves swung back against the wall and the hedge, and the blue "ahead only" sign
  post(36.25, E_GATE, 2.25); post(46.25, E_GATE, 2.25);
  leaf(36, 36.25, E_GATE - 5.5, E_GATE - .25);
  leaf(46.25, 46.5, E_GATE - 5.5, E_GATE - .25);
  sign(46, E_GATE + .5, matKBlue, null, true);
  car(44.25, 2, Math.PI / 2, matCarGrey, 'hatch');
  k.box(45.5, 46.5, 0, 1.5, 24, 25.25, matKGrey);      // utility cabinets against the hedge
  k.box(45.5, 46.5, 0, 1.5, -18.5, -17.25, matKGrey);
  // bins at the north-east corner: an 1100 L container and a wheelie bin
  k.box(44.5, 46.25, 0, 1.25, -40.25, -39, matKGreyDark);
  k.box(44.5, 46.25, 1.25, 1.5, -40.25, -39, matKBlack);
  k.box(45.25, 46, 0, 1, -38.25, -37.5, matKGreyDark);
  k.box(45.25, 46, 1, 1.25, -38.25, -37.5, matKBlue);
  // the fence behind the hedge from the neighbour's gate to the back, and that gate (shut)
  fence([50.875, 25], [50.875, -74.125]);
  fence([51, 25.125], [58, 25.125], 2);
  car(54.5, 38, Math.PI / 2, matCarGrey);              // parked on the neighbour's drive

  /* ============================ west driveway ============================ */
  // tall hedge along its outer side from the gate to the street, with a gap into the neighbour's garden
  k.poly(band(W_HEDGE[0], W_HEDGE[1], W_GATE, 34), 0, HT, matKHedge);
  k.poly(band(W_HEDGE[0], W_HEDGE[1], 37, 46), 0, HT, matKHedge);
  // from the gate north the fence takes over, then turns due north past the building
  fence([wx(W_GATE) - W_FENCE, W_GATE], [FW, -35]);
  fence([FW, -35], [FW, -74.125]);
  fence([x0, W_GATE + .125], [wx(W_GATE) - W_HEDGE[0], W_GATE + .125]);   // shuts the garden off from the yard
  // the gate, open, its leaves folded back up the slant; the red-ring "no entry" sign
  const gw = wx(W_GATE) - DRIVE + .25, ge = wx(W_GATE) - .75;
  post(gw, W_GATE, 2.25); post(ge, W_GATE, 2.25);
  for (const x of [gw, ge]) k.obox(x + UX * 2.875, W_GATE + UZ * 2.875, 5.25, .25, .25, 1.75, SLANT_DEG, matKFence);
  sign(snap(wx(17.5) - 11.25), 17.5, matKRed, matKWhite, false);
  car(wx(30) - 9.5, 30, SLANT_RY, matCarGrey);
  car(wx(-15) - 8.5, -15, SLANT_RY + Math.PI, matKBlack, 'hatch');
  k.box(snap(wx(0) - 11.25), snap(wx(0) - 11.25) + 1.75, 0, 1.25, -.75, .5, matKGreyDark);   // a container by the fence

  /* ============================ the neighbours, inside the walls ============================ */
  // west garden: two bare trees, a bike shelter (red frame, white roof)
  tree(-54.5, 41); tree(-52, 26);
  for (const [px, pz] of [[-55, 16.5], [-50.25, 16.5], [-55, 18.75], [-50.25, 18.75]]) k.box(px, px + .25, 0, 2.25, pz, pz + .25, matKRed);
  k.box(-55, -50, 2.25, 2.5, 16.5, 19, matKWhite);
  k.box(-55, -50, .25, 2.25, 16.5, 16.75, matKWhite);
  // west yard, behind the fence: a red lorry with a white box body
  k.box(-48, -45.5, .25, .75, -22, -8.25, matKBlack);
  k.box(-48, -45.5, .75, 3.75, -22, -11, matKWhite);
  k.box(-48, -45.5, .5, 3.25, -10.75, -8.25, matKRed);
  k.box(-47.75, -45.75, 2, 3, -8.5, -8.25, matKBlack);

  /* ============================ rear yard ============================ */
  // the back edge: a low hedge, the chain-link, a dark wall of conifers
  k.box(FW + .25, 50.5, 0, HB, -74, -72, matKHedge);
  k.box(x0, x1, 0, 2.5, -76, -74.25, matKGreen);
  for (let x = x0 + .75; x <= x1 - .75; x += 1.5) B.add(mesh(new THREE.ConeGeometry(.875, 6, 10), matKGreen, x, 3, -75.125));
  fence([x0, -74.125], [x1, -74.125]);
  // cotoneaster along the east fence, in three runs
  for (const [za, zb] of [[-70, -60], [-57, -48], [-45, -38]]) k.box(48.5, 50.5, 0, .75, za, zb, matKGreen);
  // the cars: nose-in at the hedge, two at the facade (one on the charger), one by the west fence, two loose
  car(-6, -69.25, Math.PI / 2, matCarRed, 'hatch');
  car(14, -69, Math.PI / 2, matCarGrey);
  car(13.5, -37.5, -Math.PI / 2, matKWhite);
  car(18, -37.5, -Math.PI / 2, matKWhite);
  car(-17.5, -52, -Math.PI / 2, matKBlack);
  car(6, -55, .35, matCarBlue, 'hatch');
  car(36, -60, .2, matKBlack);
  // EV charger on its stand against the wall, just east of the stair's landing area
  k.box(10, 10.25, 0, 1.25, -35.75, -35.5, matKWhite);
  k.box(9.75, 10.5, 1, 1.5, -35.5, -35, matKWhite);
  k.box(10, 10.25, 1.25, 1.5, -35.5, -35.25, matKRed);
  // two red-white bollards off the foot of the stair, a grit bin and a plant pot by the kantine door
  for (const x of [2, 6.5]) { k.box(x, x + .25, 0, 1, -47.25, -47, matKRed); k.box(x, x + .25, .5, .75, -47.25, -47, matKWhite); }
  k.box(-6.25, -5.25, 0, .5, -35.75, -35, matKWhite);
  k.box(-6.25, -5.25, .5, .75, -35.75, -35, matKOrange);
  k.box(-8, -7.5, 0, .5, -35.5, -35, matKBlack);
  // blue parking sign on a post at the end of the bays
  k.box(25.5, 25.75, 0, 2.25, -66, -65.75, matKGrey);
  k.box(25.25, 26, 1.75, 2.5, -65.75, -65.5, matKBlue);
  k.box(25.5, 25.75, 2, 2.25, -65.75, -65.5, matKWhite);

  /* ============================ beyond the walls (backdrop, no colliders) ============================ */
  // across the street: the white building and the grey workshop whose fronts the south wall wears
  k.box(-120, -6, 0, 10, z1 + 2, 100, matKBrickWhite);
  k.box(-120, -6, 7.5, 10, z1 + 2, 100, matKGreyDark);
  k.box(-6, 120, 0, 12, z1 + 2, 112, matKShed);
  k.box(-6, 120, 3.75, 4.25, z1 + 2, 112, matKShedDark);
  k.box(-6, 120, 12, 12.5, z1 + 2, 112, matKShedDark);
  // east: the silver shed, its office front, the brick block on the bend
  k.box(x1 + 2, 105, 0, 11, z0 - 2, 38, matKShed);
  k.box(x1 + 2, 105, 11, 11.5, z0 - 2, 38, matKShedDark);
  k.box(x1 + 2, 80, 0, 9.5, 38, 46, matKShedDark);
  k.box(x1 + 2, 85, 0, 9.5, 46, z1 + 2, matKBrick);
  k.box(x1 + 2, 120, 0, 10, -140, z0 - 2, matKShed);
  // west: grey-blue sheds, and brick again where the street bends away
  k.box(-105, x0 - 2, 0, 10, z0 - 2, 44, matKShedDark);
  k.box(-105, x0 - 2, 10, 10.5, z0 - 2, 44, matKGrey);
  k.box(-85, x0 - 2, 0, 9.5, 44, z1 + 2, matKBrick);
  // north: the big pale shed, a low dark one, and the white membrane dome to the north-east
  k.box(-120, 18, 0, 12, -125, z0 - 2, matKShed);
  k.box(-120, 18, 12, 12.5, -125, z0 - 2, matKShedDark);
  k.box(18, x1 + 2, 0, 9, -95, z0 - 2, matKShedDark);
  B.add(mesh(new THREE.SphereGeometry(17, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), matKWhite, 40, 0, -118));
  // a residential slab far off to the south-west, its floors in dark bands
  k.box(-95, -35, 0, 34, 160, 175, matKGreyLight);
  for (let y = 3; y < 33; y += 3) k.box(-96, -34, y, y + 1, 159, 176, matKGreyDark);
  // bare tree crowns along the edges of the estate
  for (const [tx, tz] of [[-140, 125], [-118, 132], [128, 128], [150, 95], [-150, -60], [140, -150], [-60, -150]]) {
    k.cyl(tx, tz, .75, 0, 7, matKWoodDark);
    B.add(mesh(new THREE.SphereGeometry(5, 12, 8), matKWoodDark, tx, 9, tz));
  }

  /* ============================ spawns ============================ */
  // Outdoors only, on open ground, facing the building or along the lane
  // (forward = (−sin yaw, −cos yaw)).
  const spawns: Spawn[] = [
    { x: -50, z: 64, yaw: -Math.PI / 2 },              // the street, west end, looking east along it
    { x: 50, z: 64, yaw: Math.PI / 2 },                // …east end, looking west
    { x: 0, z: 63.5, yaw: 0 },                         // mid-street, facing the entrance
    { x: -28, z: 73.5, yaw: 0 },                       // far footway
    { x: -28, z: 50.5, yaw: 0 },                       // parking strip, west
    { x: 20, z: 50.5, yaw: 0 },                        // parking strip, east
    { x: 41, z: 27, yaw: 0 },                          // east driveway, below the gate
    { x: 54.5, z: 51, yaw: 0 },                        // mouth of the neighbour's drive
    { x: wx(42) - 5.75, z: 42, yaw: SLANT_YAW },       // west driveway, at the street
    { x: wx(0) - 5.75, z: 0, yaw: SLANT_YAW },         // west driveway, halfway up
    { x: -18, z: -42, yaw: Math.PI },                  // the yard's west corner, looking down the west driveway
    { x: -4, z: -58, yaw: Math.PI },                   // the yard, facing the back of the building
    { x: 28, z: -50, yaw: Math.PI },
    { x: 44, z: -60, yaw: Math.PI / 2 },               // the yard's east end, looking west across it
  ];
  return { spawns };
}
