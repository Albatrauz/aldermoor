/* ============================ kantoor — the outside of the building ============================ */
// What makes the shell read as THIS office from the street and the yard: the
// raised glass lantern over the atrium, the entrance canopy between its two fat
// columns, the slim columns under the corner overhangs, the aluminium roof edge,
// the sign boards, and the steel fire-escape stair at the back.
//
// Built after the shell (structure.ts), so where the two overlap this wins: the
// grey door panel and the white piers between window pairs are repaints of the
// brick, not boxes stuck on it. Nothing here blocks a door or window the shell
// cut, and everything touches the building or reaches the ground — loose voxels
// fall when shot near.
import type { Material } from 'three';
import { UPPER } from './plan';
import { type Kit, type Pt, P, along, dist, snap, VS, CEIL0, L1, CEIL1, ROOF, PARAPET, SILL, HEAD } from './kit';
import { LANTERN_BOX } from './structure';
import { pixelPanel } from './props';
import {
  matKBrickWhite, matKTrim, matKFrame, matKRoof, matKWall, matKWallWarm, matKLight,
  matKWhite, matKBlack, matKGrey, matKGreyLight, matKGreyDark, matKSteel,
  matKRed, matKBlue, matKPurple, matKTeal, matKDeskTop, matKWoodDark,
} from '../../materials';

/* ============================ the roof lantern ============================ */
// The atrium's glass box, the building's landmark: it stands a storey's worth
// above the roof line in the notch over the entrance. Upstands on the west, north
// and east carry a clerestory ribbon (open, so daylight floods the gallery); the
// south face is a tall dark grid of open panes over a solid spandrel; a flat lid
// with a warm ceiling and a fan hung from it.
const LT = .5;                          // upstand thickness
const LX0 = LANTERN_BOX.x0, LX1 = LANTERN_BOX.x1, LZ0 = LANTERN_BOX.z0, LZ1 = LANTERN_BOX.z1;
const WX0 = LX0 - LT, WX1 = LX1 + LT;   // outer faces of the west / east upstands (they stand on the inner walls below)
const WZ0 = LZ0 - LT;                   // outer face of the north upstand
const GZ0 = LZ1 - VS, GZ1 = LZ1 + VS;   // the south glass front straddles the slab edge
const RIB0 = ROOF + .5;                 // clerestory sill: half a metre above the roofing
const RIB1 = 12;                        // …and head
const LID0 = RIB1 + VS, LID1 = 13;      // the lantern's roof slab
const COL_W = 1;                        // the two columns at the corners of the glass front (F_colW / F_colE)
const COL_Z0 = 26.5;

function lantern(k: Kit) {
  // ribbon posts every pane along a run, 0.25 thick
  const posts = (a: number, b: number, put: (p: number) => void, pane = 2.75) => {
    const n = Math.max(1, Math.ceil((b - a) / pane));
    for (let i = 1; i < n; i++) put(snap(a + (b - a) * i / n - VS / 2));
  };
  // one upstand: white plaster to the sill, dark frame strips at sill and head, open between
  const upstand = (x0: number, x1: number, z0: number, z1: number) => {
    k.box(x0, x1, CEIL1, RIB0 - VS, z0, z1, matKWall);
    k.box(x0, x1, RIB0 - VS, RIB0, z0, z1, matKFrame);
    k.box(x0, x1, RIB1, LID0, z0, z1, matKFrame);
  };
  upstand(WX0, LX0, WZ0, GZ1);                         // west
  upstand(LX1, WX1, WZ0, GZ1);                         // east
  upstand(LX0, LX1, WZ0, LZ0);                         // north
  // solid corners, so each ribbon is a frame and not a slot
  for (const [x0, x1] of [[WX0, LX0], [LX1, WX1]]) k.box(x0, x1, RIB0, RIB1, WZ0, LZ0, matKFrame);
  // mullions
  posts(LZ0, COL_Z0, (z) => { k.box(WX0, LX0, RIB0, RIB1, z, z + VS, matKFrame); k.box(LX1, WX1, RIB0, RIB1, z, z + VS, matKFrame); });
  posts(LX0, LX1, (x) => k.box(x, x + VS, RIB0, RIB1, WZ0, LZ0, matKFrame));

  // the south glass front, from the gallery floor to the lid, between its two columns
  const gx0 = LX0 + LT, gx1 = LX1 - LT;
  k.box(WX0, gx0, L1, LID0, COL_Z0, GZ1, matKFrame);   // F_colW
  k.box(gx1, WX1, L1, LID0, COL_Z0, GZ1, matKFrame);   // F_colE
  k.box(gx0, gx1, L1, L1 + 1.25, GZ0, GZ1, matKFrame); // spandrel — also the gallery's parapet
  for (const y of [7.5, 9, 10.5, RIB1]) k.box(gx0, gx1, y, y + VS, GZ0, GZ1, matKFrame);   // transoms and head
  for (let i = 1; i < 5; i++) {                        // five panes across
    const x = snap(gx0 + (gx1 - gx0) * i / 5 - VS / 2);
    k.box(x, x + VS, L1 + 1.25, RIB1, GZ0, GZ1, matKFrame);
  }

  // the lid: warm ceiling under, roofing over, a dark fascia round its edge
  k.box(WX0, WX1, LID0, LID0 + VS, WZ0, GZ1, matKWallWarm);
  k.box(WX0, WX1, LID0 + VS, LID1, WZ0, GZ1, matKRoof);
  k.box(WX0, WX1, LID0, LID1, WZ0, WZ0 + VS, matKGreyDark);
  k.box(WX0, WX1, LID0, LID1, GZ1 - VS, GZ1, matKGreyDark);
  k.box(WX0, WX0 + VS, LID0, LID1, WZ0, GZ1, matKGreyDark);
  k.box(WX1 - VS, WX1, LID0, LID1, WZ0, GZ1, matKGreyDark);

  // ceiling fan over the stair void: a rod, a hub, two crossed blades
  const fx = 3, fz = 12;
  k.box(fx, fx + VS, 11.5, LID0, fz, fz + VS, matKGreyLight);
  k.box(fx - .25, fx + .5, 11, 11.5, fz - .25, fz + .5, matKGreyLight);
  k.box(fx - 1.5, fx + 1.75, 11.25, 11.5, fz, fz + VS, matKWhite);
  k.box(fx, fx + VS, 11.25, 11.5, fz - 1.5, fz + 1.75, matKWhite);
}

/* ============================ the entrance ============================ */
// The single-storey entree between the two glass wings: a light-grey canopy over
// the doors, carried by two fat round columns at the wing joints, and dark navy
// panels on the closets either side of the doors. The double door (O_WS3) and
// its sidelights stay open.
const FRONT = 35;                       // outer face of the south walls, both storeys
const EAST = 35;                        // outer face of the east wall

function entrance(k: Kit) {
  // the closets' fronts: the outer layer of the brick, repainted navy
  k.box(-4.5, -2, 0, CEIL0, FRONT - VS, FRONT, matKFrame);      // techniek
  k.box(7.75, 10.25, 0, CEIL0, FRONT - VS, FRONT, matKFrame);   // kastruimte
  // canopy, the width of the notch, two metres deep, with a fascia lip
  k.box(-4.5, 10.5, CEIL0, L1, FRONT, 37.25, matKTrim);
  k.box(-4.5, 10.5, L1, L1 + VS, 37, 37.25, matKTrim);
  for (const x of [1.75, 4.25]) k.box(x, x + .5, CEIL0, CEIL0 + VS, 36, 36.5, matKLight);   // downlights
  k.box(9.5, 10, 4.5, L1, 37.25, 37.5, matKRed);                                            // alarm box
  // the columns: centred on a voxel, so r 0.625 fills a round 5 × 5
  for (const x of [-3.875, 9.625]) k.cyl(x, 35.625, .625, 0, CEIL0, matKTrim);
}

/* ============================ columns under the overhangs ============================ */
// The upper floor runs on past the ground floor at both front corners; slim
// silver columns carry its edge — along the street front and down the outer
// side, as in the photos. On a lattice corner, r 0.5 fills a round 4 × 4.
const OVERHANG_COLUMNS: Pt[] = [
  // south-west: the street front, then up the slanted west edge
  [-34.25, 34.25], [-25.5, 34.25], [-17.5, 34.25], [-32, 26.5], [-30, 20.25],
  // south-east: the street front, then one on the east edge
  [23.5, 34.25], [28.75, 34.25], [34.25, 34.25], [34.25, 25.75],
];
const SOFFIT_LIGHTS: Pt[] = [
  [-28, 22], [-28, 30], [-22, 22], [-22, 30],
  [27, 22], [27, 29.5], [31.5, 29.5],
];

function overhangs(k: Kit) {
  for (const [x, z] of OVERHANG_COLUMNS) k.cyl(x, z, .5, 0, CEIL0, matKTrim);
  for (const [x, z] of SOFFIT_LIGHTS) k.box(x, x + .5, CEIL0, CEIL0 + VS, z, z + .5, matKLight);
}

/* ============================ roof edge, window piers, blinds ============================ */
// Walks the upper storey's outer walls the way the shell does, so every repaint
// lands on exactly the voxels the shell filled:
//   • the top row of the parapet becomes the aluminium cap;
//   • the brick between the two windows of a pair turns white (the building's
//     window–white pier–window repeat);
//   • every other window gets a pale blind strip in its top row (3 m above the
//     floor, so the opening stays vaultable).
function upperWalls(k: Kit) {
  for (const w of UPPER.walls) {
    if (w.kind !== 'outer') continue;
    const A = P(w.a[0], w.a[1]), B = P(w.b[0], w.b[1]), L = dist(A, B);
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
    const at = (s: number): Pt => [A[0] + ux * s, A[1] + uz * s];
    const seg = (s0: number, s1: number, t: number, y0: number, y1: number, mat: Material) => {
      const p = at(s0), q = at(s1);
      k.wall(p[0], p[1], q[0], q[1], { t, mat, y0, y1, ext: 0 });
    };

    k.wall(A[0], A[1], B[0], B[1], { t: .75, mat: matKTrim, y0: PARAPET - VS, y1: PARAPET });

    const wins = UPPER.openings
      .filter((o) => o.wall === w.id && o.kind === 'window' && !o.id.startsWith('ESC'))
      .map((o) => {
        let a = along(A, B, P(o.a[0], o.a[1])), b = along(A, B, P(o.b[0], o.b[1]));
        if (a > b) [a, b] = [b, a];
        return { a: snap(Math.max(0, a)), b: snap(Math.min(L, b)) };
      })
      .sort((p, q) => p.a - q.a);
    for (let i = 0; i + 1 < wins.length; i++) {
      if (wins[i + 1].a - wins[i].b <= 1.5) seg(wins[i].b, wins[i + 1].a, .75, L1 + SILL - VS, L1 + HEAD + VS, matKBrickWhite);
    }
    wins.forEach((g, i) => { if (i % 2 === 0) seg(g.a, g.b, .25, L1 + HEAD - VS, L1 + HEAD, matKGreyLight); });
  }
}

/* ============================ roof clutter, downpipes, floodlights ============================ */
// Low and attached: nobody gets up here, it only has to read from a distance.
function roofAndWalls(k: Kit) {
  // two air-handling units and a hatch on the roof, clear of the lantern's ribbons
  k.box(16, 18.5, ROOF, 11, 2, 4.5, matKGreyLight);
  k.cyl(17.25, 3.25, .75, 11, 11.25, matKGrey);
  k.box(-12.5, -10, ROOF, 11, 20, 22, matKGreyLight);
  k.cyl(-11.25, 21, .75, 11, 11.25, matKGrey);
  k.box(20, 21.5, ROOF, ROOF + .5, -10, -8.5, matKGrey);

  // downpipes, coping to ground, on the east and west walls only, in the gaps between windows
  for (const z of [-23, -4.25, 5, 14.5]) k.box(EAST, EAST + VS, 0, PARAPET - VS, z, z + VS, matKGreyLight);
  // the west wall is slanted: a 0.5 box half sunk into its outer face
  const A = P(-28.049, 27.864), B = P(-19.178, 0.15);
  const len = dist(A, B), dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
  const nx = dz, nz = -dx;    // outward (west) normal
  for (const z of [-23, -12.75, 4.5, 15]) {
    const x = A[0] + (z - A[1]) * (B[0] - A[0]) / (B[1] - A[1]);
    const px = snap(x + nx * .5), pz = snap(z + nz * .5);
    k.box(px - .25, px + .25, 0, PARAPET - VS, pz - .25, pz + .25, matKGreyLight);
  }

  // floodlights under the coping at the two rear corners
  k.box(33.75, 34.25, 9.5, 10, -35.5, -35, matKBlack);
  k.box(-12.5, -12, 9.5, 10, -35.5, -35, matKBlack);
}

/* ============================ sign boards ============================ */
// Shapes, not words — tenants change. Each panel's back sits on the wall's outer face.
function signs(k: Kit) {
  // the company lettering top-left of the front: a pixel logo, then a row of pale
  // letter-like blocks that spell nothing
  const GLYPHS = [
    ['####', '#..#', '#..#'],
    ['####', '.##.', '.##.'],
    ['###.', '###.', '#.##'],
    ['#..#', '####', '#..#'],
    ['####', '##..', '####'],
    ['#...', '#...', '####'],
  ];
  const order = [3, 0, 1, 4, 2, 5, 1, 4, 5, 5, 0, 2];
  const logo = ['b.p', 'pbw', '.wb'];
  const rows = logo.map((r, i) => r + '..' + order.map((g) => GLYPHS[g][i]).join('.'));
  pixelPanel(k, -17.5, FRONT, 's', 9, VS, rows, { '#': matKWhite, w: matKWhite, b: matKBlue, p: matKPurple });

  // the poster on the south-west corner: a portrait on blue-violet, text in the lower third
  pixelPanel(k, -32.5, FRONT, 's', 5.75, VS, [
    'bbbbbbbwwbbbbbbb',
    'bbbbbbhhhhbbbbbb',
    'bbbbbhhsshhbbbbb',
    'bbbbbhsssshbbbbb',
    'bbbbbhsssshbbbbp',
    'bbbbbbbssbbbbbpp',
    'bbbbkkkkkkkkbppp',
    'bbbkkkkkkkkkkppp',
    'pwwwwwwwwwwwpppp',
    'ppwwwwwwwwwppppp',
    'pppppwwwwppppppp',
  ], { b: matKBlue, p: matKPurple, w: matKWhite, s: matKDeskTop, h: matKWoodDark, k: matKBlack });

  // the dark corner panel on the front east corner: a mint ring over a white name bar
  pixelPanel(k, 32.75, FRONT, 's', 5.75, VS, [
    'ffffffffff',
    'fffttttfff',
    'ffttffttff',
    'fttffffttf',
    'fttffffttf',
    'ffttffttff',
    'fffttttfff',
    'ffffffffff',
    'fwwwwwwwff',
    'ffffffffff',
    'fgggggggff',
    'ffffffffff',
  ], { f: matKFrame, t: matKTeal, w: matKWhite, g: matKGreyLight });
}

/* ============================ the fire escape ============================ */
// Outside the two escape doors in the north wall (ESC1 x 2.75–5.25, ESC2 x 6–8.5):
// a steel landing at upper-floor level on two posts, and a spiral stair round a
// central pole from the yard up to it.
//
// The spiral: 20 risers of 0.25. Step k covers the angle 150° + 15k … +15° (angles
// from +X toward +Z, so 90° faces the wall); the top step runs on to 110° and
// merges into the landing. That is 320° in all — under one turn, so the stair
// never passes over itself — and on the walking line (r 1.75) a slope of 0.55.
// Treads run from the pole (r 0.5) to r 3; a steel stringer, balusters and a
// handrail ring r 3–3.5. The 40° left open (110°–150°) is the way on at the
// bottom, from under the landing.
//
// It is built a voxel column at a time (runs merged into boxes) rather than as
// rotated boxes, so every tread is exactly one step above the last, every column
// overlaps its neighbour (one connected piece down to the ground), and nothing
// sits under the landing deck that a player could stand on.
const SPIRAL = { x: 5.75, z: -40 };
const LAND = { x0: 2.25, x1: 9, z0: -38, z1: -35 };    // z1 is the wall's outer face
const STEPS = 20, RISE = .25, A0 = 150, DA = 15, A_END = 470;

/* the step under angle `deg`, or −1 in the open sector */
function stepAt(deg: number): number {
  const a = ((deg - A0) % 360 + 360) % 360;
  if (a >= A_END - A0) return -1;
  return Math.min(STEPS - 1, Math.floor(a / DA));
}

function fireEscape(k: Kit) {
  const { x: cx, z: cz } = SPIRAL;
  const R_POLE = .5, R_TREAD = 3, R_RAIL = 3.5, CLEAR = 2.25;
  const deck = L1 - VS;

  /* what fills one voxel column: [y0, y1] spans, all galvanised steel */
  const column = (x: number, z: number): [number, number][] => {
    const r = Math.hypot(x - cx, z - cz);
    if (r <= R_POLE || r > R_RAIL) return [];
    const deg = Math.atan2(z - cz, x - cx) * 180 / Math.PI;
    const s = stepAt(deg);
    if (s < 0) return [];
    const top = (s + 1) * RISE, bot = Math.max(0, top - .5);
    const under = x > LAND.x0 && x < LAND.x1 && z > LAND.z0 && z < LAND.z1;
    if (r <= R_TREAD) return under && top > deck - CLEAR ? [] : [[bot, top]];
    if (under) return [];
    const a = ((deg - A0) % 360 + 360) % 360;
    return Math.floor(a / 7.5) % 2 === 0
      ? [[bot, top + 1.25]]                                 // baluster, stringer to handrail
      : [[bot, top], [top + .75, top + 1.25]];              // stringer and handrail
  };
  // sweep the square round the pole a row at a time, merging equal neighbours into one box
  const n = Math.ceil(R_RAIL / VS) + 1;
  const ox = cx - n * VS, oz = cz - n * VS;
  for (let j = 0; j < 2 * n; j++) {
    const z0 = oz + j * VS, zc = z0 + VS / 2;
    let runKey = '', runX = 0, runSpans: [number, number][] = [];
    const flush = (xEnd: number) => { for (const [y0, y1] of runSpans) k.box(runX, xEnd, y0, y1, z0, z0 + VS, matKSteel); };
    for (let i = 0; i <= 2 * n; i++) {
      const x0 = ox + i * VS;
      const spans = i < 2 * n ? column(x0 + VS / 2, zc) : [];
      const key = spans.map((s) => s.join(':')).join('|');
      if (key === runKey) continue;
      flush(x0);
      runKey = key; runX = x0; runSpans = spans;
    }
  }
  k.cyl(cx, cz, R_POLE, 0, L1 + 1.25, matKSteel);   // the pole

  // the landing: a grating deck on edge beams, resting on the wall and on two posts
  const { x0, x1, z0, z1 } = LAND;
  k.box(x0, x1, deck, L1, z0, z1, matKSteel);
  k.box(x0, x1, deck - VS, deck, z0, z0 + VS, matKGrey);
  k.box(x0, x0 + VS, deck - VS, deck, z0, z1, matKGrey);
  k.box(x1 - VS, x1, deck - VS, deck, z0, z1, matKGrey);
  for (const x of [x0, x1 - VS]) k.box(x, x + VS, 0, deck - VS, z0, z0 + VS, matKSteel);
  // its railing: open on the north edge only where the top steps arrive (x 5–7.75)
  const rail = (ax: number, bx: number, az: number, bz: number) => {
    k.box(ax, bx, L1 + 1, L1 + 1.25, az, bz, matKSteel);
    k.box(ax, bx, L1 + .5, L1 + .75, az, bz, matKSteel);
    const alongX = bx - ax > bz - az, a = alongX ? ax : az, b = alongX ? bx : bz;
    for (let p = a; p < b - 1e-6; p += 1.25) {
      const q = Math.min(p, b - VS);
      if (alongX) k.box(q, q + VS, L1, L1 + 1, az, bz, matKSteel);
      else k.box(ax, bx, L1, L1 + 1, q, q + VS, matKSteel);
    }
    if (alongX) k.box(bx - VS, bx, L1, L1 + 1, az, bz, matKSteel);
    else k.box(ax, bx, L1, L1 + 1, bz - VS, bz, matKSteel);
  };
  rail(x0, 5, z0, z0 + VS);
  rail(7.75, x1, z0, z0 + VS);
  rail(x0, x0 + VS, z0, z1);
  rail(x1 - VS, x1, z0, z1);
  // a satellite dish clamped to the east rail
  k.box(x1, x1 + .5, L1 + .75, L1 + 1.5, -36.75, -36.25, matKWhite);

  // the light-grey panel the two doors sit in, from the landing to the coping
  // (the outer layer of the brick, repainted round the door holes), and a lamp over them
  const fz0 = z1, fz1 = z1 + VS;
  for (const [a, b] of [[2.5, 2.75], [5.25, 6], [8.5, 8.75]]) k.box(a, b, L1, L1 + 3, fz0, fz1, matKGreyLight);
  k.box(2.5, 8.75, L1 + 3, PARAPET - VS, fz0, fz1, matKGreyLight);
  k.box(5.5, 5.75, L1 + 3.5, L1 + 3.75, z1 - VS, z1, matKWhite);
}

export function buildFacade(k: Kit): void {
  upperWalls(k);
  lantern(k);
  entrance(k);
  overhangs(k);
  roofAndWalls(k);
  signs(k);
  fireEscape(k);
}
