/* ============================ kantoor — ground floor, west and centre ============================ */
// The rooms you walk through first: the entrance, the slate atrium round the
// stair, the lounge in the west wing, the two meeting rooms with their photo
// walls, the small office behind them, the graffiti corridor and the kantine.
// Positions come from the plan (game metres, X east, Z south); what stands
// where comes from the estate agent's photos and the walkthrough video.
//
// Wall faces, as the shell builds them (an inner wall is 0.5 thick on its plan
// line, an outer wall's plaster face is 0.375 in from its line):
//   kantine        N −34.25, S −18.75, E 5.5 (spine), store W face 0.5 / S face −31.5
//   kantoor_W1     N −18.25, S −10.75, E 0.5 then the curved glass wall
//   kantoor_W2     N −10.25, S 3.25, E −4.25 (south part) / curved glass wall (north part)
//   kantoor_SW     N 3.75, S 16.25, E −4.25
//   corridor_N     E 5.5 (spine), N −18.25
//   atrium         W −3.75, E 9.75 (glass to the receptie from z 16.5)
//   ontvangstruimte N 16.75, S 34.25, W −15.5, E −4.25
//   entree         x −1.75 … 7.75, z 27 … 34.25; techniek x −3.75 … −2.25; kastruimte x 8.25 … 9.75
// The west facade is slanted: it runs from about x −12.8 at the north corner to
// −29.4 at the south one, so every west room is a trapezoid.
import type * as THREE from 'three';
import { type Kit, type Pt, P, L0, CEIL0, snap } from './kit';
import { GROUND } from './plan';
import { room } from './structure';
import {
  type Dir, lbox, chair, chairsAround, sofa, stool, desk, table, roundTable, cabinet, shelves,
  kitchenRun, plant, pendant, pixelPanel, panel,
} from './props';
import {
  matKWhite, matKBlack, matKGrey, matKGreyDark, matKGreyLight, matKSteel, matKDeskTop, matKWoodDark,
  matKRed, matKOrange, matKYellow, matKPink, matKPurple, matKBlue, matKTeal, matKGreen,
  matKLight, matKFrame, matKGlass, matKGlassPale, matKFloorWood, matKWallWarm, matKPaverLine, matKPot,
} from '../../materials';

/* ============================ small shared pieces ============================ */
/* The ceiling kit every room has: flush 60×60 LED panels, 4-way air-con
   cassettes, round downlights. All of it sits against the ceiling underside. */
const led = (k: Kit, cx: number, cz: number) => k.box(cx - .75, cx + .75, CEIL0 - .25, CEIL0, cz - .75, cz + .75, matKLight);
const downlight = (k: Kit, cx: number, cz: number) => k.box(cx - .25, cx + .25, CEIL0 - .25, CEIL0, cz - .25, cz + .25, matKLight);
function cassette(k: Kit, cx: number, cz: number) {
  k.box(cx - 1, cx + 1, CEIL0 - .25, CEIL0, cz - 1, cz + 1, matKWhite);
  k.box(cx - .5, cx + .5, CEIL0 - .5, CEIL0 - .25, cz - .5, cz + .5, matKGrey);   // the grille
}
/* a dark full-height curtain bunched against an axis-aligned wall */
const curtain = (k: Kit, x0: number, x1: number, z0: number, z1: number, mat: THREE.Material = matKGreyDark) =>
  k.box(x0, x1, L0, CEIL0, z0, z1, mat);
/* Curtains either side of a window in the slanted west facade, read straight
   off the plan so they follow the slant. `ends` drops one where it would run
   into a cross wall. */
function slantCurtains(k: Kit, id: string, ends: 'ab' | 'a' | 'b' = 'ab') {
  const o = GROUND.openings.find((q) => q.id === id);
  if (!o) return;
  const A = P(o.a[0], o.a[1]), B = P(o.b[0], o.b[1]);
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
  let nx = -uz, nz = ux;
  if (nx < 0) { nx = -nx; nz = -nz; }              // indoors is east of the west facade
  const deg = Math.atan2(uz, ux) * 180 / Math.PI;
  const put = (p: Pt, s: number) =>
    k.obox(p[0] + ux * s * .75 + nx * .625, p[1] + uz * s * .75 + nz * .625, 1, .5, L0, CEIL0, deg, matKGreyDark);
  if (ends.includes('a')) put(A, -1);
  if (ends.includes('b')) put(B, 1);
}
/* a framed wall TV */
const tv = (k: Kit, cx: number, cz: number, dir: Dir, w: number, y0: number, y1: number) => panel(k, cx, cz, dir, w, y0, y1, matKBlack);

/* A little pixel canvas for the big murals: draw with a few shapes, hand the
   rows to pixelPanel. (0,0) is the top-left cell as the viewer sees it. */
class Pix {
  readonly g: string[][];
  constructor(readonly w: number, readonly h: number, bg: string) {
    this.g = Array.from({ length: h }, () => Array<string>(w).fill(bg));
  }
  dot(x: number, y: number, c: string) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.g[y][x] = c;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.dot(x, y, c);
  }
  ell(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.dot(x, y, c);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string, th = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) this.dot(x + a, y + b, c);
    }
  }
  rows(): string[] { return this.g.map((r) => r.join('')); }
}

/* ============================ kantine ============================ */
// The canteen in the north-west corner. A light-grey handle-less kitchen down
// the spine wall, a long bar in front of it with magenta stools on the dining
// side and a round sink on the kitchen side, three silver drums over the bar.
// The dining side has the white oval table, bistro tables by the windows, a
// foosball table, the framed yellow football shirt beside the navy fire exit,
// and the dartboard on an ochre panel on the side of the store cupboard.
function kantine(k: Kit) {
  const r = room('kantine');
  const E = 5.5, S = -18.75, N = -34.25;   // wall faces (the plan bbox stops a voxel short of the spine)

  // the kitchen aisle is tiled in big pale-grey tiles; the rest keeps the dark carpet tile
  k.paintRect(1.5, E, -31.5, S, matKGrey);
  k.paintRect(.5, 1.5, -31.5, -29.25, matKGrey);

  /* ---- kitchen run along the spine wall, north to south ---- */
  cabinet(k, 4, E, -31.5, -28.5, L0, CEIL0, matKGreyLight);                 // two tall units, floor to ceiling
  k.box(4, 4.25, 1.5, 2.25, -29.75, -28.75, matKBlack);                     // the built-in oven, flush
  k.box(4, 4.25, 2.25, 2.5, -29.75, -28.75, matKSteel);
  kitchenRun(k, 4.75, -26.75, 3.5, 'w', L0, matKGreyLight, matKPaverLine);  // worktop with wall units over it
  k.box(4.25, 4.75, 1, 1.75, -27.75, -27.25, matKBlack);                    // blender
  k.box(4.25, 5, 1, 1.25, -26.25, -25.5, matKSteel);                        // contact grill
  cabinet(k, 4, E, -25, -23.75, L0, CEIL0, matKGreyLight);                  // tall unit
  // the coffee niche: a recess in the tall units with the bean-to-cup machine
  // over a black water cooler — the one thing everybody in the building uses
  k.box(4, E, L0, CEIL0, -22.5, -22.25, matKGreyLight);                     // cheek
  k.box(4, E, 3, CEIL0, -23.75, -22.5, matKGreyLight);                      // cupboard over the niche
  k.box(4.5, E, L0, 1.5, -23.5, -22.75, matKBlack);                         // water cooler
  k.box(4.25, E, 1.5, 1.75, -23.75, -22.5, matKWhite);                      // shelf
  k.box(4.5, E, 1.75, 2.75, -23.5, -22.75, matKBlack);                      // coffee machine
  k.box(4.25, 4.5, 1.75, 2, -23.25, -23, matKWhite);                        // its drip tray
  k.box(4.25, 4.5, 2.25, 2.5, -23.25, -23, matKGlassPale);                  // its screen

  /* ---- the bar: kitchen counter on the east, raised black bar on the west ---- */
  k.box(.25, 1.5, L0, .75, -28.5, -21.5, matKGreyLight);
  k.box(.25, 1.5, .75, 1, -28.5, -21.5, matKPaverLine);
  k.cyl(.25, -28.5, 1, L0, .75, matKGreyLight);                             // the curved north end
  k.cyl(.25, -28.5, 1, .75, 1, matKPaverLine);
  k.box(-.75, .25, L0, 1, -28.5, -21.5, matKBlack);
  k.box(-1, .25, 1, 1.25, -28.5, -21.5, matKPaverLine);                     // bar ledge, stone-look top
  k.box(.5, 1, .75, 1, -26.5, -26, matKSteel);                              // round sink
  k.box(.25, .5, 1, 1.5, -26.5, -26.25, matKSteel);                         // tap
  k.box(-.5, 0, L0, .75, -21.25, -20.75, matKSteel);                        // pedal bin at the south end
  for (let i = 0; i < 6; i++) stool(k, -1.875, -27.875 + i * 1.25, L0, matKPink);
  for (const z of [-27.125, -25.125, -23.125]) pendant(k, .375, z, CEIL0, .625, 1.25, matKSteel);

  /* ---- dining ---- */
  // white marble-look oval table, long axis east–west, white shell chairs round it
  k.box(-11, -8, .75, 1, -27.25, -24.75, matKWhite);
  k.cyl(-11, -26, 1.25, .75, 1, matKWhite);
  k.cyl(-8, -26, 1.25, .75, 1, matKWhite);
  k.box(-10.25, -8.75, L0, .75, -26.25, -25.75, matKBlack);                 // central column
  for (const x of [-11.5, -9.5, -7.5]) { chair(k, x, -28, 's', L0, matKWhite); chair(k, x, -24, 'n', L0, matKWhite); }
  chair(k, -13, -26, 'e', L0, matKWhite);
  chair(k, -6, -26, 'w', L0, matKWhite);
  // round bistro tables by the windows
  roundTable(k, -10.5, -31, .75, L0, matKWhite, 1, matKBlack);
  chair(k, -10.5, -32.25, 's', L0, matKWhite); chair(k, -10.5, -29.75, 'n', L0, matKWhite);
  roundTable(k, -14, -21, .75, L0, matKWhite, 1, matKBlack);
  chair(k, -14, -22.25, 's', L0, matKWhite); chair(k, -14, -19.75, 'n', L0, matKWhite);
  // high table with two black stools under the shirt
  roundTable(k, -6.25, -32.75, .5, L0, matKWhite, 1.25, matKBlack);
  stool(k, -7.375, -32.625, L0); stool(k, -6.125, -31.375, L0);
  // foosball table: dark cabinet on legs, green pitch, steel rods across
  for (const [x, z] of [[-11.5, -21.5], [-8.25, -21.5], [-11.5, -20.25], [-8.25, -20.25]]) k.box(x, x + .25, L0, .5, z, z + .25, matKBlack);
  k.box(-11.5, -8, .5, 1, -21.5, -20, matKBlack);
  k.box(-11.25, -8.25, .75, 1, -21.25, -20.25, matKGreen);
  for (const x of [-10.75, -10, -9.25, -8.5]) {
    k.box(x, x + .25, 1, 1.25, -22, -19.5, matKSteel);
    k.box(x, x + .25, .75, 1.25, -22.25, -22, matKBlack);                   // handles
  }

  /* ---- walls ---- */
  // the ochre panel with the dartboard, on the side of the store cupboard
  const dart = new Pix(8, 14, 'o');
  dart.ell(3.5, 5, 3.6, 3.6, 'b');
  for (let y = 2; y <= 8; y++) for (let x = 1; x <= 6; x++) {
    if ((x - 3.5) ** 2 + (y - 5) ** 2 <= 6.5) dart.dot(x, y, (x + y) % 2 ? 'k' : 'w');
  }
  dart.rect(3, 4, 5, 6, 'r'); dart.rect(3, 5, 4, 6, 'g');
  pixelPanel(k, .5, -33, 'w', .5, .25, dart.rows(),
    { o: matKOrange, b: matKBlue, k: matKBlack, w: matKWallWarm, r: matKRed, g: matKGreen });
  // the framed, signed yellow football shirt with its black sash
  pixelPanel(k, -5, N, 's', 1.75, .25, [
    'kkkkkkkk',
    'kyykkyyk',
    'yyyyyykk',
    'yyyyykky',
    'kyykkyyk',
    'kykkyyyk',
    'kkyyyyyk',
    'kkkkkkkk',
  ], { k: matKBlack, y: matKYellow });
  k.box(-3, -2, 3.25, 3.75, N, N + .25, matKGreen);                       // exit sign over the fire door
  // small orange/pink abstract between the windows
  pixelPanel(k, -11, N, 's', 2, .25, ['ppoo', 'pooy', 'ooyy', 'oyyw'],
    { p: matKPink, o: matKOrange, y: matKYellow, w: matKWallWarm });
  // the photo-collage panel on the south wall: a mosaic of pinks, reds and browns
  const col = new Pix(20, 7, 'p');
  const tones = ['p', 'r', 'n', 'o', 'f'];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 20; x++) col.dot(x, y, tones[(x * 7 + y * 13 + (x >> 2) * 3) % 5]);
  pixelPanel(k, -1.5, S, 'n', 1.5, .25, col.rows(),
    { p: matKPink, r: matKRed, n: matKWoodDark, o: matKOrange, f: matKWallWarm });
  // curtains: the north window and the three in the slanted facade
  curtain(k, -10.25, -9.5, N, N + .25);
  curtain(k, -6.75, -6.25, N, N + .25);
  slantCurtains(k, 'O_SL1'); slantCurtains(k, 'O_SL2'); slantCurtains(k, 'O_SL3', 'a');

  /* ---- ceiling ---- */
  cassette(k, -9.5, -30); cassette(k, -6, -21.5);
  for (const [x, z] of [[-13, -27], [-6, -27], [-9.5, -23], [-3.5, -30], [-3.5, -22], [3, -26], [3, -21]]) downlight(k, x, z);
  led(k, -11.25, -32.25);
}

/* the store cupboard in the kantine's north-east corner */
function kantineBerging(k: Kit) {
  const r = room('kantine_berging');
  const E = 5.5, N = -34.25;
  shelves(k, 5, -33.25, 2, 'w', L0, 3, matKGreyLight);                     // steel-grey racking on the spine wall
  k.box(3.5, 4.5, L0, .75, N, N + 1, matKFloorWood);                      // cardboard boxes
  k.box(3.75, 4.5, .75, 1.25, N, N + .75, matKFloorWood);
  k.box(4.75, E, L0, .75, -32.25, -32, matKRed);                          // a crate of drinks under the racking
  downlight(k, 3, -33);
}

/* ============================ kantoorruimte W1 ============================ */
// The narrow office between the kantine and the meeting rooms (nobody
// photographed it). Dressed as a small working office: three oak desks facing
// the north wall, low cupboards and a whiteboard on the south wall, a tall
// cupboard by the corridor door.
function kantoorW1(k: Kit) {
  const r = room('kantoor_W1');
  const N = -18.25, S = -10.75;
  for (const x of [-13.5, -9, -4.5]) desk(k, x, N + 1, 'n', L0, { monitors: 2 });
  cabinet(k, -12, -4, S - 1, S, L0, 1.25, matKWhite);                    // low cupboards
  panel(k, -8, S, 'n', 5, 1.75, 3.25, matKWhite);                        // whiteboard over them
  k.box(-10.75, -5.25, 1.5, 1.75, S - .25, S, matKGreyLight);            // its pen tray
  cabinet(k, -15, -13.5, S - 1, S, L0, 1, matKGreyLight);                // printer cabinet
  k.box(-14.75, -13.75, 1, 1.5, S - .75, S - .25, matKGrey);             // the printer
  cabinet(k, -.75, .5, N, -16.5, L0, 2.75, matKWhite);                   // tall cupboard by the door
  plant(k, -17.125, -11.875, L0);
  slantCurtains(k, 'O_SL4');
  led(k, -11.25, -14.5); led(k, -5, -14.5); cassette(k, -15.5, -14.5);
}

/* ============================ kantoorruimte W2 — the swimmer room ============================ */
// Meeting room. The whole south wall is a photo print of a swimmer in a red cap
// doing the crawl, seen from under the water, lane rope across. A white oval
// ring table, open at the east end, with grey swivel chairs; a square LED frame
// hangs over it. TV on the north wall, curtains at the three windows.
function kantoorW2(k: Kit) {
  const r = room('kantoor_W2');
  const N = -10.25, S = 3.25;

  /* ---- the swimmer mural (viewer faces south: left is east) ---- */
  const m = new Pix(80, 16, 'B');
  m.rect(0, 0, 80, 2, 'T');                                     // bright water under the surface
  for (let x = -10; x < 80; x += 9) m.line(x + 8, 0, x, 9, 'G');   // light streaks
  m.rect(0, 13, 80, 16, 'G');
  m.rect(0, 0, 22, 16, 'N');                                    // the deep end, dark, behind the lettering
  m.line(0, 11, 79, 8, 'W');                                    // lane rope, beaded
  for (let x = 0; x < 80; x += 3) m.dot(x, 11 - x * 3 / 79, 'R');
  // where the lettering is: pale broken bars, nothing readable
  for (let x = 3; x < 19; x++) if (x % 4 !== 3) { m.dot(x, 4, 'W'); m.dot(x, 5, 'W'); }
  for (let x = 3; x < 16; x++) if (x % 5 !== 4) { m.dot(x, 7, 'W'); m.dot(x, 8, 'W'); }
  // the swimmer, heading west (to the viewer's right)
  m.line(40, 9, 49, 7, 'S', 2);                                 // legs
  m.ell(37, 9, 3, 1.5, 'W');                                    // kick
  m.ell(54, 7, 6, 1.8, 'K');                                    // swimsuit
  m.ell(61, 6.5, 3, 1.6, 'S');                                  // shoulders
  m.ell(66, 5.5, 2.2, 1.8, 'R');                                // red cap
  m.dot(68, 6, 'K');                                            // goggles
  m.line(64, 5, 76, 2, 'S');                                    // reaching arm
  m.line(60, 7, 55, 11, 'S');                                   // pulling arm
  m.ell(72, 3, 4, 2, 'P'); m.ell(76, 2, 2, 1, 'W'); m.ell(69, 8, 2, 1, 'W');   // foam
  for (const [x, y] of [[44, 3], [50, 4], [58, 2], [62, 10], [70, 11], [74, 7], [47, 12]]) m.dot(x, y, 'P');
  pixelPanel(k, -14.25, S, 'n', .25, .25, m.rows(), {
    B: matKBlue, T: matKTeal, G: matKGlass, N: matKFrame, W: matKWhite, R: matKRed, S: matKDeskTop, K: matKBlack, P: matKGlassPale,
  });

  /* ---- the ring table ---- */
  const cx = -14, cz = -3, ell = (ax: number, az: number, a0: number, a1: number, n: number): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      return [cx + ax * Math.cos(a), cz + az * Math.sin(a)] as Pt;
    });
  const outer = ell(5.5, 3, 0, 360, 48).slice(0, -1);
  const hole: Pt[] = [[cx + 7, cz + 1.25], ...ell(3.75, 1.25, 90, 270, 24), [cx + 7, cz - 1.25]];   // open at the east end
  k.poly(outer, .75, 1, matKWhite, [hole]);
  for (const a of [45, 90, 135, 180, 225, 270, 315]) {
    const t = a * Math.PI / 180, x = snap(cx + 4.5 * Math.cos(t)), z = snap(cz + 2.25 * Math.sin(t));
    k.box(x, x + .25, L0, .75, z, z + .25, matKGreyLight);
  }
  for (let i = 0; i < 12; i++) {
    const t = (30 + i * 300 / 11) * Math.PI / 180, dx = Math.cos(t), dz = Math.sin(t);
    const x = snap(cx + 6.75 * dx), z = snap(cz + 4.25 * dz);
    const dir: Dir = Math.abs(dx) * 1.5 > Math.abs(dz) ? (dx > 0 ? 'w' : 'e') : (dz > 0 ? 'n' : 's');
    chair(k, x, z, dir, L0, matKGrey);
  }
  // the square LED frame over it, on four wires
  k.box(-17, -11, 3, 3.25, -4.5, -4.25, matKSteel); k.box(-17, -11, 3, 3.25, -1.75, -1.5, matKSteel);
  k.box(-17, -16.75, 3, 3.25, -4.25, -1.75, matKSteel); k.box(-11.25, -11, 3, 3.25, -4.25, -1.75, matKSteel);
  for (const [x, z] of [[-17, -4.5], [-11.25, -4.5], [-17, -1.75], [-11.25, -1.75]]) k.box(x, x + .25, 3.25, CEIL0, z, z + .25, matKGrey);

  /* ---- walls and the rest ---- */
  tv(k, -16, N, 's', 4, 1.5, 3.25);
  cabinet(k, -4, -1, N, N + 1, L0, 1, matKWhite);                       // sideboard in the north-east corner
  plant(k, -5.375, -9.375, L0);
  slantCurtains(k, 'O_SL5', 'b'); slantCurtains(k, 'O_SL6'); slantCurtains(k, 'O_SL7', 'a');
  cassette(k, -7, -6.5); led(k, -19.25, -7.5); led(k, -8.25, 0.75); led(k, -2, -7.5);
}

/* ============================ kantoorruimte SW — the "lovely day" room ============================ */
// The big meeting room. Its north wall is a full-length photo print: a bearded
// man in glasses and a purple jumper beside a shopping trolley, everything
// washed raspberry and orange, a slogan in white at the west end. A long white
// table with sixteen orange cantilever chairs; two linear lamps over it; a TV
// on the south wall by the door and a black rolling cabinet.
function kantoorSW(k: Kit) {
  const r = room('kantoor_SW');
  const N = 3.75, S = 16.25;

  /* ---- the mural (viewer faces north: left is west) ---- */
  const m = new Pix(80, 16, 'M');
  m.ell(12, 5, 16, 6, 'O');                                     // warm light from the west
  m.ell(8, 3, 7, 2.5, 'F');
  m.ell(30, 13, 8, 4, 'V');
  m.rect(68, 0, 80, 16, 'D');                                   // plum shadow at the east end
  // where the slogan is: two pale broken bars, nothing readable
  for (let x = 5; x < 27; x++) if (x % 4 !== 3) { m.dot(x, 6, 'W'); m.dot(x, 7, 'W'); }
  for (let x = 5; x < 20; x++) if (x % 5 !== 4) { m.dot(x, 9, 'W'); m.dot(x, 10, 'W'); }
  // the shopping trolley: a pale wire basket, diagonal, on the east side
  for (let x = 56; x <= 78; x += 2) m.line(x, 3, x - 3, 14, 'L');
  m.line(55, 3, 79, 2, 'L'); m.line(53, 9, 79, 8, 'L'); m.line(52, 14, 76, 14, 'L');
  m.line(52, 1, 60, 0, 'O');                                    // the handle
  // the man, three-quarter view, looking down to the west
  m.ell(46, 13, 9, 5, 'V');                                     // purple jumper
  m.ell(45, 15, 6, 2, 'D');
  m.line(52, 11, 58, 12, 'V', 2);                               // arm on the trolley
  m.ell(44, 3, 3, 2.5, 'D');                                    // hair
  m.ell(43.5, 5, 2.5, 2.5, 'F');                                // face
  m.ell(43, 7.5, 2.5, 1.5, 'D');                                // beard
  m.line(41, 4.5, 45, 4.5, 'K');                                // glasses
  pixelPanel(k, -14.25, N, 's', .25, .25, m.rows(), {
    M: matKPink, O: matKOrange, F: matKDeskTop, V: matKPurple, D: matKWoodDark, W: matKWhite, L: matKGreyLight, K: matKBlack,
  });

  /* ---- the table and its orange chairs ---- */
  table(k, -22.5, -10.5, 8.5, 11.5, L0, matKWhite, 1, matKGreyLight);
  chairsAround(k, -22.5, -10.5, 8.5, 11.5, L0, matKOrange, 1.5);       // eight a side
  chair(k, -7.25, 5, 's', L0, matKOrange); chair(k, -6, 5, 's', L0, matKOrange);   // spares by the door
  // two long linear lamps in an L over the table, each on two wires
  k.box(-21, -15, 3, 3.25, 9.25, 9.5, matKSteel);
  k.box(-14.5, -14.25, 3, 3.25, 8, 12, matKSteel);
  for (const [x, z] of [[-21, 9.25], [-15.25, 9.25], [-14.5, 8], [-14.5, 11.75]]) k.box(x, x + .25, 3.25, CEIL0, z, z + .25, matKGrey);

  /* ---- walls and the rest ---- */
  tv(k, -7.5, S, 'n', 4.5, 1.5, 3.5);
  cabinet(k, -6, -5, 14, 15, L0, 1.25, matKBlack, null);               // lockable rolling cabinet
  plant(k, -26.125, 15.375, L0);
  slantCurtains(k, 'O_SL8'); slantCurtains(k, 'O_SL9');
  curtain(k, -20, -19.25, S - .25, S);
  cassette(k, -16.5, 6.5); led(k, -21, 13.5); led(k, -12, 13.5); led(k, -8, 8);
}

/* ============================ corridor N — the graffiti wall ============================ */
// The corridor from the atrium to the kantine. The curved wall on the west is
// glass into the two meeting rooms; the straight east wall is one big graffiti
// piece: an orange cat's head with white whiskers, a purple owl with a huge
// orange eye, a blue fox, a brown zig-zag across them, grey and white teeth
// along the bottom.
function corridorN(k: Kit) {
  const r = room('corridor_N');
  const E = 5.5;
  // viewer faces east: left is north (the kantine end)
  const m = new Pix(63, 17, 'g');
  for (let x = 0; x < 63; x += 5) for (let y = 1; y < 10; y += 4) m.dot(x + (y % 3), y, 'l');
  for (let y = 11; y < 17; y++) for (let x = 0; x < 63; x++) m.dot(x, y, Math.abs((x % 6) - 2.5) < (y - 10) / 2 ? 'w' : 'g');
  // cat
  m.ell(10, 7, 11, 7, 'o');
  m.line(2, 3, 0, 0, 'o', 3); m.line(16, 1, 19, 0, 'o', 2);
  m.ell(15, 5, 3.5, 2.5, 'l'); m.ell(15, 5, 2.5, 2, 'y'); m.ell(15, 5, 1, 1.5, 'k');
  m.ell(10, 10.5, 4, 2, 'p'); m.ell(10, 10.5, 2.5, 1, 'c');
  m.line(0, 6, 9, 8, 'w'); m.line(0, 9, 8, 9, 'w'); m.line(1, 12, 8, 10, 'w');
  m.line(5, 1, 21, 3, 'b', 2); m.dot(9, 2, 'c'); m.dot(14, 2, 'c'); m.dot(19, 3, 'c');
  // owl
  m.ell(34, 7, 9, 8, 'p');
  for (let x = 26; x < 43; x++) m.dot(x, 1 + (x % 2), 'w');
  m.ell(34, 8, 5, 4.5, 'w'); m.ell(34, 8, 4, 3.5, 'p'); m.ell(34, 8, 3, 2.5, 'o'); m.ell(34, 8, 1.2, 1.2, 'k');
  m.line(25, 4, 43, 2, 'k', 2);
  // fox
  m.ell(53, 9, 9, 8, 'b'); m.ell(53, 9, 6, 5, 'c'); m.ell(53, 9, 3, 3, 'b');
  for (let i = 0; i < 7; i++) m.dot(46 + i * 2, 14 - i, 'k');
  m.ell(56, 3, 4, 3, 'o'); m.ell(57, 3, 2, 1.5, 'w'); m.dot(57, 3, 'k');
  // the brown zig-zag across the lot
  m.line(12, 15, 40, 10, 'n', 2); m.line(12, 16, 40, 11, 'k');
  pixelPanel(k, E, -10.375, 'w', 0, .25, m.rows(), {
    g: matKGrey, l: matKGreyLight, w: matKWhite, o: matKOrange, y: matKYellow, k: matKBlack,
    p: matKPurple, c: matKGlassPale, b: matKBlue, n: matKWoodDark,
  });
  // fire extinguisher by the kantine door, on the mural
  k.box(E - .5, E - .25, .25, 1, -17.5, -17.25, matKRed);
  k.box(E - .5, E - .25, 1, 1.25, -17.5, -17.25, matKBlack);
  for (const z of [-15.5, -11.5, -7.5, -4]) downlight(k, 3, z);
}

/* ============================ atrium ============================ */
// The slate hall round the stair. Deliberately sparse, as it is: a white high
// table with two purple stools on the left as you come in, a tall orange vase
// of flowers at the far end, a framed print of a child and a bear on the east
// wall, and the trail of coloured footprint stickers from the front door to
// the receptie glass. The stair and the strip in front of it stay clear.
function atrium(k: Kit) {
  const r = room('atrium');
  const W = -3.75, E = 9.75;

  // high table and stools by the west wall, south of the lounge door
  roundTable(k, -2.25, 25, .75, L0, matKWhite, 1.25, matKBlack);
  stool(k, -.875, 25.125, L0, matKPurple);
  stool(k, -3.125, 24.125, L0, matKPurple);
  // the orange vase with its bunch of flowers, by the east wall at the north end
  k.cyl(9, 3.5, .5, L0, 1.25, matKOrange);
  k.box(8.75, 9.25, 1.25, 1.75, 3.25, 3.75, matKGreen);
  k.box(8.25, 9.75, 1.75, 2.25, 2.75, 4.25, matKPink);
  k.box(8.5, 9.5, 2.25, 2.5, 3, 4, matKOrange);
  k.box(8.75, 9.25, 2.5, 2.75, 3.25, 3.75, matKPurple);
  // child-and-bear print on the east wall, between the toilet passage and the receptie glass
  pixelPanel(k, E, 12.75, 'w', 1.25, .25, [
    'kkkkkkkk',
    'kppppppk',
    'kpnnpppk',
    'knnnnppk',
    'knnnnpfk',
    'knnnnrrk',
    'knnnnrfk',
    'knnnppfk',
    'kppppppk',
    'kkkkkkkk',
  ], { k: matKBlack, p: matKPink, n: matKWoodDark, r: matKRed, f: matKDeskTop });
  // fire extinguisher on the west wall
  k.box(W, W + .25, .25, 1, 16, 16.5, matKRed);
  k.box(W, W + .25, 1, 1.25, 16, 16.5, matKBlack);
  // a tall plant in the south-east corner, by the receptie glass
  plant(k, 9.125, 25.875, L0, 2.5);

  // footprint stickers: through the front doors, then off at an angle to the receptie
  const FOOT = [matKPink, matKOrange, matKYellow, matKWallWarm];
  const path: Pt[] = [[3, 34], [3.25, 28], [9, 21.5]];
  let i = 0;
  for (let s = 0; s + 1 < path.length; s++) {
    const [ax, az] = path[s], [bx, bz] = path[s + 1];
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, alongZ = Math.abs(uz) >= Math.abs(ux);
    for (let d = 0; d < L; d += .75, i++) {
      const side = i % 2 ? .25 : -.25;
      const x = snap(ax + ux * d - uz * side), z = snap(az + uz * d + ux * side);
      k.paintRect(x, x + (alongZ ? .25 : .5), z, z + (alongZ ? .5 : .25), FOOT[i % 4]);
    }
  }

  // ceiling: downlights either side of the stair void, a cassette at each end
  for (const z of [-1, 4, 9, 14, 19, 24]) { downlight(k, -1.5, z); downlight(k, 7.75, z); }
  cassette(k, 3, 24.75); cassette(k, 3, .75);
}

/* ============================ entree ============================ */
// The vestibule between the two sets of glass doors: mats, a fire extinguisher
// and a tenant board (dark, a pale band where the names go). The doors to the
// meter cupboard and the coat cupboard are on either side.
function entree(k: Kit) {
  const r = room('entree');
  k.paintRect(.75, 5.25, 32.5, 34.25, matKGreyDark);                     // doormats
  k.paintRect(.75, 5.25, 27, 28, matKGreyDark);
  k.box(-1.75, -1.5, .25, 1, 30.5, 30.75, matKRed);                     // extinguisher between the techniek doors
  k.box(-1.75, -1.5, 1, 1.25, 30.5, 30.75, matKBlack);
  pixelPanel(k, 7.75, 30.625, 'w', 1.5, .25, ['fff', 'www', 'fff', 'lll', 'fff'],
    { f: matKFrame, w: matKWhite, l: matKGreyLight });
  downlight(k, 3, 30); downlight(k, -.5, 30.5); downlight(k, 6.5, 30.5);
}

/* the meter and fuse room west of the entree: everything flat on the back wall */
function techniek(k: Kit) {
  const r = room('techniek');
  const W = -3.75;
  k.box(W, W + .25, .75, 2.75, 27.75, 29.75, matKGreyLight);          // distribution board
  k.box(W + .25, W + .5, 1.25, 2.25, 28, 29.5, matKGrey);
  cabinet(k, W, W + .5, 30, 31.25, L0, 2.75, matKWhite, null);           // meter cupboard
  k.box(W, W + .25, 1.5, 2.5, 32, 33, matKBlack);                        // network switch box
  k.box(W, W + .25, L0, CEIL0, 33.75, 34, matKSteel);                    // pipes up the corner
  k.box(W + .25, W + .5, L0, CEIL0, 33.75, 34, matKSteel);
  downlight(k, -3, 30.5);
}

/* the coat cupboard east of the entree */
function kastruimte(k: Kit) {
  const r = room('kastruimte');
  const E = 9.75, S = 34.25;
  cabinet(k, E - .5, E, 27, 30.75, L0, 2.75, matKWhite);
  k.box(E - .5, E - .25, 2.5, 2.75, 30.75, S, matKSteel);               // coat rail
  k.box(E - .75, E, 3, 3.25, 30.75, S, matKWhite);                     // hat shelf
  [matKBlack, matKBlue, matKGreyDark, matKRed].forEach((m, i) => k.box(E - .75, E, 1.25, 2.5, 31.25 + i * .75, 31.75 + i * .75, m));
  downlight(k, 9, 30.5);
}

/* ============================ ontvangstruimte ============================ */
// The lounge in the west wing, behind the glass corner of the front. Pale oak
// floor, a patchwork rug, two cream sofas along the windows, a glass coffee
// table with a big bunch of flowers under a giant beige drum lamp, two red
// "orange slice" chairs facing the sofas. Along the north wall a built-in
// display wall: anthracite pilasters, pale grey bays, the TV in the middle, a
// white oval table with four cream chairs in front of it.
function ontvangstruimte(k: Kit) {
  const r = room('ontvangstruimte');
  const N = 16.75, S = 34.25, W = -15.5, E = -4.25;

  k.paintRect(W, E, N, S, matKFloorWood);
  // rug: grey-blue patchwork
  for (let x = -13.5; x < -7; x += 1.25) for (let z = 25; z < 29.5; z += 1.5) {
    const odd = (Math.round(x / 1.25) + Math.round(z / 1.5)) % 2 !== 0;
    k.paintRect(x, Math.min(x + 1.25, -7), z, Math.min(z + 1.5, 29.5), odd ? matKGrey : matKGreyLight);
  }
  // the round grey column inside the west glass
  k.cyl(-14.875, 25.625, .5, L0, CEIL0, matKSteel);

  /* ---- the display wall ---- */
  for (const [x0, x1] of [[W, -15], [-12, -11.5], [-8.25, -7.75], [-4.75, E]]) k.box(x0, x1, L0, CEIL0, N, N + .75, matKGreyDark);
  const bays: [number, number][] = [[-15, -12], [-11.5, -8.25], [-7.75, -4.75]];
  for (const [x0, x1] of bays) {
    k.box(x0, x1, L0, CEIL0, N, N + .25, matKGreyLight);                // pale grey back
    k.box(x0, x1, 3.75, CEIL0, N + .25, N + .75, matKSteel);            // brushed-steel valance
  }
  // west bay: low cupboard, shelves with the pottery pigs
  cabinet(k, -15, -12, N + .25, N + 1, L0, 1, matKWhite, null);
  for (const y of [1.75, 2.5, 3.25]) k.box(-15, -12, y - .25, y, N + .25, N + .75, matKGreyLight);
  k.box(-14.5, -14, 1.75, 2.25, N + .25, N + .75, matKPink); k.box(-13, -12.5, 2.5, 3, N + .25, N + .75, matKWhite);
  k.box(-14, -13.25, 1, 1.5, N + .25, N + .75, matKBlack);              // framed photos
  // middle bay: worktop and the TV
  cabinet(k, -11.5, -8.25, N + .25, N + 1, L0, 1, matKWhite, null);
  tv(k, -9.875, N + .25, 's', 2.25, 1.75, 3);
  // east bay: deeper white cupboard, books and a pig on the shelves
  cabinet(k, -7.75, -4.75, N + .25, N + 1.25, L0, 1, matKWhite, null);
  for (const y of [2, 2.75]) k.box(-7.75, -4.75, y - .25, y, N + .25, N + .75, matKGreyLight);
  k.box(-7.5, -6.5, 2.75, 3.25, N + .25, N + .75, matKBlue); k.box(-6.5, -6, 2.75, 3.25, N + .25, N + .75, matKRed);
  k.box(-5.5, -5, 2, 2.5, N + .25, N + .75, matKPink);

  // white oval table on one black foot, four cream leather chairs
  k.box(-12, -10, .75, 1, 19.25, 21.75, matKWhite);
  k.cyl(-12, 20.5, 1.25, .75, 1, matKWhite); k.cyl(-10, 20.5, 1.25, .75, 1, matKWhite);
  k.box(-11.25, -10.75, .25, .75, 20.25, 20.75, matKBlack);
  k.box(-12, -10, L0, .25, 20, 21, matKBlack);
  for (const x of [-12.25, -9.75]) { chair(k, x, 18.5, 's', L0, matKWallWarm); chair(k, x, 22.5, 'n', L0, matKWallWarm); }

  /* ---- the lounge corner ---- */
  sofa(k, -14.625, 29.5, 6, 'e', L0, matKWallWarm);                     // along the west window
  sofa(k, -10.25, 33.375, 6, 'n', L0, matKWallWarm);                    // along the south window
  k.box(-15.25, -13.5, L0, .75, 32.75, 34, matKWoodDark);               // corner table with the white orchid
  k.box(-14.75, -14.25, .75, 1.25, 33, 33.5, matKWhite);
  k.box(-14.75, -14.5, 1.25, 2, 33, 33.25, matKGreen);
  k.box(-15, -14.25, 2, 2.25, 32.75, 33.5, matKWhite);
  // glass coffee table on a black cone, a bunch of orange and purple flowers on it
  roundTable(k, -10.25, 27.25, 1.25, L0, matKGlassPale, .75, matKBlack);
  k.box(-10.75, -9.75, .75, 1.25, 26.75, 27.75, matKOrange);
  k.box(-10.5, -10, 1.25, 1.5, 27, 27.5, matKPurple);
  k.box(-11, -10.75, .75, 1, 27, 27.5, matKPink);
  pendant(k, -10.125, 27.375, CEIL0, 1.25, 1, matKLight);               // the giant drum lamp
  // two red slice chairs facing the sofas
  for (const z of [26.5, 28.75]) {
    lbox(k, -6.25, z, 'w', -.25, .25, -.25, .25, L0, .25, matKSteel);
    lbox(k, -6.25, z, 'w', -.75, .75, -.75, .5, .25, .75, matKRed);
    lbox(k, -6.25, z, 'w', -.75, .75, -.75, -.25, .75, 1.5, matKRed);
  }
  // console with a lamp along the east wall, floor lamps at the corners
  k.box(-5.25, E, L0, 1, 30.5, 33.75, matKWoodDark);
  k.box(-5, -4.5, 1, 1.75, 31, 31.5, matKWhite);
  k.box(-5.25, E, 1.75, 2.25, 30.75, 31.75, matKLight);
  for (const [x, z] of [[-14.375, 23.5], [-6.625, 33.625]]) {
    k.box(x - .125, x + .125, L0, 2.5, z - .125, z + .125, matKSteel);
    k.box(x - .375, x + .375, 2.25, 2.75, z - .375, z + .375, matKWhite);
  }
  // the abstract painting by the door, yellow, red and grey
  pixelPanel(k, E, 18.75, 'w', 1.25, .25, [
    'yyyrrlll',
    'yyrrrlwl',
    'yrrkllww',
    'oorkkwwl',
    'oyykrrll',
    'yyykrrrl',
    'lyyyorrl',
    'llyooyrr',
    'lllyyyrr',
    'kllllyyr',
  ], { y: matKYellow, r: matKRed, l: matKGreyLight, w: matKWhite, k: matKBlack, o: matKOrange });
  // dark taupe curtains in the corners and either side of the column
  curtain(k, W, W + .5, N + .75, N + 1.5, matKPot);
  curtain(k, W, W + .5, 24.5, 25, matKPot);
  curtain(k, W, W + .25, S - .75, S, matKPot);
  curtain(k, -5, E, S - .5, S, matKPot);

  cassette(k, -9, 22.75); led(k, -13, 24); led(k, -7, 24); led(k, -7, 31);
  for (const [x, z] of [[-13.5, 31], [-6, 20], [-14, 19.5]]) downlight(k, x, z);
}

/* ============================ the lot ============================ */
export function buildGroundWest(k: Kit): void {
  kantine(k);
  kantineBerging(k);
  kantoorW1(k);
  kantoorW2(k);
  kantoorSW(k);
  corridorN(k);
  entree(k);         // before the atrium, so the footprint trail is painted over the doormats
  atrium(k);
  techniek(k);
  kastruimte(k);
  ontvangstruimte(k);
}
