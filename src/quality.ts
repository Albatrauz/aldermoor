/* ============================ frame budget ============================ */
// A dev-facing frame-time monitor. The graphics work this exists to support is
// a series of trades — shadow resolution against sharpness, an env map against
// ambient quality — and none of those trades can be judged by eye. So: sample
// every frame, keep a short rolling window, and report it alongside the draw
// counts three already tracks.
//
// Toggle the overlay with the backquote key, or drive it from the console via
// `__town.perf()`. Nothing here runs any GPU work of its own; `renderer.info`
// is bookkeeping the renderer maintains regardless.
import { renderer } from './core';

const N = 120;                       // ~2s of history at 60fps
const times = new Float32Array(N);
let idx = 0, filled = 0;

// Sampled once per frame, after the render call — `renderer.info.render` resets
// itself at the start of each render, so reading it earlier reports last frame.
let calls = 0, tris = 0;

export function sample(dt: number) {
  times[idx] = dt * 1000;
  idx = (idx + 1) % N;
  if (filled < N) filled++;
  calls = renderer.info.render.calls;
  tris = renderer.info.render.triangles;
  if (overlay) paint();
}

export function stats() {
  let sum = 0, worst = 0;
  for (let i = 0; i < filled; i++) {
    const t = times[i];
    sum += t;
    if (t > worst) worst = t;
  }
  const ms = filled ? sum / filled : 0;
  return {
    ms: +ms.toFixed(2),
    fps: ms ? +(1000 / ms).toFixed(1) : 0,
    worstMs: +worst.toFixed(2),
    calls,
    tris,
    // Programs is the one to watch when pooling lights: if it climbs while
    // firing, the light count is still moving and shaders are recompiling.
    programs: renderer.info.programs?.length ?? 0,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
  };
}

/* --- the overlay --- */
let overlay: HTMLElement | null = null;

function paint() {
  const s = stats();
  overlay.textContent =
    `${s.fps} fps   ${s.ms} ms   worst ${s.worstMs}\n` +
    `${s.calls} calls   ${(s.tris / 1000).toFixed(1)}k tris\n` +
    `${s.programs} programs   ${s.textures} tex   ${s.geometries} geo`;
}

export function showPerf(on = true) {
  if (on && !overlay) {
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;left:14px;bottom:14px;z-index:60;pointer-events:none;' +
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;' +
      'color:#e9d8b0;background:rgba(10,7,4,.6);border:1px solid rgba(216,169,72,.22);' +
      'padding:7px 10px;border-radius:3px;letter-spacing:.02em';
    document.body.appendChild(overlay);
    paint();
  } else if (!on && overlay) {
    overlay.remove();
    overlay = null;
  }
  return !!overlay;
}

export function togglePerf() { return showPerf(!overlay); }

addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') togglePerf();
});
