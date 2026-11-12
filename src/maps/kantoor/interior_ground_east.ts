/* ============================ kantoor — ground floor, east side ============================ */
// The furniture of the east half of the ground floor, room by room: the small
// meeting office behind the glass (kantoor_N), the store room, the two big open
// offices, the east corridor, the glass reception office with its copier nook
// behind, and the two toilet blocks off the atrium.
//
// Positions come from the floor plan in game coordinates (2.5× life size across,
// life size up). Furniture is cover: worktops at 1.0, screens to 1.75, and the
// only tall free-standing things are the racks in the store room. Everything
// stands on the ground floor (y = 0) or hangs from the ceiling (y = CEIL0) or a wall.
import type { Material } from 'three';
import { type Kit, CEIL0, SILL, VS, snap } from './kit';
import { room as planRoom } from './structure';
import { type Dir, lbox, chair, chairsAround, cabinet, shelves, toilet, basin, plant, pixelPanel, panel } from './props';
import {
  matKDeskTop, matKWoodDark, matKWhite, matKBlack, matKGrey, matKGreyDark, matKGreyLight, matKSteel,
  matKRed, matKOrange, matKYellow, matKPink, matKBlue, matKTeal, matKGreen, matKPot, matKLight,
  matKWallWarm,
} from '../../materials';

/* A room's bounding box on the voxel lattice. The plan's room outlines sit a
   few centimetres off the wall faces; rounded to the lattice they land on the
   faces, except where a comment below gives the real face instead. */
function room(id: string) {
  const r = planRoom(id);
  return { ...r, x0: snap(r.x0), x1: snap(r.x1), z0: snap(r.z0), z1: snap(r.z1) };
}

/* ============================ small fittings ============================ */
/* a 60×60 LED panel in the suspended ceiling (1.5 m here) */
function led(k: Kit, x: number, z: number) {
  k.box(x - .75, x + .75, CEIL0 - VS, CEIL0, z - .75, z + .75, matKLight);
}
/* a square four-way air-conditioning cassette: white rim, grey grille */
function cassette(k: Kit, x: number, z: number) {
  const y0 = CEIL0 - VS;
  k.box(x - 1, x + 1, y0, CEIL0, z - 1, z - .5, matKWhite);
  k.box(x - 1, x + 1, y0, CEIL0, z + .5, z + 1, matKWhite);
  k.box(x - 1, x - .5, y0, CEIL0, z - .5, z + .5, matKWhite);
  k.box(x + .5, x + 1, y0, CEIL0, z - .5, z + .5, matKWhite);
  k.box(x - .5, x + .5, y0, CEIL0, z - .5, z + .5, matKGreyLight);
}

/* Frosted stripes on a glass partition that runs along z at x: thin white
   posts standing on the partition's sill, below eye height and with gaps
   between, so the glass stays see-through. `runs` are the z spans to stripe. */
function frost(k: Kit, x: number, runs: [number, number][]) {
  for (const [z0, z1] of runs) {
    for (let z = z0; z + VS <= z1 + 1e-6; z += .75) k.box(x, x + VS, SILL, 2.5, z, z + VS, matKWhite);
  }
}

/* ============================ desks ============================ */
interface Work {
  w?: number;               // width along the desk
  mon?: 0 | 1 | 2;          // monitors on the far edge
  top?: Material;
  legs?: Material;
  front?: Material;         // a closed desk: side panels and a modesty panel in this
  screen?: boolean;         // black acoustic screen along the far edge, to 1.75
  chair?: boolean;
}
/* A workstation 2 m deep. Default is the sit-stand desk all these offices use:
   light oak top on a black T-leg frame. `dir` is the way the sitter faces. */
function work(k: Kit, cx: number, cz: number, dir: Dir, o: Work = {}) {
  const w = o.w ?? 4, hw = w / 2, top = o.top ?? matKDeskTop, legs = o.legs ?? matKBlack;
  const L = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, m: Material) =>
    lbox(k, cx, cz, dir, u0, u1, v0, v1, y0, y1, m);
  L(-hw, hw, -1, 1, .75, 1, top);
  if (o.front) {
    L(-hw, -hw + .25, -1, 1, 0, .75, o.front);
    L(hw - .25, hw, -1, 1, 0, .75, o.front);
    L(-hw + .25, hw - .25, .75, 1, .25, .75, o.front);
  } else {
    for (const u of [-hw + .25, hw - .5]) {
      L(u, u + .25, -.25, 0, .25, .75, legs);       // the lifting column
      L(u, u + .25, -.75, .75, 0, .25, legs);       // its foot
    }
  }
  const mon = o.mon ?? 2;
  if (mon === 1) {
    L(-.25, .25, .25, .5, 1, 1.25, matKBlack);
    L(-.75, .75, .25, .5, 1.25, 2, matKBlack);
  } else if (mon === 2) {
    for (const s of [-1, 1]) {
      L(s < 0 ? -1 : .75, s < 0 ? -.75 : 1, .25, .5, 1, 1.25, matKBlack);
      L(s < 0 ? -1.5 : .25, s < 0 ? -.25 : 1.5, .25, .5, 1.25, 2, matKBlack);
    }
  }
  if (o.screen) L(-hw, hw, .75, 1, 1, 1.75, matKBlack);
  if (o.chair !== false) {
    const f: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    chair(k, cx - f[dir][0] * 1.75, cz - f[dir][1] * 1.75, dir, 0);
  }
}
/* A bench: desks back to back in pairs with the screens between them, `n`
   pairs in a row. 'x' lays the row east–west (sitters face north and south),
   'z' north–south (sitters face east and west). Footprint with the chairs:
   n·w along the row, 6.5 across it. */
function bench(k: Kit, cx: number, cz: number, axis: 'x' | 'z', n: number, w = 4, mon: 0 | 1 | 2 = 2) {
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) * w;
    if (axis === 'x') {
      work(k, cx + s, cz - 1, 's', { w, mon, screen: true });
      work(k, cx + s, cz + 1, 'n', { w, mon, screen: true });
    } else {
      work(k, cx - 1, cz + s, 'e', { w, mon, screen: true });
      work(k, cx + 1, cz + s, 'w', { w, mon, screen: true });
    }
  }
}

/* a whiteboard `nc` cells wide and `nr` high: grey frame, white face, a few marks */
function whiteboard(nc: number, nr: number, marks: Record<number, string> = {}): string[] {
  const rows: string[] = [];
  for (let r = 0; r < nr; r++) {
    if (r === 0 || r === nr - 1) { rows.push('g'.repeat(nc)); continue; }
    rows.push('g' + (marks[r] ?? '').padEnd(nc - 2, 'w').slice(0, nc - 2) + 'g');
  }
  return rows;
}
const BOARD = { g: matKGreyLight, w: matKWhite, b: matKBlue, r: matKRed, k: matKBlack };

/* ============================ kantoor_N — the meeting office behind the glass ============================ */
// "N-middle": a small office reached only through the glass partition from the
// big NE office. An orange cherry meeting table with a thick black edge and six
// black stacking chairs, a big whiteboard on the kantine wall, a TV on the store
// room wall, the manager's desk under the window and a white desk in the corner.
function kantoorN(k: Kit) {
  const r = room('kantoor_N');                       // x 6 … 16.75, z −34.25 … −21.25

  // meeting table, long side north–south: black rim round an orange top, black legs
  const x0 = 9.75, x1 = 12.25, z0 = -28.75, z1 = -22.75;
  k.box(x0, x1, .75, 1, z0, z0 + .25, matKBlack);
  k.box(x0, x1, .75, 1, z1 - .25, z1, matKBlack);
  k.box(x0, x0 + .25, .75, 1, z0 + .25, z1 - .25, matKBlack);
  k.box(x1 - .25, x1, .75, 1, z0 + .25, z1 - .25, matKBlack);
  k.box(x0 + .25, x1 - .25, .75, 1, z0 + .25, z1 - .25, matKOrange);
  for (const [lx, lz] of [[x0 + .25, z0 + .25], [x1 - .5, z0 + .25], [x0 + .25, z1 - .5], [x1 - .5, z1 - .5]]) {
    k.box(lx, lx + .25, 0, .75, lz, lz + .25, matKBlack);
  }
  chairsAround(k, x0, x1, z0, z1, 0, matKBlack, 2);

  // the manager's desk west of the window: black top, cherry sides and front, facing the room
  work(k, 9, -31.25, 's', { w: 4, mon: 1, top: matKBlack, front: matKOrange });
  // a plain white desk in the south-west corner, facing the wall
  work(k, 7.5, -22.25, 's', { w: 3, mon: 1, top: matKWhite, legs: matKGreyLight });

  // whiteboard on the kantine wall, its red eraser top right; TV on the store-room wall
  pixelPanel(k, r.x0, -28, 'e', 1.5, VS, whiteboard(24, 6, {
    1: 'w'.repeat(20) + 'r',
    2: 'wwbbbbwwwwbbbwww',
    3: 'wwwwbbbbbwwwwwwwwbbw',
  }), BOARD);
  panel(k, 12.5, -21.25, 'n', 3, 2, 3.5, matKBlack);

  // the glass wall to the NE office: frosted stripes either side of the door
  frost(k, 16.75, [[-34, -30.25], [-25.75, -21.5]]);

  cassette(k, 11.5, -26);
  for (const [x, z] of [[8.5, -27], [14.5, -31.5], [14.5, -24]]) led(k, x, z);
}

/* ============================ magazijn — the store room ============================ */
// No photo exists; it is the building's store. Grey floor, a run of shelving
// on the north wall, two double-sided steel racks across the room (aisles to
// fight down, gaps between the boards to shoot through) and pallets of boxes
// by the door.
function magazijn(k: Kit) {
  const r = room('magazijn');                        // x 6 … 16.75, z −20.75 … −6.25 (walls)
  k.paintRect(r.x0, r.x1, -21, -6.25, matKGrey);

  // cartons in a fixed "random" order so the room is the same every time
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const CARTON = [matKDeskTop, matKDeskTop, matKWhite, matKPot];
  const carton = () => CARTON[Math.floor(rnd() * CARTON.length)];

  /* a free-standing double-sided rack along x: posts every 2.5, four boards, cartons on three */
  const rack = (x0: number, x1: number, z0: number, z1: number) => {
    const posts: number[] = [];
    for (let x = x0; x < x1 - VS; x += 2.5) posts.push(x);
    posts.push(x1 - VS);
    const levels = [0, 1, 2, 2.75];
    for (const y of levels) k.box(x0, x1, y, y + VS, z0, z1, matKGrey);
    for (const p of posts) for (let i = 0; i + 1 < levels.length; i++) {
      k.box(p, p + VS, levels[i] + VS, levels[i + 1], z0, z1, matKGreyDark);
    }
    for (let i = 0; i + 1 < posts.length; i++) {
      for (let l = 0; l < 3; l++) {
        const y = levels[l] + VS, room_ = levels[l + 1] - y;
        let x = posts[i] + VS;
        while (x < posts[i + 1] - .5) {
          const w = Math.min(rnd() < .5 ? .75 : 1, posts[i + 1] - x);
          if (rnd() < .7) {
            const h = room_ > .5 && rnd() < .5 ? .75 : .5;
            const front = rnd() < .5;
            k.box(x, x + w, y, y + h, front ? z0 : z0 + VS, front ? z1 - VS : z1, carton());
          }
          x += w;
        }
      }
    }
  };
  rack(8.75, 13.75, -17, -16);
  rack(8.75, 13.75, -13.5, -12.5);

  // wall shelving on the north wall, a few cartons on it
  shelves(k, 8.5, -20.25, 4, 's', 0, 2.5, matKGrey);
  shelves(k, 13.5, -20.25, 4, 's', 0, 2.5, matKGrey);
  for (const [x, y, w] of [[7, .5, 1], [9.25, .5, .75], [12, 1.25, 1], [14.25, .5, .75], [8, 2, .75], [13, 2, .75]]) {
    k.box(x, x + w, y, y + .5, -20.5, -20, carton());
  }

  // pallets by the door: one stack waist high in the room, one taller against the south wall
  k.box(8, 10.5, 0, .25, -10, -8, matKPot);
  k.box(8.25, 9.25, .25, 1.25, -9.75, -8.25, matKDeskTop);
  k.box(9.25, 10.25, .25, 1, -9.75, -8.25, matKWhite);
  k.box(11.5, 13.25, 0, .25, -7.25, -6.25, matKPot);
  k.box(11.5, 13.25, .25, 1.25, -7.25, -6.25, matKDeskTop);
  k.box(11.75, 13, 1.25, 1.75, -7, -6.25, matKDeskTop);
  // an old office chair put away in the corner
  chair(k, 7, -7.25, 'e', 0);

  for (const [x, z] of [[7.5, -14.75], [15.25, -14.75], [11.25, -18.5], [11.25, -11]]) led(k, x, z);
}

/* ============================ kantoor_NE — the big open office ============================ */
// Oak sit-stand desks in back-to-back pairs with black screens: one bench
// along the north windows, one in the middle, single desks facing the east
// windows, a TV between them. The west side stays open as the walk from the
// glass door of kantoor_N down to the corridor door.
function kantoorNE(k: Kit) {
  const r = room('kantoor_NE');                      // x 17 … 34.25, z −34.25 … −11.5 (walls)
  bench(k, 24.5, -29.25, 'x', 2);
  bench(k, 24.5, -18.5, 'x', 2);
  work(k, 32.75, -29, 'e');
  work(k, 32.75, -19, 'e');
  panel(k, r.x1, -22.25, 'w', 2.5, 2.25, 3.5, matKBlack);              // TV on the east wall

  // a low white cupboard on the store-room wall with the printer on it
  cabinet(k, 17.25, 18, -20.5, -15.5, 0, 1.25, matKWhite);
  k.box(17.25, 18, 1.25, 1.75, -18.75, -17.5, matKGreyLight);
  plant(k, 17.875, -33.625, 0, 2.25);
  plant(k, 33.625, -12.125, 0, 2.25);

  cassette(k, 24.5, -24);
  cassette(k, 29, -15);
  for (const [x, z] of [[20.5, -31], [28.5, -31], [20.5, -24], [31.5, -24], [20.5, -16], [24.5, -13.5]]) led(k, x, z);
}

/* ============================ kantoor_SE — the open office "h. 2.70" ============================ */
// Seen only in the walkthrough video and two misfiled stills. A desk island in
// the narrow north part under the inside window to the NE office, a long bench
// along the east windows, two desks facing the south ribbon window. On the
// west (toilet-block) wall a whiteboard and a three-panel pop-art face
// painting; on the east wall a string of photos between the windows; a fire
// hose reel beside the corridor door and a white coat stand.
function kantoorSE(k: Kit) {
  const r = room('kantoor_SE');                      // x 17.25 … 34.25, z −11 … 16.25 (L-shaped)
  bench(k, 28.5, -6.25, 'z', 2, 3);
  bench(k, 29, 5, 'z', 3, 4);
  work(k, 28, 14.75, 's', { w: 3.5 });
  work(k, 31.75, 14.75, 's', { w: 3.5 });
  cabinet(k, 32.75, r.x1, -11, -10, 0, 1.25, matKWhite);

  // west wall: whiteboard, and the pop-art triptych further north
  pixelPanel(k, 17.25, 6.5, 'e', 1.5, VS, whiteboard(16, 6, { 2: 'wbbbwwwrrw', 3: 'wwwbbbbbwww' }), BOARD);
  pixelPanel(k, 17.25, 1, 'e', 1.5, VS, [
    'ooyyoo.bbggbb.ppwwpp',
    'oykkyo.bgkkgb.pwkkwp',
    'oyyyyo.bggggb.pwwwwp',
    'opkkpo.bpggpb.pywwyp',
    'oyyyyo.bgkkgb.pwkkwp',
    'ookkoo.bbggbb.ppwwpp',
  ], { o: matKOrange, y: matKYellow, k: matKBlack, b: matKBlue, g: matKGreen, p: matKPink, w: matKWallWarm });
  // east wall between the windows: photos pegged on strings of fairy lights
  pixelPanel(k, r.x1, -4, 'w', 1.5, VS, [
    's....ss....s',
    '.w..s..s..p.',
    '..s.w..y.s..',
    '...s....s...',
    '....p..w....',
    '.....ss.....',
  ], { s: matKSteel, w: matKWhite, p: matKPink, y: matKYellow });
  // fire hose reel beside the corridor door
  pixelPanel(k, 21.5, -2.25, 's', 1.25, VS, ['.rr.', 'rkkr', 'rkkr', '.rr.'], { r: matKRed, k: matKGreyDark });

  // white coat stand by the west wall, a plant by the back-room box
  k.box(18, 18.75, 0, VS, 9, 9.75, matKWhite);
  k.box(18.25, 18.5, VS, 2.5, 9.25, 9.5, matKWhite);
  k.box(17.75, 19, 2.25, 2.5, 9.25, 9.5, matKWhite);
  k.box(18.25, 18.5, 2.25, 2.5, 8.75, 10, matKWhite);
  plant(k, 23.375, 9.375, 0, 2.25);

  cassette(k, 28, -6.25);
  cassette(k, 22, 4);
  for (const [x, z] of [[24.5, -8.5], [32, -8.5], [21, -0.5], [21, 8], [26.5, 2], [26.5, 11.5], [33, 1], [33, 8], [29.5, 14]]) led(k, x, z);
}

/* ============================ corridor_E — the east corridor ============================ */
// Slate-floored passage from the atrium to the store room and the two east
// offices. Kept clear: only things on the walls and the ceiling.
function corridorE(k: Kit) {
  const r = room('corridor_E');                      // x 6 … 21.5, z −6.25 … −2.75, spur north to −11
  // a framed print on the store-room wall
  pixelPanel(k, 12, -6.25, 's', 1.75, VS, [
    'kkkkkkkk',
    'kooobbbk',
    'koopbbbk',
    'kyyppttk',
    'kyyytttk',
    'kkkkkkkk',
  ], { k: matKBlack, o: matKOrange, b: matKBlue, p: matKPink, y: matKYellow, t: matKTeal });
  // fire extinguisher on its bracket by the store-room corner
  k.box(16, 16.5, .5, 1.5, -6.25, -5.75, matKRed);
  k.box(16, 16.5, 1.5, 1.75, -6.25, -6, matKBlack);
  // hose reel on the end wall of the spur
  pixelPanel(k, r.x1, -6.75, 'w', 1.25, VS, ['.rr.', 'rkkr', 'rkkr', '.rr.'], { r: matKRed, k: matKGreyDark });
  // green exit sign hung from the ceiling, pointing back to the atrium
  k.box(12.5, 13.75, CEIL0 - .5, CEIL0, -4.75, -4.5, matKGreen);
  k.box(12.75, 13, CEIL0 - .5, CEIL0 - VS, -4.5, -4.25, matKWhite);
  for (const [x, z] of [[8.5, -4.5], [16.5, -4.5], [19.5, -4.5], [19.5, -8.75]]) led(k, x, z);
}

/* ============================ receptie — the glass reception office ============================ */
// There is no counter: "reception" is this office behind the frosted-striped
// glass wall, which visitors find by following the footprints on the atrium
// floor. Oak sit-stand desks with black screens as two islands, a free-standing
// screen between them, a white cupboard on the west wall, a first-aid box, a
// big plant inside the glass and the round grey column in the east window band.
function receptie(k: Kit) {
  const r = room('receptie');                        // x 10.25 … 21.5, z 16.75 … 34.25
  bench(k, 16, 22, 'z', 1);
  bench(k, 17, 29.5, 'z', 1);
  // free-standing acoustic screen on two feet
  k.box(15, 15.5, 0, VS, 25.75, 26.5, matKBlack);
  k.box(18.5, 19, 0, VS, 25.75, 26.5, matKBlack);
  k.box(15, 19, VS, 1.75, 26, 26.25, matKBlack);
  cabinet(k, r.x0, 11, 29.5, 33.5, 0, 2, matKWhite);
  pixelPanel(k, r.x0, 27.875, 'e', 2, VS, ['.ggg.', 'ggwgg', 'gwwwg', 'ggwgg', '.ggg.'], { g: matKGreen, w: matKWhite });
  plant(k, 11.125, 17.625, 0, 2.5);
  k.cyl(21.25, 25.625, .375, 0, CEIL0, matKSteel);                    // the column in the window band
  k.paintRect(r.x0, r.x1, 25.25, 25.5, matKSteel);                     // steel floor-duct lid

  // frosted stripes on the atrium glass; the middle pane is left clear to vault through
  frost(k, 10, [[17, 19.5], [23.75, 26.25]]);

  cassette(k, 16, 25.5);
  for (const [x, z] of [[13, 19.5], [19, 19.5], [13, 31], [19.5, 32.5], [12.5, 24.5]]) led(k, x, z);
}

/* ============================ achterruimte — the copier nook ============================ */
// The narrow back room behind the receptie, between the toilets and the SE
// office: the big multifunction copier, a tall white cupboard, a crate, a wall
// shelf with cardboard trays and a brown photo print.
function achterruimte(k: Kit) {
  const r = room('achterruimte');
  const wx0 = r.x0 + VS, wx1 = r.x1 - VS;            // wall faces: x 17.25 … 23.75 (z 10.75 … 16.25)
  // copier: grey base, white body, dark scanner lid
  k.box(18, 19.75, 0, .75, r.z0, 12.25, matKGreyLight);
  k.box(18, 19.75, .75, 1.5, r.z0, 12.25, matKWhite);
  k.box(18, 19.75, 1.5, 1.75, r.z0, 12, matKGreyDark);
  k.box(19.75, 20.25, .75, 1, 11, 12, matKGreyLight);                 // output tray
  // a grey crate with a yellow lid
  k.box(20.5, 21.25, 0, .5, 11, 11.75, matKGrey);
  k.box(20.5, 21.25, .5, .75, 11, 11.75, matKYellow);
  cabinet(k, 21.5, wx1, r.z0, 11.75, 0, 2.75, matKWhite);
  // wall shelf with cardboard trays, and the photo print beside it
  k.box(wx0, 18, 2.5, 2.75, 13, 15, matKWhite);
  k.box(wx0, 18, 2.75, 3, 13.25, 14, matKDeskTop);
  k.box(wx0, 18, 2.75, 3.25, 14.25, 14.75, matKDeskTop);
  pixelPanel(k, wx0, 12, 'e', 1.75, VS, [
    'wwwwww',
    'wddmdw',
    'wmdddw',
    'wdptdw',
    'wpdtpw',
    'wdmddw',
    'wttptw',
    'wwwwww',
  ], { w: matKWhite, d: matKWoodDark, m: matKOrange, p: matKPot, t: matKDeskTop });
  led(k, 20.5, 14);
}

/* ============================ the toilet blocks ============================ */
// Off the atrium: a slate passage with an aluminium coat rack over a white
// access hatch on its end wall, then a washroom with one basin and two WC
// cubicles each side. The sanitary rooms have large grey floor tiles.
function toiletLobby(k: Kit) {
  const r = room('toilet_lobby');                    // x 10.25 … 16 (shaft wall), z 4.75 … 9.25
  const ex = 16;                                     // the end wall, in front of the duct shaft
  k.box(ex - .5, ex, 2.75, 3, 5.25, 8.75, matKSteel);                  // hat shelf / rail
  for (let z = 5.5; z < 8.75; z += .5) k.box(ex - .5, ex - .25, 2.5, 2.75, z, z + VS, matKGrey);  // hangers
  panel(k, ex, 7.75, 'w', 2, VS, 1.5, matKWhite);                       // access hatch
  led(k, 12.75, (r.z0 + r.z1) / 2 + .25);
}

/* the two washrooms: one basin, a mirror over it, on the wall opposite the cubicle doors */
function washrooms(k: Kit) {
  for (const [id, z, dir] of [['washroom_N', 4.25, 'n'], ['washroom_S', 9.75, 's']] as [string, number, Dir][]) {
    const r = room(id);                              // N: z 1 … 4.25, S: z 9.75 … 13
    k.paintRect(r.x0, r.x1, r.z0, r.z1, matKGrey);
    basin(k, 14.875, z + (dir === 'n' ? -.375 : .375), dir, 0);
    panel(k, 14.875, z, dir, 1.25, 1.5, 2.75, matKSteel);
  }
}

/* the four WC cubicles: one pan each, cistern on the wall facing the door */
function wcs(k: Kit) {
  for (const [id, cx, cz, dir] of [
    ['wc_N1', 11.75, -1.625, 's'], ['wc_N2', 15.75, -1.625, 's'],
    ['wc_S1', 11.75, 15.625, 'n'], ['wc_S2', 15.75, 15.625, 'n'],
  ] as [string, number, number, Dir][]) {
    const r = room(id);
    k.paintRect(r.x0, r.x1, r.z0, r.z1, matKGrey);
    toilet(k, cx, cz, dir, 0);
  }
}

export function buildGroundEast(k: Kit): void {
  kantoorN(k);
  magazijn(k);
  kantoorNE(k);
  kantoorSE(k);
  corridorE(k);
  receptie(k);
  achterruimte(k);
  toiletLobby(k);
  washrooms(k);
  wcs(k);
}
