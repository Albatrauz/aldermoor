/* ============================ kantoor — upper floor, east ============================ */
// Dressing for the east half of the upper floor: the big open office in the
// north-east, the glass meeting box and the east office below it, the corner
// office with the flower mural, the small office east of the entrance notch,
// the pantry and its lobby, the two toilet groups in the core, and the
// corridors between them (the circulation east of x = 7).
//
// Where things stand comes from the floor plan, what they look like from the
// estate agent's photos. The wall faces used below are where the shell really
// puts them on the 0.25 m lattice, which is not always a room's bbox edge:
//   NE office S wall z −12.75, lobby N wall z −12.25, meeting box glass
//   z −12.5 / −4.0, east office N glass z −3.75, its S wall z 15.5, corner
//   office N wall z 16.0, glass W walls of the east rooms x 21.5…21.75, core
//   W wall x 10.25, core E wall x 17.25, kitchen back wall z −2.0, toilet gap
//   z 5.0…9.75, outside walls x 34.25 / z −34.25 / z 34.25.
import * as THREE from 'three';
import { type Kit, L1, CEIL1, snap } from './kit';
import { room } from './structure';
import {
  desk, chair, chairsAround, table, roundTable, stool, cabinet, kitchenRun,
  toilet, basin, plant, pixelPanel, panel, lbox,
} from './props';
import {
  matKWhite, matKBlack, matKGrey, matKGreyDark, matKGreyLight, matKSteel,
  matKDeskTop, matKLight, matKRed, matKOrange, matKYellow, matKPink, matKBlue,
  matKTeal, matKGreen, matKPot, matKFrame, matKWallWarm, matKShedDark, matKWall,
  matKGlassPale,
} from '../../materials';

type Legend = Record<string, THREE.Material>;

/* ============================ small fittings ============================ */
// Everything on the ceiling is one voxel deep and touches the tiles above it.
const CY = CEIL1 - .25;
/* a square 600×600 LED panel, as in every office */
const led = (k: Kit, cx: number, cz: number) => k.box(cx - .75, cx + .75, CY, CEIL1, cz - .75, cz + .75, matKLight);
/* a round recessed downlight (pantry, corridors, toilets) */
const downlight = (k: Kit, cx: number, cz: number) => k.box(cx - .25, cx + .25, CY, CEIL1, cz - .25, cz + .25, matKLight);
/* a four-way air-conditioning cassette: white with a grey grille */
function cassette(k: Kit, cx: number, cz: number) {
  k.box(cx - 1, cx + 1, CY, CEIL1, cz - 1, cz + 1, matKWhite);
  k.box(cx - .5, cx + .5, CY, CEIL1, cz - .5, cz + .5, matKGreyLight);
}
/* green running-man sign over an exit door */
const exitSign = (k: Kit, cx: number, cz: number, dir: 'n' | 's' | 'e' | 'w') =>
  pixelPanel(k, cx, cz, dir, L1 + 3.25, .25, ['GwGG', 'GGwG'], { G: matKGreen, w: matKWhite });

/* Stripe film on a glass partition: short white slats standing on the frame
   at the top of the glass band, every other voxel, and below eye level so the
   partition stays see-over. `along` is the axis the partition runs on, `at`
   its lower face; `skip` keeps them off the shell's posts and doorways. */
function frost(k: Kit, along: 'x' | 'z', at: number, from: number, to: number, skip: [number, number][]) {
  for (let s = from; s + .25 <= to + 1e-6; s += .5) {
    if (skip.some(([a, b]) => s + .25 > a && s < b)) continue;
    if (along === 'x') k.box(s, s + .25, L1 + 1, L1 + 1.5, at, at + .25, matKWhite);
    else k.box(at, at + .25, L1 + 1, L1 + 1.5, s, s + .25, matKWhite);
  }
}

/* ============================ pictures ============================ */
// One character per 0.25 m cell, top row first (see pixelPanel).
const GREYS: Legend = { w: matKWhite, l: matKGreyLight, g: matKGrey, d: matKGreyDark, k: matKBlack };

// The two black-and-white Antwerp photos in the pantry lobby: the cathedral
// spire over the square, and the stepped gables of the guild houses.
const ANTWERP_TOWER = [
  'llllkgll',
  'llldkgll',
  'llldkgll',
  'lllddkgl',
  'lldkdkgl',
  'ldddkddg',
  'ddkdkdkd',
  'dkddddkd',
  'ggdgggdg',
  'gggggggg',
];
const ANTWERP_GABLES = [
  'llllllll',
  'lldllkll',
  'ldddlkkl',
  'ddwdkkwk',
  'dddddkkk',
  'dwdwdkwk',
  'dddddkkk',
  'dwdwdkwk',
  'gggggggg',
  'gdgggdgg',
];
// framed black-and-white photos along the corridor
const FRAME_A = ['kkkkkk', 'kllllk', 'klgglk', 'kggggk', 'kgddgk', 'kddddk', 'kdwddk', 'kkkkkk'];
const FRAME_B = ['kkkkkk', 'kddddk', 'kdlldk', 'kllllk', 'klgglk', 'kggggk', 'kggddk', 'kkkkkk'];

/* The corner office mural: a whole wall of coral-red lilies with cream
   stamens on a near-black ground, a stem running up from lower left to upper
   right and grey-green leaves round them. 50 × 16 cells = 12.5 m × 4 m, floor
   to ceiling. Built by stamping a few small sprites onto a dark field. */
const MURAL_LEGEND: Legend = {
  '#': matKFrame, R: matKRed, P: matKPink, c: matKWallWarm, L: matKShedDark, G: matKGreen, s: matKPot,
};
function mural(): string[] {
  const W = 50, H = 16;
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('#'));
  const stamp = (c0: number, r0: number, art: string[]) => art.forEach((row, r) => [...row].forEach((ch, c) => {
    const rr = r0 + r, cc = c0 + c;
    if (ch !== '.' && rr >= 0 && rr < H && cc >= 0 && cc < W) g[rr][cc] = ch;
  }));
  const LEAF_UP = ['....LL', '..LLLL', 'LLLL..'];
  const LEAF_DOWN = ['LLL...', '.LLLL.', '...LLL'];
  const LEAF_BIG = ['.....GG', '...LLLG', '.LLLLL.', 'LLLG...'];
  const LILY = ['..R.R..', 'RRPRPRR', '.PPcPP.', 'RRcccRR', '.PPcPP.', 'RRPRPRR', '..R.R..'];
  const BUD = ['.RR', 'RRP', 'Rs.'];
  // leaves first, then the stem across them, then the flowers on top
  stamp(0, 1, LEAF_BIG); stamp(10, 0, LEAF_DOWN); stamp(4, 10, LEAF_UP); stamp(9, 12, LEAF_BIG);
  stamp(33, 3, LEAF_DOWN); stamp(36, 10, LEAF_BIG); stamp(43, 5, LEAF_UP); stamp(44, 12, LEAF_DOWN);
  stamp(30, 13, LEAF_UP); stamp(21, 0, LEAF_UP);
  for (let c = 0; c < W; c++) g[Math.round(13 - c * 10 / (W - 1))][c] = 's';
  stamp(17, 2, LILY); stamp(25, 0, LILY); stamp(14, 9, LILY); stamp(23, 8, LILY);
  stamp(7, 4, BUD); stamp(38, 2, BUD);
  return g.map((row) => row.join(''));
}

/* ============================ NE: the big open office ============================ */
/* A desk island: two rows of `n` white sit-stand desks facing each other
   across a line of orange-red fabric screens, long axis north–south, chairs
   pushed in, and a low run of black and white rolling pedestals across each
   end — waist-high cover. (cx, z0) is the island's centre line and north end. */
function island(k: Kit, cx: number, z0: number, n: number) {
  for (let i = 0; i < n; i++) {
    const zc = z0 + 2 + 4 * i;
    desk(k, cx - 1, zc, 'e', L1, { top: matKWhite, screen: matKRed, chair: false, monitors: i === 1 ? 1 : 2 });
    desk(k, cx + 1, zc, 'w', L1, { top: matKWhite, screen: matKRed, chair: false, monitors: i === 2 ? 1 : 2 });
    chair(k, cx - 2.25, zc, 'e', L1);
    chair(k, cx + 2.25, zc, 'w', L1);
  }
  const z1 = z0 + 4 * n;
  for (let j = 0; j < 4; j++) {
    k.box(cx - 2 + j, cx - 1 + j, L1, L1 + .75, z0 - .75, z0, j % 2 ? matKBlack : matKWhite);
    k.box(cx - 2 + j, cx - 1 + j, L1, L1 + .75, z1, z1 + .75, j % 2 ? matKWhite : matKBlack);
  }
}

function northEastOffice(k: Kit) {
  const r = room('R_NE');
  const x0 = snap(r.x0), x1 = snap(r.x1), z0 = snap(r.z0), z1 = snap(r.z1);   // 6, 34.25, −34.25, −12.75
  // three desk islands, aisles of 2.5 m between them and the walls; the
  // fire-escape door (W end of the N wall) and both S doors stay clear
  island(k, 11.25, -30.75, 3);
  island(k, 19.25, -30.75, 3);
  island(k, 27.25, -30.75, 3);
  // one single desk by the south-east windows
  desk(k, x1 - 1, -15.25, 'e', L1, { top: matKWhite });

  // W wall: two tall black cabinets with bottles on top, and a red-orange abstract
  cabinet(k, x0, x0 + 1, -18, -15.5, L1, 2.5, matKBlack, null);
  cabinet(k, x0, x0 + 1, -15.25, z1, L1, 2.5, matKBlack, null);
  for (const [z, m] of [[-17.5, matKGreen], [-16.75, matKPot], [-16.25, matKGreen], [-14.5, matKPot], [-13.75, matKGreen]] as const)
    k.box(x0 + .25, x0 + .5, L1 + 2.5, L1 + 3, z, z + .25, m);
  pixelPanel(k, x0, -24, 'e', L1 + 1.75, .25, [
    'OOORRROO',
    'ORRRYROO',
    'RRYYYRRO',
    'ORRYRRkO',
    'OORRRkkO',
    'OOOOkkOO',
  ], { O: matKOrange, R: matKRed, Y: matKYellow, k: matKBlack });

  // N wall: a teal-framed poster between the two window pairs
  pixelPanel(k, 22, z0, 's', L1 + 1.25, .25, [
    'TTTTTTTT',
    'TGGGGGGT',
    'TGwwwwGT',
    'TGGGGGGT',
    'TGGkkGGT',
    'TGkGGkGT',
    'TGGkkGGT',
    'TGGGGGGT',
    'TTTTTTTT',
  ], { T: matKTeal, G: matKGreen, w: matKWhite, k: matKGreyDark });
  // E wall by the north-east corner: a yellowed technical drawing
  pixelPanel(k, x1, -32.75, 'w', L1 + 1.25, .25, [
    'YYYYYYYY',
    'YkkYYYYY',
    'YkYYkkkY',
    'YYYkYYkY',
    'YkkkkYkY',
    'YkYYkkkY',
    'YkYYYYYY',
    'YkkkkkYY',
    'YYYYYkYY',
    'YYYYYYYY',
  ], { Y: matKYellow, k: matKGreyDark });
  // the grey emergency door to the outside fire escape: a green sign over it
  exitSign(k, 7.25, z0, 's');
  plant(k, x1 - 1, -23.5, L1);

  for (const x of [10, 17, 24, 31]) for (const z of [-30, -23, -16]) led(k, x, z);
  cassette(k, 13.5, -26.5);
  cassette(k, 27.5, -19.5);
}

/* ============================ E-1: the glass meeting box ============================ */
// Black-framed glass to the NE office and to the east office, a glass door in
// the middle of each; an oak table on white slab legs with eight teal
// cantilever chairs, and the TV on the one solid (corridor) wall.
function meetingRoom(k: Kit) {
  const r = room('R_E2');
  const x1 = snap(r.x1);                         // 34.25; W wall face 22.0, glass at −12.5 and −4.0
  table(k, 25.5, 31.5, -9.25, -7.25, L1, matKDeskTop, 1, matKWhite);
  for (const x of [26.25, 27.75, 29.25, 30.75]) {
    chair(k, x, -10, 's', L1, matKTeal);
    chair(k, x, -6.5, 'n', L1, matKTeal);
  }
  panel(k, 22, -9.75, 'e', 3, L1 + 1.75, L1 + 3.25, matKBlack);        // 55" screen
  panel(k, 22, -9.75, 'e', 1.5, L1 + 1.5, L1 + 1.75, matKGreyDark);    // video bar under it
  plant(k, x1 - 1, -11.25, L1);
  // stripe film on both glass walls (shell posts at x ≈ 24.8 / 31.1 and 25.3 / 31.3)
  frost(k, 'x', -12.75, 22.25, 34, [[24.5, 25], [26.25, 29.5], [30.75, 31.25]]);
  frost(k, 'x', -4, 23, 34, [[25, 25.5], [26.25, 29.75], [31, 31.5]]);
  led(k, 28.5, -8.25);
  downlight(k, 24.5, -8.25);
  downlight(k, 32.5, -8.25);
}

/* ============================ E-2: the east office ============================ */
// White-top sit-stand desks: two pairs under the east windows, two singles
// along the glass wall to the corridor (one with the boss's high-backed
// chair), the middle left open with rolling pedestals and storage boxes as
// low cover. Agave and cactus paintings.
function eastOffice(k: Kit) {
  const r = room('R_E');
  const x1 = snap(r.x1);                         // 34.25; N glass −3.75, S wall 15.5, W glass 21.75
  for (const z of [-1, 3, 8, 12]) desk(k, x1 - 1, z, 'e', L1, { top: matKWhite });
  desk(k, 22.75, 5.75, 'w', L1, { w: 3.5, top: matKWhite });
  desk(k, 22.75, 9.25, 'w', L1, { w: 3.5, top: matKWhite, monitors: 1 });
  k.box(24.75, 25, L1 + 1.25, L1 + 1.75, 8.75, 9.75, matKBlack);      // headrest of the executive chair
  // pedestals and boxes, staggered so the lane past them stays wide
  k.box(25.5, 27, L1, L1 + .75, 2.5, 3.5, matKBlack);
  k.box(25.5, 27, L1, L1 + .5, 3.5, 4.25, matKWhite);
  k.box(29, 30.5, L1, L1 + .75, 9, 10, matKBlack);
  k.box(29, 30.5, L1, L1 + .5, 10, 10.75, matKWhite);
  plant(k, x1 - 1, 14.75, L1);
  // cactus on blue (S wall), agave in a blue pot on orange (E wall, between the window pairs)
  pixelPanel(k, 28, 15.5, 'n', L1 + 1.5, .25, [
    'BBBBBB',
    'BBGBBB',
    'GBGBGB',
    'GGGBGB',
    'BBGGGB',
    'BBGBBB',
    'BOOOOB',
    'BBOOBB',
  ], { B: matKBlue, G: matKGreen, O: matKOrange });
  pixelPanel(k, x1, 5.5, 'w', L1 + 1.75, .25, [
    'OOOOOO',
    'GOOGOO',
    'OGOGOG',
    'OGGGGO',
    'GGGGGG',
    'OOGGOO',
    'OBBBBO',
    'OOBBOO',
  ], { O: matKOrange, G: matKGreen, B: matKBlue });
  // the stripe-film office you see from the toilet gap: film on the W glass
  frost(k, 'z', 21.5, 4, 11.25, [[6.375, 7.125], [9.375, 10.125]]);
  for (const x of [26, 30]) for (const z of [1, 9]) led(k, x, z);
  cassette(k, 28, -1.5);
  cassette(k, 28, 12.75);
  k.box(27.75, 28.25, CEIL1 - .5, CEIL1, 5, 5.5, matKWhite);           // projector box
}

/* ============================ SE: the corner office with the mural ============================ */
// Nearly empty: the flower mural over the whole north wall, a wood-topped
// white workbench by the east windows with a foot exerciser under it, and a
// coat stand by the door. Left open on purpose — it is the arena.
function southEastCorner(k: Kit) {
  const r = room('R_SE');
  const x1 = snap(r.x1), z0 = snap(r.z0);        // 34.25, 16.0
  pixelPanel(k, 28, z0, 's', L1, .25, mural(), MURAL_LEGEND);
  desk(k, x1 - 1, 24, 'e', L1, { top: matKDeskTop, monitors: 0 });
  k.box(30.5, 31.25, L1, L1 + .25, 25.75, 26.25, matKBlack);           // foot exerciser
  // coat stand in the corner by the corridor door, a coat on it
  k.box(22, 22.75, L1, L1 + .25, 16.25, 17, matKBlack);
  k.box(22.25, 22.5, L1 + .25, L1 + 2.25, 16.5, 16.75, matKBlack);
  k.box(22, 22.75, L1 + 2.25, L1 + 2.5, 16.25, 17, matKBlack);
  k.box(22.5, 22.75, L1 + 1, L1 + 2.25, 16.5, 17, matKGreyDark);
  plant(k, x1 - 1, 33.25, L1);
  // film on the glass wall to the S-E office (posts at z ≈ 22.25 / 25.3 / 31.5, door 26.75–29.25)
  frost(k, 'z', 21.5, 21.75, 34, [[21.875, 22.625], [24.875, 25.625], [26.5, 29.75], [31.125, 31.875]]);
  for (const x of [25, 31]) for (const z of [21, 29]) led(k, x, z);
  cassette(k, 28, 25);
}

/* ============================ S-E: the office east of the entrance notch ============================ */
// Two oak desks side by side under the windows with a grey modesty panel, a
// white meeting table with four orange chairs in front of them, the TV on the
// solid west wall and an orange print beside the windows.
function southOfficeEast(k: Kit) {
  const r = room('R_SEi');
  const x0 = snap(r.x0), z1 = snap(r.z1);        // 10.25, 34.25
  for (const x of [14.75, 18.75]) {
    desk(k, x, z1 - 1, 's', L1, { top: matKDeskTop });
    lbox(k, x, z1 - 1, 's', -2, 2, .75, 1, L1 + .25, L1 + .75, matKGrey);
  }
  table(k, 13.5, 18.5, 26, 29, L1, matKWhite, 1, matKBlack);
  chairsAround(k, 13.5, 18.5, 26, 29, L1, matKOrange, 2.5);
  panel(k, x0, 27.5, 'e', 3, L1 + 1.75, L1 + 3.25, matKBlack);
  pixelPanel(k, 12, z1, 'n', L1 + 1.5, .25, [
    'OOOOOO',
    'OOYYOO',
    'OYYYOO',
    'OOOROO',
    'ORRRRO',
    'OOOOOO',
    'OwOOOO',
    'OOOOOO',
  ], { O: matKOrange, Y: matKYellow, R: matKRed, w: matKWhite });
  plant(k, x0 + 1, 23, L1);
  led(k, 13, 30.5);
  led(k, 19, 30.5);
  cassette(k, 16, 25);
}

/* ============================ pantry ============================ */
// The open kitchen on the north face of the core: white handleless units, a
// pale worktop with a steel sink and tall tap, white wall cupboards, and the
// oven column at the west end with a built-in black combi oven.
function pantry(k: Kit) {
  const r = room('R_pantry');
  const x0 = snap(r.x0), zb = snap(r.z1);        // 10.25, −2.0 (the back wall)
  kitchenRun(k, 14, zb - .75, 4.5, 'n', L1, matKWhite, matKGreyLight);
  cabinet(k, x0, x0 + 1.5, zb - 1.5, zb, L1, 3, matKWhite);
  k.box(x0 + .25, x0 + 1.25, L1 + 1.5, L1 + 2.25, zb - 1.75, zb - 1.5, matKBlack);   // combi oven
  k.box(13, 14, L1 + .75, L1 + 1, zb - 1.25, zb - .5, matKSteel);                    // sink
  k.box(13.5, 13.75, L1 + 1, L1 + 1.75, zb - .5, zb - .25, matKSteel);               // tap…
  k.box(13.5, 13.75, L1 + 1.5, L1 + 1.75, zb - .75, zb - .5, matKSteel);             // …and its spout
  k.box(15.25, 15.75, L1 + 1, L1 + 1.5, zb - .75, zb - .25, matKBlack);              // kettle
  k.box(16, 16.25, L1 + .25, L1 + .75, zb - 1.5, zb - 1.25, matKGreen);              // tea towel on the end door
  downlight(k, 12.5, -4.25);
  downlight(k, 15.5, -4.25);
}

/* ============================ the lobby in front of the pantry ============================ */
// Its north wall (the NE office's south wall, face z −12.25) carries, west to
// east: the printer with the green AED box over it, the white coffee cabinet,
// a pedal bin, the two Antwerp photos with a high table and three bar stools
// in front, a thermostat, and the door into the NE office with an exit sign.
// (The photos show the printer, AED and coffee cabinet at the west end of the
// lobby; the wall beyond x = 7 belongs to the gallery, so they stand here.)
function pantryLobby(k: Kit) {
  const zN = -12.25;
  // printer (MFP), and the AED cabinet on the wall above it
  k.box(7.25, 8.75, L1, L1 + 1, zN, zN + 1.5, matKGreyLight);
  k.box(7.25, 8.75, L1 + 1, L1 + 1.25, zN, zN + 1.25, matKWhite);
  k.box(8, 8.5, L1 + 1.25, L1 + 1.5, zN + 1, zN + 1.25, matKBlack);
  k.box(7.5, 8.5, L1 + 1.75, L1 + 2.75, zN, zN + .5, matKGreen);
  k.box(7.75, 8.25, L1 + 2, L1 + 2.5, zN + .5, zN + .75, matKWhite);
  // coffee cabinet: closed below, two open bays above (water dispenser, bean-to-cup machine)
  cabinet(k, 9.25, 11.75, zN, zN + 1.25, L1, .75, matKWhite);
  k.box(9.25, 11.75, L1 + .75, L1 + 1, zN, zN + 1.25, matKGreyLight);
  k.box(9.25, 11.75, L1 + 1, L1 + 2.75, zN, zN + .25, matKWhite);
  for (const x of [9.25, 10.375, 11.5]) k.box(snap(x), snap(x) + .25, L1 + 1, L1 + 2.75, zN, zN + 1.25, matKWhite);
  k.box(9.25, 11.75, L1 + 2.75, L1 + 3, zN, zN + 1.25, matKWhite);
  k.box(9.75, 10.25, L1 + 1, L1 + 1.75, zN + .25, zN + .75, matKGreyDark);
  k.box(10.75, 11.5, L1 + 1, L1 + 2, zN + .25, zN + 1, matKBlack);
  k.box(12, 12.5, L1, L1 + .75, zN, zN + .5, matKSteel);                             // pedal bin
  // the Antwerp photos, the high table and stools
  pixelPanel(k, 13.75, zN, 's', L1 + 1.25, .25, ANTWERP_TOWER, GREYS);
  pixelPanel(k, 16, zN, 's', L1 + 1.25, .25, ANTWERP_GABLES, GREYS);
  roundTable(k, 15, -10.25, .75, L1, matKWhite, 1.25, matKBlack);
  stool(k, 13.75, -10.25, L1);
  stool(k, 16.25, -10.25, L1);
  stool(k, 15, -9, L1);
  k.box(17.75, 18, L1 + 1.75, L1 + 2, zN, zN + .25, matKWhite);                      // thermostat
  exitSign(k, 20, zN, 's');                                                           // over the door to the NE office
  cassette(k, 12.5, -8.5);
  for (const [x, z] of [[8.5, -9], [16.5, -7.5], [19.5, -9.5]]) downlight(k, x, z);
}

/* ============================ east corridor and south-east lobby ============================ */
// The corridor runs south between the core and the curved glass of the east
// rooms; at only 4 m wide it gets nothing but pictures on the core wall. The
// lobby at its south end has a dead-end bay to the west: a plant and a dark
// name board there (the tenant's lettering left as a pale band).
function eastCorridor(k: Kit) {
  const xc = 17.25;                              // the core's east face
  pixelPanel(k, xc, .5, 'e', L1 + 1.5, .25, FRAME_A, GREYS);
  pixelPanel(k, xc, 3.5, 'e', L1 + 1.5, .25, FRAME_B, GREYS);
  pixelPanel(k, xc, 12.5, 'e', L1 + 1.5, .25, FRAME_A, GREYS);
  for (const z of [-4, 1, 6, 11, 16]) downlight(k, 19.5, z);
  // the south-east lobby
  plant(k, 11.25, 17.75, L1);
  pixelPanel(k, 10.25, 19, 'e', L1 + 2.25, .25, ['kkkkkkkk', 'kllllllk', 'kkkkkkkk'], GREYS);
  for (const x of [12.5, 16, 19.5]) downlight(k, x, 18.75);
}

/* ============================ the gap between the toilet groups ============================ */
// Off the gallery, between the two toilet blocks; both washroom doors face
// each other here. A red fire-hose reel on the north wall with an extinguisher
// under it, and the two closed duct shafts that frame its east end.
function toiletGap(k: Kit) {
  k.box(16, 16.75, L1, CEIL1, 5, 6, matKWall);                                       // shaft, block 1
  k.box(16, 16.75, L1, CEIL1, 8.75, 9.75, matKWall);                                 // shaft, block 2
  pixelPanel(k, 14.75, 5, 's', L1 + 1, .25, [
    '.RRRR.',
    'RRRRRR',
    'RRkkRR',
    'RRkkRR',
    'RRRRRR',
    '.RRRR.',
  ], { R: matKRed, k: matKSteel });
  k.box(15.5, 16, L1, L1 + 1, 5, 5.5, matKRed);                                      // extinguisher
  k.box(15.5, 15.75, L1 + 1, L1 + 1.25, 5, 5.25, matKBlack);
  downlight(k, 13.5, 7.25);
}

/* ============================ toilets ============================ */
// Each group: a wash lobby with one basin, a mirror and a black towel
// dispenser, and two cubicles behind it with one pan each (block 2's west
// cubicle has a urinal). Positions as the plan draws them.
function toiletBlockNorth(k: Kit) {
  const w = room('R_wash1'), a = room('R_wc1a'), b = room('R_wc1b');
  const zs = 4.5;                                // the washroom's south wall face
  basin(k, 14.625, zs - .375, 'n', L1);
  panel(k, 14.625, zs, 'n', 1.25, L1 + 1.5, L1 + 2.5, matKGlassPale);                // mirror
  k.box(15.5, 16, L1 + 1.5, L1 + 2.25, zs - .25, zs, matKBlack);                    // towel dispenser
  downlight(k, snap(w.cx), 2.75);
  toilet(k, snap(a.x0) + .625, -.375, 'e', L1);  // against the west wall
  toilet(k, snap(b.x1) - .625, -.375, 'w', L1);  // against the east wall
}
function toiletBlockSouth(k: Kit) {
  const w = room('R_wash2'), b = room('R_wc2b');
  const zn = 10.25;                              // the washroom's north wall face
  basin(k, 14.625, zn + .375, 's', L1);
  panel(k, 14.625, zn, 's', 1.25, L1 + 1.5, L1 + 2.5, matKGlassPale);
  k.box(15.5, 16, L1 + 1.5, L1 + 2.25, zn, zn + .25, matKBlack);
  downlight(k, snap(w.cx), 12);
  // R_wc2a: a urinal on the south wall, flush pipe above it
  k.box(11.5, 12.25, L1 + .75, L1 + 1.75, 15.75, 16.25, matKWhite);
  k.box(11.75, 12, L1 + 1.75, L1 + 2.5, 16, 16.25, matKSteel);
  toilet(k, snap(b.x1) - .625, 15.125, 'w', L1);
}

/* ============================ entry point ============================ */
export function buildUpperEast(k: Kit): void {
  northEastOffice(k);
  meetingRoom(k);
  eastOffice(k);
  southEastCorner(k);
  southOfficeEast(k);
  pantry(k);
  pantryLobby(k);
  eastCorridor(k);
  toiletGap(k);
  toiletBlockNorth(k);
  toiletBlockSouth(k);
}
