/* ============================ kantoor — upper floor, west ============================ */
// The furniture of the upper floor's west half: the row of offices behind the
// slanted facade (NW, W-1, W-2, W-3), the server room and the two store rooms,
// the two south-west offices, and the gallery round the stair void with the
// passage north from it and the lobby south-west of it.
//
// Every office up here is the same building block — dark striped carpet, white
// walls, a lay-in ceiling with square LED panels and one AC cassette, oak
// sit-stand desks pushed together in twos and fours behind black fabric screens
// — and each is told apart by one or two things the people who work there know
// it by: the red armchairs in W-1, the bird-of-paradise in W-2, the frosted
// windows between W-3 and the server room, the orange beanbag, the palm.
//
// The desk blocks are the cover. They are laid out so that every room keeps a
// lane of at least 2.5 m from its door, and the gallery walkways beside the void
// stay bare apart from what hangs on the walls.
//
// Wall faces used below (the shell snaps each wall onto the voxel lattice, so
// these are a little off the plan's room outlines): north facade inside face
// z = −34.25, south facade z = 34.25; I_W1 −24.5 | −24.0, I_W8 −14.75 | −14.25,
// I_W9 −5.25 | −4.75, I_W11 9.5 | 10.0, I_W13 16.0 | 16.5, I_W15a 21.5 (south
// side); I_W2 / I_W10 / I_W16 −4.25 | −3.75, I_W12 −9.25 | −8.75, I_W14 −15.75 |
// −15.5, I_W4 0.75 | 1.25, I_W6 5.5, the notch wall's lining −4.5, I_W7 −2.75 | −2.25.
import type * as THREE from 'three';
import { type Kit, type Pt, L1, CEIL1 } from './kit';
import { room, type Room } from './structure';
import { desk, table, cabinet, shelves, plant, pixelPanel, panel, lbox, type Dir } from './props';
import {
  matKWhite, matKBlack, matKGrey, matKGreyDark, matKGreyLight, matKSteel,
  matKRed, matKOrange, matKYellow, matKPurple, matKBlue, matKTeal, matKGreen,
  matKPot, matKLight, matKWallWarm, matKGlassPale, matKWoodDark, matKDeskTop,
} from '../../materials';

/* ============================ helpers ============================ */

/* round up onto the voxel lattice */
const up = (v: number) => Math.ceil(v / .25 - 1e-6) * .25;

/* Where the slanted west facade's inside face is at depth z: the leftmost edge
   of the room's outline on that line. */
function westAt(r: Room, z: number): number {
  let x = Infinity;
  const p = r.poly;
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
    if ((az <= z) === (bz <= z)) continue;
    x = Math.min(x, ax + (bx - ax) * (z - az) / (bz - az));
  }
  return x;
}

/* A sit-stand desk (props' desk, 4 m wide) with its monitors drawn here so they
   sit on the voxel lattice: two 1.25 m screens, or one wide one. */
function workstation(k: Kit, cx: number, cz: number, dir: Dir, o: { d?: number; screens?: 1 | 2; screen?: THREE.Material } = {}) {
  const d = o.d ?? 2, hd = d / 2, n = o.screens ?? 2;
  desk(k, cx, cz, dir, L1, { d, monitors: 0, screen: o.screen });
  const spans: [number, number, number, number][] = n === 1
    ? [[-.75, .75, -.25, .25]]
    : [[-1.5, -.25, -1, -.75], [.25, 1.5, .75, 1]];
  for (const [a, b, sa, sb] of spans) {
    lbox(k, cx, cz, dir, sa, sb, hd - .75, hd - .5, L1 + 1, L1 + 1.25, matKBlack);   // stand
    lbox(k, cx, cz, dir, a, b, hd - .75, hd - .5, L1 + 1.25, L1 + 2, matKBlack);      // screen
  }
}

/* A block of sit-stand desks pushed together: two rows facing each other across
   black fabric screens, `n` desks to a row. `along` is the axis the rows run on.
   `d` is the desk depth; 1.75 where a room is too tight for the full 2. */
function cluster(k: Kit, cx: number, cz: number, along: 'x' | 'z', n: number, d = 2) {
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) * 4;
    if (along === 'x') {
      workstation(k, cx + s, cz - d / 2, 's', { d, screen: matKBlack });
      workstation(k, cx + s, cz + d / 2, 'n', { d, screen: matKBlack });
    } else {
      workstation(k, cx - d / 2, cz + s, 'e', { d, screen: matKBlack });
      workstation(k, cx + d / 2, cz + s, 'w', { d, screen: matKBlack });
    }
  }
}

/* An upholstered armchair, 2 × 2 m: low back, arms at 1.0. */
function armchair(k: Kit, cx: number, cz: number, dir: Dir, mat: THREE.Material) {
  lbox(k, cx, cz, dir, -1, 1, -1, 1, L1, L1 + .5, mat);
  lbox(k, cx, cz, dir, -1, 1, -1, -.5, L1 + .5, L1 + 1.25, mat);
  lbox(k, cx, cz, dir, -1, -.75, -.5, 1, L1 + .5, L1 + 1, mat);
  lbox(k, cx, cz, dir, .75, 1, -.5, 1, L1 + .5, L1 + 1, mat);
}

/* ---- the ceiling: square LED panels, the AC cassette, round downlights ---- */
function led(k: Kit, cx: number, cz: number) {
  k.box(cx - .75, cx + .75, CEIL1 - .25, CEIL1, cz - .75, cz + .75, matKLight);
}
function cassette(k: Kit, cx: number, cz: number) {
  k.box(cx - 1, cx + 1, CEIL1 - .25, CEIL1, cz - 1, cz + 1, matKWhite);
  k.box(cx - .5, cx + .5, CEIL1 - .5, CEIL1 - .25, cz - .5, cz + .5, matKGreyLight);   // grille
}
function downlight(k: Kit, cx: number, cz: number) {
  k.cyl(cx, cz, .5, CEIL1 - .25, CEIL1, matKLight);
}

/* A rectangle of pixels with a one-cell frame round it, for pixelPanel: boards,
   frosted windows, frames. `marks` overwrite single cells ([row, col, char]). */
function framed(w: number, h: number, fill: string, frame = 'F', marks: [number, number, string][] = []): string[] {
  const rows: string[] = [];
  for (let r = 0; r < h; r++) {
    let s = '';
    for (let c = 0; c < w; c++) s += (r === 0 || r === h - 1 || c === 0 || c === w - 1) ? frame : fill;
    rows.push(s);
  }
  for (const [r, c, ch] of marks) rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1);
  return rows;
}

/* A brushed-aluminium wall washer with its warm fan of light up and down the
   wall. `y` is the height of the fitting. */
function washer(k: Kit, cx: number, cz: number, dir: Dir, y: number) {
  pixelPanel(k, cx, cz, dir, y - .5, .25, [
    'CCCCCC',
    '.CCCC.',
    '.LLLL.',
    '.CCCC.',
    'CCCCCC',
  ], { C: matKWallWarm, L: matKLight });
  lbox(k, cx, cz, dir, -.5, .5, .25, .5, y, y + .25, matKSteel);
}

/* The three frosted internal windows between W-3 and the server room: there is
   no hole in the wall behind them, so they are hung on both of its faces. */
const FROSTED = framed(22, 6, 'G', 'F', [1, 2, 3, 4].flatMap((r) => [[r, 7, 'F'], [r, 14, 'F']] as [number, number, string][]));
const FROSTED_X = -15.5, FROSTED_Y = L1 + 1.25;
const FROSTED_LEGEND = { F: matKWhite, G: matKGlassPale };

/* ============================ NW — the L-shaped corner office ============================ */
// Entered from the passage at the foot of the L. Three desk groups: four under
// the north windows, a pair by the west windows, and two single desks along the
// east wall of the L's leg. The grey steel exit to the outside fire-escape stair
// is at the east end of the north wall, with its green sign; a pop-art poster
// hangs just west of it. The route from the door to the exit runs up the east
// side and stays clear.
function nw(k: Kit) {
  const r = room('R_NW'), zN = -34.25;
  cluster(k, -2, -30, 'x', 2);                 // under WIN01/WIN02
  // the pair by the west windows, its west chair (3.25 out from the middle) half a metre off the slant
  cluster(k, up(westAt(r, -29.5) + 3.75), -29, 'z', 1);
  // the leg: two desks against the east wall, black ultrawide monitors
  workstation(k, 4.25, -19, 'e', { screens: 1 });
  workstation(k, 4.25, -23, 'e', { screens: 1 });
  plant(k, -14.125, -25.375, L1);       // plant() is lattice-true on .125 centres
  // exit sign over the escape door (ESC1)
  pixelPanel(k, 4, zN, 's', L1 + 3.25, .25, ['GGGG', 'GWGG'], { G: matKGreen, W: matKWhite });
  // "WE ARE ALL ONE": a green, teal and purple pop-art print in a black frame (no lettering)
  pixelPanel(k, -.75, zN, 's', L1 + 1.75, .25, [
    'KKKKKK',
    'KGTTGK',
    'KTPPBK',
    'KPWPTK',
    'KBPPGK',
    'KTGWTK',
    'KGTBGK',
    'KKKKKK',
  ], { K: matKBlack, G: matKGreen, T: matKTeal, P: matKPurple, B: matKBlue, W: matKWhite });
  // the little orange-and-red smiley flower beside it
  pixelPanel(k, 1.25, zN, 's', L1 + 2.25, .25, ['.RR.', 'RYYR', 'RYYR', '.RR.'], { R: matKRed, Y: matKOrange });
  // thermostat by the door
  panel(k, -3.75, -22, 'e', .5, L1 + 2, L1 + 2.5, matKWhite);
  for (const [x, z] of [[-9, -32], [-3, -32], [3, -32], [-9, -26.5], [-3, -26.5], [3, -26.5], [3.25, -19]]) led(k, x, z);
  cassette(k, -1, -29);
}

/* ============================ W-1 — the red armchairs ============================ */
// A narrow room with two single desks: one against the north wall under a big
// wall-hung screen, one free-standing facing the door behind a grey felt front
// screen. Two red armchairs sit by the windows in the north-west corner; a round
// clock hangs high on the north wall, and a small whiteboard above the chairs.
function w1(k: Kit) {
  const r = room('R_W1'), zN = -24;
  workstation(k, -9.5, -22.75, 'n', { screens: 1 });
  panel(k, -9.5, zN, 's', 3, L1 + 1.75, L1 + 3.25, matKBlack);                    // wall screen
  workstation(k, -10.5, -17.5, 'e', { screens: 1 });
  lbox(k, -10.5, -17.5, 'e', -2, 2, 1, 1.25, L1 + .5, L1 + 1.5, matKGreyLight);  // felt front screen
  // the armchairs follow the slant of the window wall
  for (const cz of [-22.75, -20.5]) armchair(k, up(westAt(r, cz - 1) + 1.5), cz, 'e', matKRed);
  pixelPanel(k, -13.25, zN, 's', L1 + 2, .25, framed(6, 4, 'W'), { F: matKSteel, W: matKWhite });
  pixelPanel(k, -6.25, zN, 's', L1 + 2.25, .25, [
    '.GGGG.',
    'GWWBWG',
    'GWWBWG',
    'GWBWWG',
    'GWWWWG',
    '.GGGG.',
  ], { G: matKGreyLight, W: matKWhite, B: matKBlack });
  cabinet(k, -16, -12.5, -15.5, -14.75, L1, 1, matKWhite);                         // low cupboard on the south wall
  for (const [x, z] of [[-13, -19.5], [-8, -22], [-8, -17]]) led(k, x, z);
  cassette(k, -10.5, -20);
}

/* ============================ W-2 — the bird-of-paradise ============================ */
// One block of four oak desks in front of the two windows, a big whiteboard
// with orange marker sketches on the north wall, and a tall bird-of-paradise in
// a black pot just inside the door.
function w2(k: Kit) {
  cluster(k, -13.25, -10.75, 'x', 2, 1.75);
  const sketch: [number, number, string][] = [
    [1, 3, 'O'], [1, 4, 'O'], [2, 2, 'O'], [2, 5, 'O'], [3, 3, 'O'], [3, 4, 'O'],
    [1, 11, 'O'], [2, 11, 'O'], [2, 12, 'O'], [2, 13, 'O'], [2, 14, 'O'], [2, 15, 'O'],
    [3, 11, 'O'], [3, 15, 'O'], [4, 11, 'O'], [4, 12, 'O'], [4, 13, 'O'], [4, 14, 'O'], [4, 15, 'O'],
    [3, 7, 'O'], [3, 8, 'O'],
  ];
  pixelPanel(k, -11.25, -14.25, 's', L1 + 1.75, .25, framed(18, 7, 'W', 'F', sketch),
    { F: matKSteel, W: matKWhite, O: matKOrange });
  plant(k, -6.125, -6.625, L1, 3, matKBlack);
  for (const [x, z] of [[-16, -9.75], [-9.5, -9.75]]) led(k, x, z);
  cassette(k, -12.75, -9.75);
}

/* ============================ W-3 — "h. 2.60", the big one ============================ */
// Three desk groups round an open middle: four along the server-room wall, a
// pair by the windows, a pair mid-room. The north wall carries a long
// whiteboard with magnets, the south wall the three frosted windows into the
// server room, and a potted fig stands on one of the window sills.
function w3(k: Kit) {
  const r = room('R_W3');
  cluster(k, -17.5, 6.5, 'x', 2, 1.75);        // along the south wall
  cluster(k, up(westAt(r, -1.25) + 3.5), -.75, 'z', 1, 1.75);   // by WIN36/WIN37
  cluster(k, -10.5, -1.25, 'x', 1, 1.75);      // mid-room
  k.box(-13.25, -12.75, L1, L1 + .75, 7.5, 8, matKBlack);    // bins
  k.box(-17, -16.5, L1, L1 + .75, -3.25, -2.75, matKBlack);
  pixelPanel(k, -15, -4.75, 's', L1 + 1.5, .25,
    framed(20, 7, 'W', 'F', [[1, 2, 'R'], [1, 17, 'B'], [3, 2, 'B'], [3, 17, 'G'], [5, 13, 'R'], [5, 14, 'B'], [5, 15, 'K']]),
    { F: matKSteel, W: matKWhite, R: matKRed, B: matKBlue, G: matKGreen, K: matKBlack });
  pixelPanel(k, FROSTED_X, 9.5, 'n', FROSTED_Y, .25, FROSTED, FROSTED_LEGEND);
  // the fig on the sill of WIN36, standing in the window opening
  const sx = -24.75, sy = L1 + 1;
  k.box(sx, sx + .5, sy, sy + .5, 1.5, 2, matKPot);
  k.box(sx, sx + .25, sy + .5, sy + 1, 1.5, 1.75, matKWoodDark);
  k.box(sx - .25, sx + .5, sy + 1, sy + 1.75, 1.25, 2.25, matKGreen);
  for (const [x, z] of [[-20, -2.5], [-14, -2.5], [-8, -2.5], [-21, 5.5], [-14, 5.5], [-8, 5.5]]) led(k, x, z);
  cassette(k, -12.5, 2.25);
}

/* ============================ server room ============================ */
// Light-grey raised floor instead of carpet. Two graphite HP racks with
// perforated black doors and blue LEDs stand against the south wall — the
// only things up here meant to block a sight line — with a small open rack of
// orange and blue patch cables on a cupboard beyond them and a little desk
// under the window at the far end. A grey steel double-door cupboard and a bin
// by the door, a split AC unit high on the north wall, the frosted windows.
function server(k: Kit) {
  const r = room('R_server');
  k.poly([[westAt(r, 10), 10], [-9.25, 10], [-9.25, 16], [westAt(r, 16), 16]] as Pt[], L1 - .25, L1, matKGreyLight);
  // the racks: 2.5 deep, fronts facing east into the room
  const rack = (cz: number, rows: string[]) => {
    k.box(-21, -18.5, L1, L1 + 3, cz - .75, cz + .75, matKGreyDark);
    pixelPanel(k, -18.5, cz, 'e', L1, .25, rows, { G: matKGreyDark, K: matKBlack, B: matKBlue, S: matKSteel });
  };
  rack(15.25, ['GGGGGG', 'GKKKKG', 'GKBKKG', 'GKKKKG', 'GKKKBG', 'GKKKKG', 'GKSSKG', 'GKKKKG', 'GKBKKG', 'GKKKKG', 'GSSSSG', 'GGGGGG']);
  rack(13.75, ['GGGGGG', 'GKKKKG', 'GKKBKG', 'GKKKKG', 'GSSSSG', 'GKKKKG', 'GKBKKG', 'GKKKKG', 'GSSSSG', 'GKKBKG', 'GSSSSG', 'GGGGGG']);
  // open patch rack on a low cupboard
  cabinet(k, -24.5, -23, 14.75, 16, L1, 1, matKGreyLight, null);
  k.box(-24.5, -23, L1 + 1, L1 + 2, 15.25, 16, matKBlack);
  pixelPanel(k, -23.75, 15.25, 'n', L1 + 1, .25, ['KKKKKK', 'KOBOOK', 'KOOBOK', 'KKKKKK'],
    { K: matKBlack, O: matKOrange, B: matKBlue });
  // the desk at the window end, with a laptop
  table(k, -26.25, -24.25, 10.25, 12.25, L1, matKWhite);
  k.box(-25.75, -25, L1 + 1, L1 + 1.25, 11, 11.5, matKBlack);
  lbox(k, -24.5, 10, 's', -1.25, 1.25, 0, .5, L1 + 3, L1 + 3.75, matKWhite);     // split AC
  cabinet(k, -12.5, -10, 10, 11, L1, 1.5, matKGreyLight, null);                   // steel cupboard
  k.box(-11.5, -11, L1 + .75, L1 + 1, 11, 11.25, matKSteel);                      // its handles
  k.box(-9.75, -9.25, L1, L1 + .75, 10, 10.5, matKBlack);                         // bin
  pixelPanel(k, FROSTED_X, 10, 's', FROSTED_Y, .25, FROSTED, FROSTED_LEGEND);
  led(k, -15.5, 13);
  for (const [x, z] of [[-12.5, 12.5], [-20, 12]]) k.cyl(x, z, .5, CEIL1 - .25, CEIL1, matKGreyLight);   // swirl diffusers
}

/* ============================ store by the server room ============================ */
// A windowless store: white shelving on two walls, archive boxes on the third.
function bergS(k: Kit) {
  shelves(k, -6.5, 10.5, 4, 's', L1, 2.5);
  shelves(k, -8.25, 12.75, 2.5, 'e', L1, 2.5);
  k.box(-5.25, -4.25, L1, L1 + 1, 11.25, 12.5, matKDeskTop);
  k.box(-5.25, -4.5, L1 + 1, L1 + 1.75, 11.5, 12.25, matKDeskTop);
  k.box(-5.5, -4.25, L1, L1 + .75, 12.75, 13.75, matKPot);
  led(k, -6.5, 13);
}

/* ============================ SW — the corner office with the palm ============================ */
// The biggest of the west offices, narrowing to the north with the slant. Four
// desks along the three south windows (a model sailing ship on one sill), a
// pair along the west windows and a pair mid-room; the palm in its black pot
// stands just inside the door from the lobby. A tall white cupboard on the
// north wall.
function sw(k: Kit) {
  const r = room('R_SW');
  cluster(k, -25, 30.75, 'x', 2);                               // along the three south windows
  cluster(k, up(westAt(r, 20) + 3.75), 20.5, 'z', 1);           // along WIN32/WIN33
  cluster(k, -21.25, 23.5, 'z', 1, 1.75);                      // mid-room
  plant(k, -19.125, 17.625, L1, 2.75, matKBlack);
  cabinet(k, -23, -21, 16.5, 17.25, L1, 2.25, matKWhite);
  // the sailing ship on the sill of WIN28
  k.box(-23.75, -22.75, L1 + 1, L1 + 1.25, 34.5, 34.75, matKWoodDark);
  k.box(-23.5, -23, L1 + 1.25, L1 + 2, 34.5, 34.75, matKWhite);
  for (const x of [-27, -21]) for (const z of [20, 25.5, 31]) led(k, x, z);
  cassette(k, -24, 22.75);
  cassette(k, -24, 28.25);
}

/* ============================ S-W — the orange beanbag ============================ */
// A desk pair end-on to the two south windows, a wire memo grid of photos
// beside them, a ZZ plant by the glazed door to the corner office and the
// bright orange beanbag in the north-west corner.
function swi(k: Kit) {
  cluster(k, -11, 32, 'z', 1);
  plant(k, -14.625, 25.625, L1, 1.75, matKBlack);
  // the beanbag, slumped into the corner
  k.box(-15.25, -13.75, L1, L1 + .5, 21.75, 23.25, matKOrange);
  k.box(-15.25, -13.75, L1 + .5, L1 + 1.25, 21.75, 22.25, matKOrange);
  k.box(-15.25, -14.75, L1 + .5, L1 + 1, 22.25, 23, matKOrange);
  pixelPanel(k, -6.25, 34.25, 'n', L1 + 1.5, .25, [
    'KKKKKKKK',
    'KOK.KBWK',
    'KKKKKKKK',
    'KWYK.KRK',
    'KKKKKKKK',
  ], { K: matKBlack, O: matKOrange, B: matKBlue, W: matKWhite, Y: matKYellow, R: matKRed });
  cabinet(k, -5.25, -4.5, 24, 28, L1, 1, matKWhite);
  for (const [x, z] of [[-12.5, 25], [-7.5, 25], [-10, 30.5]]) led(k, x, z);
  cassette(k, -10, 27.5);
}

/* ============================ the store strip north of the stair ============================ */
// Closed store behind the sign wall: shelving down both long walls, a stack of
// spare chairs at the far end, boxes by the door.
function bergN(k: Kit) {
  shelves(k, 5, -14.25, 4, 'w', L1, 2.75);
  shelves(k, 5, -10, 4, 'w', L1, 2.75);
  shelves(k, 1.75, -14.25, 4, 'e', L1, 2.5);
  for (let i = 0; i < 6; i++) k.box(2.75, 4, L1 + i * .25, L1 + i * .25 + .25, -16.25, -15.25, i % 2 ? matKGreyDark : matKBlack);
  k.box(4.25, 5.5, L1, L1 + 1, -7.5, -6.25, matKDeskTop);
  k.box(4.5, 5.5, L1 + 1, L1 + 1.75, -7.25, -6.5, matKDeskTop);
  k.box(4.5, 5.5, L1, L1 + .75, -6, -5, matKGrey);
  led(k, 3.25, -12);
  led(k, 3.25, -6.5);
}

/* ============================ the gallery, the passage, the south-west lobby ============================ */
// The stair comes up out of the entrance hall into a tall white hall under the
// roof lantern. Facing you at the top, on the end wall of the store strip, is
// the tenant's dark square sign board — a logo mark and a pale band where the
// name was. The west wall carries the red hose reel and extinguisher near the
// stair head and the warm wall washers. Everything here is on the walls: the
// walkways beside the void stay clear. North of the hall the passage to the NW
// office and the south-west lobby have round downlights in their low ceilings.
function gallery(k: Kit) {
  pixelPanel(k, 3, -2.25, 's', L1 + 1.75, .25, [
    'KKKKKKKKKKKK',
    'KKKKKPTKKKKK',
    'KKKKPPTTKKKK',
    'KKKKTTPPKKKK',
    'KKKKKTPKKKKK',
    'KKKKKKKKKKKK',
    'KLLLLLLLLLLK',
    'KKKKKKKKKKKK',
  ], { K: matKGreyDark, P: matKPurple, T: matKTeal, L: matKGreyLight });
  // west wall: hose reel and extinguisher near the north end
  const xW = -3.75;
  pixelPanel(k, xW, -.5, 'e', L1 + 1.25, .25, [
    '.RRRR.',
    'RRGGRR',
    'RGWWGR',
    'RGWWGR',
    'RRGGRR',
    '.RRRR.',
  ], { R: matKRed, G: matKGreyDark, W: matKWhite });
  lbox(k, xW, .75, 'e', -.25, .25, 0, .5, L1 + .75, L1 + 1.75, matKRed);
  lbox(k, xW, .75, 'e', -.25, 0, 0, .25, L1 + 1.75, L1 + 2, matKBlack);
  for (const z of [2, 9.5, 14, 24]) washer(k, xW, z, 'e', L1 + 3);
  // the passage north to the NW office, and the south-west lobby
  for (const z of [-17.5, -12.5, -7.5]) downlight(k, -1.5, z);
  for (const x of [-13, -9.5, -6]) downlight(k, x, 18.75);
}

export function buildUpperWest(k: Kit): void {
  nw(k);
  w1(k);
  w2(k);
  w3(k);
  server(k);
  bergS(k);
  sw(k);
  swi(k);
  bergN(k);
  gallery(k);
}
