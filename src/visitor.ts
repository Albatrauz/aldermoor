/* ============================ visitor camera ============================ */
// A bird's-eye camera over whatever map is loaded, and the one capture path that
// turns that view into a bitmap. It stays off the player camera on purpose: the
// first-person view (and the gun parented to it) must not move to take a plate,
// and a later minimap or analysis pass calls the same framing.
//
// Orthographic, so a metre is the same number of pixels everywhere — the property
// a map overlay actually wants. North (+Z) is up. East (+X) falls on the left of
// a raw render of this camera and on the right of a saved plate; see frameVisitor.
// The camera draws VISITOR_LAYER only; see core.ts for what sits on it.
import * as THREE from 'three';
import { renderer, scene, camera as eyeCam, REVERSED_DEPTH, VISITOR_LAYER } from './core';
import { sun, currentMapName, mapLabel, MAP_ORDER, setMap, markVisitorLayer } from './world';
import { worldSpan, flushMeshes, type WorldSpan } from './voxel';

const PLATE = 2048;   // default plate, px. ~6 px/m across the wider map
const LIFT = 4;       // metres of air between the tallest voxel and the camera
const PAD = 0.04;     // extra frame around the world span, as a fraction of each axis

export const visitorCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 800);
visitorCam.name = 'visitor';
visitorCam.rotation.order = 'YXZ';
visitorCam.up.set(0, 0, 1);          // north. Straight down is parallel to the default up.
visitorCam.layers.set(VISITOR_LAYER);

// The renderer flips a camera into reversed depth on its first draw, but the
// frustum for that draw was already built from the unflipped projection — so a
// one-shot plate would cull the map. Match the eye camera (and the sky shader,
// which pins itself to the far plane under REVERSED_DEPTH) before framing.
function syncDepth() {
  const reversed = eyeCam.reversedDepth || REVERSED_DEPTH;
  const cam = visitorCam as THREE.OrthographicCamera & { _reversedDepth: boolean };
  if (cam._reversedDepth !== reversed) cam._reversedDepth = reversed;
}

export interface VisitorFrame {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  cx: number; cz: number;
  // Metres across the framed view. Divide by the plate size for a scale.
  spanX: number; spanZ: number;
}

export interface CaptureOptions {
  width?: number;
  height?: number;
  pad?: number;
}

export interface MapPlate {
  name: string;
  label: string;
  width: number;
  height: number;
  // PNG data URL, sRGB, north up, east right.
  url: string;
}

function plateSize(opts?: CaptureOptions) {
  return {
    width: Math.max(1, Math.floor(opts?.width ?? PLATE)),
    height: Math.max(1, Math.floor(opts?.height ?? PLATE)),
    pad: opts?.pad ?? PAD,
  };
}

/** Aim the visitor camera straight down at the live world and fit it in a view
    of the given aspect (width/height in pixels). Returns the frame, or null
    before a map exists. Call this before rendering the camera yourself. */
export function frameVisitor(width: number, height: number, pad = PAD): VisitorFrame | null {
  markVisitorLayer();
  const span = worldSpan();
  if (!span) return null;
  syncDepth();

  const cx = (span.minX + span.maxX) / 2;
  const cz = (span.minZ + span.maxZ) / 2;
  let spanX = (span.maxX - span.minX) * (1 + pad);
  let spanZ = (span.maxZ - span.minZ) * (1 + pad);
  const aspect = width / height;
  if (spanX / spanZ > aspect) spanZ = spanX / aspect;
  else spanX = spanZ * aspect;

  const y = span.maxY + LIFT;
  visitorCam.position.set(cx, y, cz);
  visitorCam.up.set(0, 0, 1);
  visitorCam.lookAt(cx, span.minY, cz);
  // lookAt's basis is right-handed, so with north as up the camera's local +X
  // points west: east lands on the left of a render of this camera. Mirroring
  // the projection (or the camera scale) also flips triangle winding, and the
  // culling frustum then drops the chunks. The plate flips pixels instead —
  // see pngFromBuffer — so the bitmap reads east-right. A caller drawing
  // visitorCam into their own target can mirror U the same way.
  const halfW = spanX / 2, halfH = spanZ / 2;
  visitorCam.left = -halfW;
  visitorCam.right = halfW;
  visitorCam.top = halfH;
  visitorCam.bottom = -halfH;
  visitorCam.near = 0.5;
  visitorCam.far = (y - span.minY) + 2;
  visitorCam.updateProjectionMatrix();
  visitorCam.updateMatrixWorld();

  return { ...span, cx, cz, spanX, spanZ };
}

/* The sun's shadow box is sized for a player standing near the origin. A plate
   of the whole map runs off the end of it, so the bake is widened for the one
   render and put back — the next frame rebakes the gameplay frustum. */
function withMapShadows(span: WorldSpan, draw: () => void) {
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  const saved = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom };
  const reach = Math.max(span.maxX - span.minX, span.maxZ - span.minZ) * 0.65 + 8;
  cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  try {
    draw();
  } finally {
    cam.left = saved.left; cam.right = saved.right; cam.top = saved.top; cam.bottom = saved.bottom;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }
}

/* Offscreen targets in this three are written in linear working space, so an
   8-bit render target posterizes the shadows. The drawing buffer is the path
   that applies the same tone map and sRGB conversion as the frame on screen.
   The resize is undone before we return; the following frame redraws the eye. */
const _size = new THREE.Vector2();
const _clear = new THREE.Color();

function withPlateBuffer(width: number, height: number, draw: () => void) {
  renderer.getSize(_size);
  const ratio = renderer.getPixelRatio();
  const fog = scene.fog as THREE.FogExp2 | null;
  renderer.getClearColor(_clear);
  const alpha = renderer.getClearAlpha();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  if (fog) renderer.setClearColor(fog.color, 1);
  try {
    draw();
  } finally {
    renderer.setClearColor(_clear, alpha);
    renderer.setSize(_size.x, _size.y, false);
    renderer.setPixelRatio(ratio);
  }
}

let pixels = new Uint8Array(0);
let sheet: HTMLCanvasElement | null = null;

function pngFromBuffer(): { url: string; width: number; height: number } {
  const gl = renderer.getContext();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const n = width * height * 4;
  if (pixels.length !== n) pixels = new Uint8Array(n);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  if (!sheet) sheet = document.createElement('canvas');
  sheet.width = width; sheet.height = height;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('visitor: 2d canvas unavailable');
  const img = ctx.createImageData(width, height);
  const row = width * 4;
  // WebGL is bottom-up; flip that. Also swap each row left-to-right so east,
  // which the right-handed lookAt puts on the left, ends up on the right.
  const data = img.data;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row;
    const dst = y * row;
    for (let x = 0; x < width; x++) {
      const s = src + (width - 1 - x) * 4;
      const d = dst + x * 4;
      data[d] = pixels[s];
      data[d + 1] = pixels[s + 1];
      data[d + 2] = pixels[s + 2];
      data[d + 3] = pixels[s + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: sheet.toDataURL('image/png'), width, height };
}

function shoot(opts?: CaptureOptions): MapPlate | null {
  const { width, height, pad } = plateSize(opts);
  flushMeshes();
  const frame = frameVisitor(width, height, pad);
  if (!frame) return null;
  let plate: MapPlate | null = null;
  withMapShadows(frame, () => {
    withPlateBuffer(width, height, () => {
      renderer.setRenderTarget(null);
      renderer.render(scene, visitorCam);
      const png = pngFromBuffer();
      plate = {
        name: currentMapName,
        label: mapLabel(),
        width: png.width,
        height: png.height,
        url: png.url,
      };
    });
  });
  if (plate) console.info(`visitor: ${plate.name} ${plate.width}×${plate.height}`);
  return plate;
}

/** Plate the named map, or the one currently loaded. Switching maps rebuilds
    that map; the call leaves it loaded. */
export function captureMap(name?: string, opts?: CaptureOptions): MapPlate | null {
  if (name !== undefined && name !== currentMapName) {
    if (!MAP_ORDER.includes(name)) { console.warn('visitor: unknown map', name); return null; }
    setMap(name);
  }
  return shoot(opts);
}

/** Plate every map in the rotation (or `opts.maps`) and restore the map that
    was up. Rebuilding a map discards damage that was on it. */
export function captureMaps(opts?: CaptureOptions & { maps?: readonly string[] }): MapPlate[] {
  const back = currentMapName;
  const names = opts?.maps ?? MAP_ORDER;
  const plates: MapPlate[] = [];
  try {
    for (const name of names) {
      const plate = captureMap(name, opts);
      if (plate) plates.push(plate);
    }
  } finally {
    if (currentMapName !== back) setMap(back);
    const { width, height, pad } = plateSize(opts);
    frameVisitor(width, height, pad);
  }
  return plates;
}

/** Download a plate as `<map>-top.png`. */
export function savePlate(plate: MapPlate) {
  const a = document.createElement('a');
  a.href = plate.url;
  a.download = `${plate.name}-top.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
