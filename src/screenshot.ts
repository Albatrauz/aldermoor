/* ============================ dev screenshots ============================ */
// Press P while playing (dev server only) to save what the eye camera sees as a
// PNG in ./screenshots — reference material for generating models in the game's
// style. The HUD is DOM, so it is never in the frame; the viewmodel and the
// grenade in hand ride on the camera and are hidden for the one render, since a
// gun across the corner of the picture is the last thing a reference wants.
//
// Loaded from main.ts behind import.meta.env.DEV, so none of this ships. The
// file is written by the Vite dev server (see screenshotSink in vite.config.ts)
// rather than downloaded: no download bar, no "allow multiple downloads" prompt
// and no dropped pointer lock, so shots can be taken in a row mid-game.
import * as THREE from 'three';
import { renderer, scene, camera, canvas } from './core';
import { currentMapName } from './world';
import { introVisible, chatOpen } from './controls';

export interface ScreenshotOptions {
  /** Keep the gun (and a cooking grenade) in the frame. Default false. */
  viewmodel?: boolean;
}

export interface Screenshot {
  /** Path of the saved file, relative to the project root. */
  path: string;
  width: number;
  height: number;
}

/* Draw one frame of the eye camera and copy it out. toBlob snapshots the canvas
   when it is called, so it must follow the render in the same task — the
   drawing buffer is not preserved once the browser has composited it. */
function grab(opts: ScreenshotOptions): Promise<Blob> {
  const hidden: THREE.Object3D[] = [];
  if (!opts.viewmodel) {
    for (const o of camera.children) if (o.visible) { o.visible = false; hidden.push(o); }
  }
  try {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } finally {
    for (const o of hidden) o.visible = true;
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('screenshot: canvas gave no image')),
      'image/png');
  });
}

export async function takeScreenshot(opts: ScreenshotOptions = {}): Promise<Screenshot | null> {
  const el = canvas as HTMLCanvasElement;
  const width = el.width, height = el.height;
  try {
    const blob = await grab(opts);
    const res = await fetch(`/__screenshot?map=${encodeURIComponent(currentMapName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });
    if (!res.ok) throw new Error(`screenshot: dev server said ${res.status}`);
    const { path } = await res.json();
    note(`Saved ${path}`);
    console.info(`screenshot: ${path} ${width}×${height}`);
    return { path, width, height };
  } catch (err) {
    note('Screenshot failed — see console');
    console.warn(err);
    return null;
  }
}

/* --- a line of feedback, bottom-centre; DOM, so never in a later shot --- */
let label: HTMLElement | null = null;
let fade = 0;

function note(text: string) {
  if (!label) {
    label = document.createElement('div');
    label.style.cssText =
      'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;pointer-events:none;' +
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;' +
      'color:#e9d8b0;background:rgba(10,7,4,.6);border:1px solid rgba(216,169,72,.22);' +
      'padding:7px 10px;border-radius:3px;letter-spacing:.02em;transition:opacity .3s';
    document.body.appendChild(label);
  }
  label.textContent = text;
  label.style.opacity = '1';
  clearTimeout(fade);
  fade = window.setTimeout(() => { if (label) label.style.opacity = '0'; }, 2200);
}

addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.repeat || introVisible || chatOpen) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave ⌘P / Ctrl+P to the browser
  takeScreenshot();
});
