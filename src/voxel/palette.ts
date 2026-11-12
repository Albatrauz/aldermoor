/* ============================ voxel palette & surface patterns ============================ */
// A voxel is one byte: an index into this palette. Each entry knows its colour,
// what kind of surface it is (so a hit throws the right dust), how readily it
// breaks, and how glossy it is.
//
// The old maps dressed their boxes in painted canvas textures. A voxel world
// can't be textured that way — the voxels ARE the texture — so each of the old
// materials is given a PATTERN here instead: a small function that, asked about
// one voxel, answers with a palette index. Sandstone lays itself in courses,
// crates grow a darker frame, facades punch rows of recessed windows. The maps
// themselves are untouched; they still build the same boxes from the same
// materials, and the voxelizer asks these patterns how to fill them.
import * as THREE from 'three';
import * as M from '../materials';
import type { Surface } from '../materials';

export interface VoxMat { hex: number; surface: Surface; soft: number; gloss: number; }

const mats: (VoxMat | null)[] = [null];
// sRGB bytes + gloss, for all 256 byte values (128+ = the scorched variant).
export const PAL = new Uint8Array(256 * 4);

/* `soft` scales how big a bite a hit takes: >1 crumbles, <1 only dents. */
export function def(hex: number, surface: Surface, soft = 1, gloss = 0): number {
  const id = mats.length;
  if (id >= 127) throw new Error('voxel palette is full');
  mats.push({ hex, surface, soft, gloss });
  const r = hex >> 16 & 255, g = hex >> 8 & 255, b = hex & 255;
  PAL.set([r, g, b, Math.round(gloss * 255)], id * 4);
  // Scorched: pulled toward soot. Freshly broken masonry reads darker than its
  // weathered face, and the ring it leaves is what sells a hit as a hit — but
  // it has to stay recognisably the same material, not turn to coal.
  PAL.set([r * .6 + 6, g * .57 + 6, b * .54 + 6, Math.round(gloss * 120)], (id + 128) * 4);
  return id;
}
export const matOf = (m: number): VoxMat => mats[m & 127] as VoxMat;

/* ============================ hashing ============================ */
// Deterministic, coordinate-keyed randomness. Patterns and destruction both use
// it so that every client, given the same shot, breaks the same voxels.
export function h3(i: number, j: number, k: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h3(xi, 0, zi), b = h3(xi + 1, 0, zi), c = h3(xi, 0, zi + 1), d = h3(xi + 1, 0, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/* ============================ pattern context ============================ */
// One shared, mutated record — a fill touches millions of voxels and must not
// allocate per voxel. `li/lj/lk` and `ni/nj/nk` locate the voxel inside the box
// being filled (in the box's own frame, so they survive rotation); they are
// zeroed for non-box shapes, where `box` is false.
export interface Ctx {
  x: number; y: number; z: number;     // world centre of the voxel
  vs: number;
  box: boolean;
  li: number; lj: number; lk: number;
  ni: number; nj: number; nk: number;
  top: number;                          // world y of the shape's top
}
export type Pattern = (c: Ctx) => number;   // palette id, or 0 to leave a hole

const edgeCount = (c: Ctx) =>
  (c.li === 0 || c.li === c.ni - 1 ? 1 : 0) + (c.lj === 0 || c.lj === c.nj - 1 ? 1 : 0) + (c.lk === 0 || c.lk === c.nk - 1 ? 1 : 0);

/* ============================ palette entries ============================ */
// desert
const SAND_A = def(0xcfae76, 'sand', 1.15), SAND_B = def(0xc4a36b, 'sand', 1.15);
const SAND_SUB = def(0xa3844f, 'sand', 1.1);
const PATH_A = def(0xd8ba81, 'sand', 1.15), PATH_B = def(0xcdae75, 'sand', 1.15);
const SS = [def(0xc2a886, 'stone'), def(0xcdb391, 'stone'), def(0xb69c7a, 'stone')];
const SS_WORN = def(0xa58c69, 'stone');
const SSD = [def(0xa48a68, 'stone'), def(0xae9472, 'stone'), def(0x987e5c, 'stone')];
const SSD_WORN = def(0x8a7152, 'stone');
const CONC = [def(0x9a9489, 'concrete', .9), def(0xa39d92, 'concrete', .9), def(0x8f897f, 'concrete', .9)];
const CRATE_A = def(0xb09466, 'wood', 1.25), CRATE_B = def(0xa3875a, 'wood', 1.25), CRATE_EDGE = def(0x77603a, 'wood', 1.2);
const IRON = def(0x2c2824, 'metal', .6, .7);
const BLUE_A = def(0x2f6fb0, 'metal', .6, .5), BLUE_B = def(0x285f99, 'metal', .6, .5), BLUE_EDGE = def(0x214d7c, 'metal', .6, .5);
const CAR_RED = def(0xb5402e, 'metal', .65, .55);
const BAG_A = def(0xb8a878, 'sand', 1.1), BAG_B = def(0xa6966a, 'sand', 1.1);
const DOOR = def(0x5a6b3a, 'metal', .6, .5);
// winter city
const SNOW_A = def(0xe6ecf2, 'snow', 1.3), SNOW_B = def(0xdae1e9, 'snow', 1.3);
const SNOWPATH_A = def(0xbcc5cf, 'snow', 1.3), SNOWPATH_B = def(0xc7cfd8, 'snow', 1.3);
const DIRT = def(0x5f574d, 'sand', 1.1);
const ASPH_A = def(0x33363b, 'concrete', .9), ASPH_B = def(0x3b3e44, 'concrete', .9), LANE = def(0xc9b458, 'concrete', .9);
const BRICK = [def(0x8a4434, 'stone'), def(0x7c3c2e, 'stone'), def(0x96503e, 'stone')];
const FC = [def(0x8b8d90, 'concrete', .9), def(0x95979a, 'concrete', .9)], FC_TRIM = def(0x5a5c5f, 'concrete', .9);
const FB = [def(0x7c4438, 'stone'), def(0x874c3f, 'stone')], FB_TRIM = def(0x43352c, 'stone');
const FW = [def(0x9a958c, 'concrete', .9), def(0xa39e95, 'concrete', .9)], FW_TRIM = def(0x6b6660, 'concrete', .9);
const GLASS = def(0x2b3743, 'metal', 1.5, .9), GLASS_LIT = def(0xd9b56a, 'metal', 1.5, .6);
const TAR = def(0x2b2d31, 'concrete', .9);
const SNOWCAP = def(0xe6ecf2, 'snow', 1.3);
const RUST_A = def(0x7a4a32, 'metal', .65, .3), RUST_B = def(0x6c4029, 'metal', .65, .3);
const DUMP_A = def(0x2f5a3e, 'metal', .6, .4), DUMP_B = def(0x284d35, 'metal', .6, .4);
const CAR_BLUE = def(0x2c4763, 'metal', .65, .55), CAR_GREY = def(0x6a6f76, 'metal', .65, .55);
const WOOD_DARK = def(0x3a2a1c, 'wood', 1.2), PLANK = def(0x6b4a2e, 'wood', 1.2), GOLD = def(0xcaa64e, 'metal', .6, .8);

// office (kantoor)
const KB = [def(0x4b4c50, 'stone'), def(0x424347, 'stone'), def(0x55565a, 'stone')];
const KBW = [def(0xdcdad3, 'stone'), def(0xd0cec6, 'stone'), def(0xe6e4dd, 'stone')];
const K_TRIM = def(0xb4b8bd, 'metal', .7, .5), K_FRAME = def(0x27303d, 'metal', .7, .5);
const K_GLASS = def(0x3f6f9e, 'metal', 1.5, .9), K_GLASS_PALE = def(0xa8c6d4, 'metal', 1.5, .8);
const K_ROOF_A = def(0x3a3c40, 'concrete', .9), K_ROOF_B = def(0x44464a, 'concrete', .9);
const KP = [def(0x8c867e, 'stone'), def(0x827c74, 'stone'), def(0x979189, 'stone')], K_PLINE = def(0xcfcbc2, 'stone');
const KH = [def(0xa3552a, 'wood', 1.4), def(0x8f4722, 'wood', 1.4), def(0xb56a35, 'wood', 1.4)];
const K_GRASS_A = def(0x5c7438, 'sand', 1.15), K_GRASS_B = def(0x526a31, 'sand', 1.15);
const K_SHED_A = def(0xaeb2b6, 'metal', .7, .35), K_SHED_B = def(0xa2a6aa, 'metal', .7, .35), K_SHED_DARK = def(0x6a7078, 'metal', .7, .35);
const K_FENCE = def(0x3b3f42, 'metal', .8, .4);
const K_WALL = def(0xecebe6, 'concrete', 1.1), K_WALL_WARM = def(0xe6dcc6, 'concrete', 1.1);
const K_CEIL = def(0xf2f1ec, 'concrete', 1.2), K_LIGHT = def(0xfff3cf, 'metal', 1.2, .2);
const K_CARPET_A = def(0x45433f, 'sand', 1), K_CARPET_B = def(0x4c4a46, 'sand', 1);
const K_TILE_A = def(0x55504a, 'stone'), K_TILE_B = def(0x4c4843, 'stone');
const K_FWOOD_A = def(0xb79a74, 'wood', 1.1), K_FWOOD_B = def(0xad906a, 'wood', 1.1);
const K_DESK = def(0xd9bc8c, 'wood', 1.25), K_WOOD_DARK = def(0x4a2f22, 'wood', 1.2), K_WHITE = def(0xf4f4f1, 'wood', 1.25);
const K_BLACK = def(0x1c1d20, 'metal', .9, .5);
const K_GREY_L = def(0xc6c8ca, 'concrete'), K_GREY = def(0x8a8d91, 'concrete'), K_GREY_D = def(0x4a4d52, 'concrete');
const K_STEEL = def(0x9aa0a6, 'metal', .7, .7);
const K_RED = def(0xb8322c, 'wood', 1.2), K_ORANGE = def(0xe08a2a, 'wood', 1.2), K_YELLOW = def(0xe6c23c, 'wood', 1.2);
const K_PINK = def(0xd6507e, 'wood', 1.2), K_PURPLE = def(0x6b3f8f, 'wood', 1.2), K_BLUE = def(0x2a5fa8, 'wood', 1.2);
const K_TEAL = def(0x2f9aa0, 'wood', 1.2), K_GREEN = def(0x3f7a3a, 'wood', 1.4), K_POT = def(0x6f6259, 'stone');
const K_MINT = def(0xa9d8dc, 'metal', 1.1, .2), K_LED = def(0x8f2a1c, 'metal', 1.3, .2);

/* ============================ patterns ============================ */
// Masonry in horizontal courses. Tone is chosen per course so a whole course
// greedy-meshes into one quad; a sprinkling of individually weathered blocks
// (staggered by half a block on alternate courses) breaks the stripes up.
const courses = (tones: number[], worn: number, courseH: number, blockL: number): Pattern => (c) => {
  const h = Math.max(courseH, c.vs), row = Math.floor(c.y / h + 1e-4);
  const blk = Math.floor((c.x + c.z) / Math.max(blockL, c.vs * 2) + (row & 1) * .5);
  if (h3(blk, row, 7) < .1) return worn;
  return tones[Math.floor(h3(row, 3, 11) * tones.length)];
};
// Cast slabs: big panels of very slightly different greys.
const slabs = (tones: number[]): Pattern => (c) =>
  tones[Math.floor(h3(Math.floor(c.x / 2.5), Math.floor(c.y / 1.5 + 1e-4), Math.floor(c.z / 2.5)) * tones.length)];
const flat = (id: number): Pattern => () => id;

const crate: Pattern = (c) => {
  if (!c.box) return CRATE_A;
  if (edgeCount(c) >= 2) return CRATE_EDGE;
  return ((c.li + c.lk) >> 1) & 1 ? CRATE_A : CRATE_B;       // upright planks
};
const container: Pattern = (c) => {
  if (!c.box) return BLUE_A;
  if (edgeCount(c) >= 2) return BLUE_EDGE;
  return (c.li + c.lk) & 1 ? BLUE_A : BLUE_B;                // corrugation
};
const dumpster: Pattern = (c) => (c.box && edgeCount(c) >= 2 ? DUMP_B : DUMP_A);
const rust: Pattern = (c) => (h3(Math.floor(c.x * 2), Math.floor(c.y * 2), Math.floor(c.z * 2)) < .3 ? RUST_B : RUST_A);
const sandbag: Pattern = (c) =>
  c.box ? ((((c.li + (c.lj & 1)) >> 1) ^ (c.lk >> 1) ^ c.lj) & 1 ? BAG_A : BAG_B) : BAG_A;
// A car body. The upper box (the cabin) gets a band of dark glass round its sides.
const car = (body: number): Pattern => (c) => {
  if (c.box && c.nj <= 4 && c.y > 1.0 && c.lj > 0 && c.lj < c.nj - 1) {
    const onI = c.li === 0 || c.li === c.ni - 1, onK = c.lk === 0 || c.lk === c.nk - 1;
    if (onI !== onK) return GLASS;                           // a side, but not a corner post
  }
  return body;
};

const sand: Pattern = (c) => (vnoise(c.x * .09, c.z * .09) + vnoise(c.x * .31, c.z * .31) * .35 > .72 ? SAND_B : SAND_A);
const sandPath: Pattern = (c) => (vnoise(c.x * .22, c.z * .22) > .55 ? PATH_B : PATH_A);
const snow: Pattern = (c) => (vnoise(c.x * .08, c.z * .08) + vnoise(c.x * .27, c.z * .27) * .35 > .74 ? SNOW_B : SNOW_A);
const snowPath: Pattern = (c) => (vnoise(c.x * .25, c.z * .25) > .5 ? SNOWPATH_B : SNOWPATH_A);
const asphalt: Pattern = (c) => {
  if (Math.abs(c.z) < Math.max(.26, c.vs * .51) && ((c.x % 8) + 8) % 8 < 3.5) return LANE;   // dashed centre line
  return vnoise(c.x * .2, c.z * .2) > .6 ? ASPH_B : ASPH_A;
};

/* Apartment facades. Windows are cut on a world-aligned 3 m grid, so the wall
   segments, lintels and window heads that make up one face (all separate boxes)
   line up with no bookkeeping. On the fine grid the outer voxel of each window
   is left empty and the glass sits one voxel in: a real reveal, which the
   mesher's ambient occlusion then shades for free. */
const FLOOR0 = 6.2, PITCH = 3;
const facade = (tones: number[], trim: number): Pattern => (c) => {
  const base = tones[Math.floor(h3(Math.floor(c.y / .75 + 1e-4), 5, 2) * tones.length)];
  if (!c.box) return base;
  if (c.top - c.y < .5 && c.nj * c.vs > 6) return trim;        // cornice
  if (c.y < FLOOR0) return base;
  // which lateral face is this voxel near? (short end-faces carry no windows)
  const di = Math.min(c.li, c.ni - 1 - c.li), dk = Math.min(c.lk, c.nk - 1 - c.lk);
  const dX = c.nk * c.vs >= 5 ? di : 1e9, dZ = c.ni * c.vs >= 5 ? dk : 1e9;
  const depth = Math.min(dX, dZ);
  const deep = c.vs < .4 ? 1 : 0;                              // recess only where voxels are small
  if (depth > deep) return base;
  const u = dX <= dZ ? c.z : c.x;
  const fu = ((u % PITCH) + PITCH) % PITCH, fy = (c.y - FLOOR0) % PITCH;
  const inWin = fu >= .75 && fu < 2.25 && fy >= .5 && fy < 2;
  if (inWin) {
    if (depth < deep) return 0;                                // the reveal
    const cell = h3(Math.floor(u / PITCH), Math.floor((c.y - FLOOR0) / PITCH), dX <= dZ ? 1 : 2);
    return cell < .1 ? GLASS_LIT : GLASS;
  }
  if (depth === 0 && fu >= .5 && fu < 2.5 && fy >= .25 && fy < 2.25) return trim;   // surround
  return base;
};

/* ---- office (kantoor) ---- */
// Clay pavers laid in a herringbone: two-voxel bricks that turn a quarter each row.
const paver: Pattern = (c) => {
  const i = Math.floor(c.x / c.vs + 1e-4), k = Math.floor(c.z / c.vs + 1e-4);
  const b = ((i + k) >> 1) + ((i - k) >> 1) * 3;
  return KP[Math.floor(h3(b, 9, (i + k) & 1) * KP.length)];
};
// A beech hedge holding its dead leaves: mottled, no two voxels in a row alike.
const hedge: Pattern = (c) => KH[Math.floor(h3(Math.floor(c.x * 4), Math.floor(c.y * 4), Math.floor(c.z * 4)) * KH.length)];
const grass: Pattern = (c) => (vnoise(c.x * .3, c.z * .3) > .52 ? K_GRASS_B : K_GRASS_A);
// Profiled steel cladding: upright ribs.
const cladding: Pattern = (c) => ((Math.floor((c.x + c.z) / Math.max(.5, c.vs) + 1e-4) & 1) ? K_SHED_B : K_SHED_A);
const roofing: Pattern = (c) => (h3(Math.floor(c.x * 2), 4, Math.floor(c.z * 2)) < .25 ? K_ROOF_B : K_ROOF_A);
// Carpet tiles and stone tiles: a quiet chequer on a world-aligned grid.
const chequer = (a: number, b: number, size: number): Pattern => (c) =>
  ((Math.floor(c.x / size + 1e-4) + Math.floor(c.z / size + 1e-4)) & 1 ? b : a);
const boards = (a: number, b: number): Pattern => (c) => (h3(Math.floor(c.z / .5 + 1e-4), 2, Math.floor(c.x / 4)) < .4 ? b : a);
// A suspended ceiling: white tiles with a light panel let into it every few
// metres. Only the underside carries the panels — that is the face a room sees.
const ceilingTiles: Pattern = (c) => {
  if (c.box && c.lj > 0) return K_CEIL;
  const fx = ((c.x % 5) + 5) % 5, fz = ((c.z % 5) + 5) % 5;
  return fx >= 1.5 && fx < 3.5 && fz >= 2 && fz < 3 ? K_LIGHT : K_CEIL;
};

const patterns = new Map<THREE.Material, Pattern>([
  [M.matSand, sand], [M.matSandPath, sandPath],
  [M.matSandstone, courses(SS, SS_WORN, .5, 1)], [M.matSandstoneDark, courses(SSD, SSD_WORN, .75, 1.5)],
  [M.matConcrete, slabs(CONC)], [M.matCrate, crate], [M.matIron, flat(IRON)],
  [M.matContainerBlue, container], [M.matCarRed, car(CAR_RED)], [M.matSandbag, sandbag], [M.matMetalDoor, flat(DOOR)],
  [M.matSnow, snow], [M.matSnowPath, snowPath], [M.matAsphalt, asphalt],
  [M.matBrick, courses(BRICK, BRICK[1], .25, .75)],
  [M.matFacadeConcrete, facade(FC, FC_TRIM)], [M.matFacadeBrick, facade(FB, FB_TRIM)], [M.matFacadeWorn, facade(FW, FW_TRIM)],
  [M.matRoofTar, flat(TAR)], [M.matSnowCap, flat(SNOWCAP)], [M.matRust, rust], [M.matDumpster, dumpster],
  [M.matCarBlue, car(CAR_BLUE)], [M.matCarGrey, car(CAR_GREY)],
  [M.matDarkWood, flat(WOOD_DARK)], [M.matPlank, flat(PLANK)], [M.matGoldTrim, flat(GOLD)],
  // office (kantoor)
  [M.matKBrick, courses(KB, KB[1], .25, .75)], [M.matKBrickWhite, courses(KBW, KBW[1], .25, .75)],
  [M.matKTrim, flat(K_TRIM)], [M.matKFrame, flat(K_FRAME)], [M.matKGlass, flat(K_GLASS)], [M.matKGlassPale, flat(K_GLASS_PALE)],
  [M.matKRoof, roofing], [M.matKPaver, paver], [M.matKPaverLine, flat(K_PLINE)], [M.matKHedge, hedge], [M.matKGrass, grass],
  [M.matKShed, cladding], [M.matKShedDark, flat(K_SHED_DARK)], [M.matKFence, flat(K_FENCE)],
  [M.matKWall, flat(K_WALL)], [M.matKWallWarm, flat(K_WALL_WARM)], [M.matKCeiling, ceilingTiles], [M.matKLight, flat(K_LIGHT)],
  [M.matKCarpet, chequer(K_CARPET_A, K_CARPET_B, 1.5)], [M.matKTile, chequer(K_TILE_A, K_TILE_B, 1.5)],
  [M.matKFloorWood, boards(K_FWOOD_A, K_FWOOD_B)],
  [M.matKDeskTop, flat(K_DESK)], [M.matKWoodDark, flat(K_WOOD_DARK)], [M.matKWhite, flat(K_WHITE)], [M.matKBlack, flat(K_BLACK)],
  [M.matKGreyLight, flat(K_GREY_L)], [M.matKGrey, flat(K_GREY)], [M.matKGreyDark, flat(K_GREY_D)], [M.matKSteel, flat(K_STEEL)],
  [M.matKRed, flat(K_RED)], [M.matKOrange, flat(K_ORANGE)], [M.matKYellow, flat(K_YELLOW)], [M.matKPink, flat(K_PINK)],
  [M.matKPurple, flat(K_PURPLE)], [M.matKBlue, flat(K_BLUE)], [M.matKTeal, flat(K_TEAL)], [M.matKGreen, flat(K_GREEN)],
  [M.matKPot, flat(K_POT)], [M.matKMint, flat(K_MINT)], [M.matKLed, flat(K_LED)],
]);

/* A material nobody registered still voxelizes: it gets a flat palette entry in
   its own colour, so a new prop in a map shows up as itself rather than vanishing. */
const adhoc = new Map<THREE.Material, Pattern>();
export function patternFor(mat: THREE.Material): Pattern {
  const known = patterns.get(mat) ?? adhoc.get(mat);
  if (known) return known;
  const col = (mat as THREE.MeshStandardMaterial).color;
  const hex = col ? new THREE.Color().copy(col).getHex(THREE.SRGBColorSpace) : 0x888888;
  const p = flat(def(hex, M.surfaceOf(mat)));
  adhoc.set(mat, p);
  return p;
}

/* What lies under the surface layer of open ground — what a crater digs into. */
export function subsoil(surface: Surface) { return surface === 'snow' ? DIRT : SAND_SUB; }
