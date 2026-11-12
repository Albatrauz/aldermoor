/* ============================ kantoor — the NAC scoreboard ============================ */
// The old NAC scoreboard, stood on the flat roof of the entrance porch between
// the two wings, facing the street. Laid out from photographs of the real one:
//
//   ┌──────────────┬─┐      ╭───╮       ┌──────────────┐
//   │   rb-media   │▒│ [8] │NAC│ [8]   │  shopnotch   │     two sponsor boards
//   │              │▒│ NAC ╰─v─╯ GAST. │              │     either side of a dark
//   └──────────────┴─┘    [88:88]      └──────────────┘     centre with the crest
//    ▕▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▏    the red LED strip
//
// The boards, the strip and the crest are voxels — they stop bullets and break
// like everything else. What is printed on them (the two wordmarks, the crest's
// band and letters, the score digits) is far too fine for 0.25 m voxels, so it
// is drawn into canvases and laid over the voxels as decals (see decals.ts).
//
// Proportions follow the photos, scaled to 13 m across — the porch roof between
// the wings is 15 m. Unlike the building it is not stretched 2.5× in plan: it is
// a sign, and a sign has to keep its aspect to stay legible.
import * as THREE from 'three';
import { type Kit, VS, L1 } from './kit';
import { matKBlack, matKFrame, matKSteel, matKMint, matKLed } from '../../materials';

const W = 13;                // overall width
const X0 = 3 - W / 2;        // its west end: centred on the porch (x −4.5 … 10.5)
const Z = 34.5;              // front face, half a metre behind the wings' front
const D = .5;                // depth of the boards
const B = L1 + .5;           // underside of the LED strip, on short legs off the porch roof

// heights above B
const LED_TOP = 1.25, PANEL_TOP = 3.25;
// the crest, in board-local u (from the west end) and v (above B)
const CREST = { u0: 5.75, u1: 7.25, v1: 4 };

const FONT = '"Avenir Next", "Avenir", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const PX = 256;              // canvas pixels per metre

/* ============================ the voxels ============================ */
function frame(k: Kit) {
  // u/v box on the board, `d0..d1` metres back from the front face (negative = proud of it)
  const bx = (u0: number, u1: number, v0: number, v1: number, d0: number, d1: number, mat: THREE.Material) =>
    k.box(X0 + u0, X0 + u1, B + v0, B + v1, Z - d1, Z - d0, mat);

  // the LED strip: a black frame round an unlit red matrix, split in three
  bx(.25, W - .25, 0, LED_TOP, 0, D, matKBlack);
  bx(.5, W - .5, .25, 1, 0, VS, matKLed);
  for (const u of [5, 9.75]) bx(u, u + VS, .25, 1, 0, VS, matKBlack);

  // the two sponsor boards, black to the top; the rb-media one ends in a narrow
  // pale aqua strip
  for (const [u0, u1] of [[0, 4.25], [8.75, W]]) {
    bx(u0, u1, LED_TOP, PANEL_TOP, 0, D, matKBlack);
  }
  bx(4, 4.25, LED_TOP, PANEL_TOP, 0, VS, matKMint);

  // the dark centre that carries the digits
  bx(4.25, 8.75, LED_TOP, PANEL_TOP, 0, D, matKFrame);

  // the crest: a black shield standing proud of the centre and rising above it,
  // its pointed foot stepped in under the drawn outline so no voxel shows past it
  const { u0, u1, v1 } = CREST;
  bx(u0, u1, 2.5, v1, -VS, D, matKBlack);
  bx(u0 + .25, u1 - .25, 2.25, 2.5, -VS, D, matKBlack);
  bx(u0 + .5, u1 - .5, 2, 2.25, -VS, D, matKBlack);

  // legs down to the porch roof, and a brace back from each
  for (const u of [.75, 6.25, 11.75]) {
    bx(u, u + .5, -.5, 0, 0, D, matKSteel);
    bx(u + .125, u + .375, -.5, -.25, D, D + 1, matKSteel);
  }
}

/* ============================ the pictures ============================ */
function canvas(wm: number, hm: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.round(wm * PX); c.height = Math.round(hm * PX);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(PX, PX);          // draw in metres, y down from the top
  return [c, g];
}

/* Text, sized and placed in metres. Drawn at pixel scale: a sub-pixel font size
   under the metre transform is at the mercy of the browser's text rasteriser. */
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, font: string) {
  g.save();
  g.scale(1 / PX, 1 / PX);
  g.font = font.replace('$', `${size * PX}px`);
  g.fillText(s, x * PX, y * PX);
  g.restore();
}

/* a white lowercase wordmark, as large as fits `maxW` × `maxH`, centred in the canvas */
function wordmark(s: string, wm: number, hm: number, maxW: number, maxH: number) {
  const [c, g] = canvas(wm, hm);
  const font = `600 $ ${FONT}`;
  g.font = font.replace('$', `${maxH * PX}px`);
  const size = maxH * Math.min(1, maxW * PX / g.measureText(s).width);
  g.font = font.replace('$', `${size * PX}px`);
  const xh = g.measureText('x').actualBoundingBoxAscent / PX;
  g.fillStyle = '#f4f4f1'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // centred on the x-height band, which is what the eye takes for the middle of lowercase
  text(g, s, wm / 2, hm / 2 + xh / 2, size, font);
  return c;
}

/* one seven-segment digit in a box `w` × `h` at (x, y): lit segments for `ch`, the rest dimly visible */
const SEGS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', ' ': '',
};
function digit(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ch: string) {
  const t = w * .2, m = h / 2;
  // each segment as a rectangle: [x, y, w, h] within the digit
  const R: Record<string, [number, number, number, number]> = {
    a: [t, 0, w - 2 * t, t], g: [t, m - t / 2, w - 2 * t, t], d: [t, h - t, w - 2 * t, t],
    f: [0, t, t, m - 1.5 * t], b: [w - t, t, t, m - 1.5 * t],
    e: [0, m + t / 2, t, m - 1.5 * t], c: [w - t, m + t / 2, t, m - 1.5 * t],
  };
  const on = SEGS[ch] ?? '';
  for (const s of 'abcdefg') {
    const [sx, sy, sw, sh] = R[s];
    g.fillStyle = on.includes(s) ? '#ff3b1f' : '#4a1410';
    g.fillRect(x + sx + .01, y + sy + .01, sw - .02, sh - .02);
  }
}

/* the centre: a score either side of the crest, its label under it, the clock below the crest */
function centre(wm: number, hm: number) {
  const [c, g] = canvas(wm, hm);
  const box = (x: number, y: number, w: number, h: number) => {
    g.fillStyle = '#0d0d0f'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#2b2d33'; g.lineWidth = .03; g.strokeRect(x, y, w, h);
  };
  // scores: boxes high up either side, labels beneath
  for (const [x, label] of [[.25, 'NAC'], [3.5, 'GAST.']] as [number, string][]) {
    box(x, .15, .75, .85);
    digit(g, x + .17, .25, .41, .65, '0');
    g.fillStyle = '#f4f4f1'; g.textAlign = 'center'; g.textBaseline = 'middle';
    text(g, label, x + .375, 1.2, .19, `700 $ ${FONT}`);
  }
  // the clock, under the crest's point
  box(1.05, 1.32, 2.4, .6);
  const dw = .34, dh = .44, y = 1.4;
  [1.17, 1.6, 2.5, 2.93].forEach((x, i) => digit(g, x, y, dw, dh, '4500'[i]));   // the clock stopped at half time
  g.fillStyle = '#ff3b1f';
  for (const dy of [.12, .3]) g.fillRect(2.21, y + dy, .07, .07);
  return c;
}

/* the crest: a black shield with a pale rim, a yellow band corner to corner, N.A.C. on the band */
function crest(wm: number, hm: number) {
  const [c, g] = canvas(wm, hm);
  // the outline, in metres within the canvas (x 0..wm, y 0..hm from the top)
  const l = .1, r = wm - .1, top = .15, shoulder = 1.25, foot = hm - .1, mid = wm / 2;
  const shield = () => {
    g.beginPath();
    g.moveTo(l + .12, top);
    g.lineTo(r - .12, top);
    g.quadraticCurveTo(r, top, r, top + .12);
    g.lineTo(r, shoulder);
    g.quadraticCurveTo(r, foot - .45, mid, foot);
    g.quadraticCurveTo(l, foot - .45, l, shoulder);
    g.lineTo(l, top + .12);
    g.quadraticCurveTo(l, top, l + .12, top);
    g.closePath();
  };
  shield();
  g.fillStyle = '#c9cbcf'; g.fill();               // the rim
  g.save();
  g.translate(mid, (top + foot) / 2); g.scale(.92, .94); g.translate(-mid, -(top + foot) / 2);
  shield();
  g.fillStyle = '#141416'; g.fill();
  g.clip();
  // the band, from the top right corner down to the lower left, white-edged
  g.translate(mid, (top + foot) / 2 - .1);
  g.rotate(-Math.atan2(foot - top - .5, r - l));
  const bw = .36;
  g.fillStyle = '#f4f4f1'; g.fillRect(-2, -bw / 2 - .04, 4, bw + .08);
  g.fillStyle = '#e8c547'; g.fillRect(-2, -bw / 2, 4, bw);
  g.fillStyle = '#141416'; g.textAlign = 'center'; g.textBaseline = 'middle';
  text(g, 'N . A . C .', 0, .015, .26, '700 $ Georgia, "Times New Roman", serif');
  g.restore();
  return c;
}

/* ============================ assembly ============================ */
export function buildScoreboard(k: Kit) {
  frame(k);
  const tex = (c: HTMLCanvasElement) => new THREE.CanvasTexture(c);
  // a picture on the board's front face, by its board-local extents
  const put = (c: HTMLCanvasElement, u0: number, u1: number, v0: number, v1: number, proud = 0) =>
    k.B.decal({ tex: tex(c), facing: 's', at: Z + proud, a0: X0 + u0, a1: X0 + u1, y0: B + v0, y1: B + v1 });

  put(wordmark('rb-media', 3.75, 2, 3, .72), .25, 4, LED_TOP, PANEL_TOP);
  put(wordmark('shopnotch', 4, 2, 3.5, .72), 8.75, W - .25, LED_TOP, PANEL_TOP);
  put(centre(4.5, 2), 4.25, 8.75, LED_TOP, PANEL_TOP);
  put(crest(2, 2.5), CREST.u0 - .25, CREST.u1 + .25, 1.75, CREST.v1 + .25, VS);
}
