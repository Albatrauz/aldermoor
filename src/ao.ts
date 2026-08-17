/* ============================ baked contact occlusion ============================ */
// Boxy procedural geometry floats. The sun casts a hard shadow, but there is no
// ambient occlusion, so a crate meeting the sand and a wall meeting the street
// both read as decals rather than objects standing on something.
//
// The obvious fix — vertex AO — does not fit this world. Every wall is a box
// with eight corners, so occlusion would interpolate linearly across a five
// metre face, and the ground is a single PlaneGeometry with FOUR vertices: there
// is literally nowhere to store the darkening where it matters most.
//
// So we bake it into a texture instead. The world is completely static and the
// map only changes between rounds, which makes this a load-time problem: render
// the map from directly overhead into an offscreen buffer, blur that silhouette,
// and lay it over the ground as a multiply. One extra draw call per frame, no
// per-frame computation at all — versus the 3-6ms a real-time GTAO pass would
// cost for the same effect.
import * as THREE from 'three';
import { renderer, scene } from './core';

const RES = 512;          // texels across the map's longest axis
const BLUR_METRES = 1.6;  // how far occlusion bleeds out from an object's base
const STRENGTH = 0.45;    // 0 = off, 1 = fully black under geometry

let plane: THREE.Mesh | null = null;

/* Separable box blur, run twice — two box passes approximate a gaussian closely
   enough for something this soft, and cost a fraction of a real kernel. */
function blur(src: Float32Array, w: number, h: number, radius: number) {
  let a = src, b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= w) continue;
          s += a[y * w + xx]; n++;
        }
        b[y * w + x] = s / n;
      }
    }
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= h) continue;
          s += b[yy * w + x]; n++;
        }
        a[y * w + x] = s / n;
      }
    }
  }
  return a;
}

/* Bake occlusion for a freshly built map group.
   Called while the group is still parentless — between def.build() and being
   added to the scene — so it can be rendered in isolation without disturbing
   the live scene or having the sky paint over the silhouette. */
export function bakeContactAO(group: THREE.Group) {
  dispose();

  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3(); box.getSize(size);
  const centre = new THREE.Vector3(); box.getCenter(centre);
  const W = size.x, D = size.z;
  if (!(W > 0 && D > 0)) return;

  const w = RES, h = Math.max(1, Math.round(RES * D / W));

  // Everything is drawn flat black against white; we only want the footprint.
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  // The ground plane and the worn paths are part of the group too. If they were
  // captured they would paint the entire map black and the "occlusion" would be
  // a uniform dimming. So the far plane is pulled up to just above the floor:
  // anything below FLOOR_SKIP simply isn't in the bake.
  const FLOOR_SKIP = 0.35;
  const eyeY = box.max.y + 10;
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0.1, eyeY - FLOOR_SKIP);
  // Looking straight down, this `up` makes image +X → world +X and image +Y →
  // world −Z, which is exactly how the overlay plane's UVs will land.
  cam.up.set(0, 0, -1);
  cam.position.set(centre.x, eyeY, centre.z);
  cam.lookAt(centre.x, box.min.y, centre.z);

  const bakeScene = new THREE.Scene();
  bakeScene.add(group);                       // temporarily; caller re-parents after
  bakeScene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(bakeScene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);

  bakeScene.overrideMaterial.dispose();
  bakeScene.remove(group);                    // hand the group back untouched
  rt.dispose();

  // White (255) = open sky, black (0) = something overhead.
  const occ = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) occ[i] = px[i * 4] / 255;

  const radius = Math.max(1, Math.round(BLUR_METRES * (w / W)));
  const soft = blur(occ, w, h, radius);

  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // Remap so full occlusion darkens by STRENGTH rather than going to black —
    // a shadow you cannot see into is a place players disappear.
    const v = Math.round(255 * (1 - (1 - soft[i]) * STRENGTH));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(W, D);
  plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.MultiplyBlending,
    // Both of these are load-bearing, and both fail quietly-ish:
    //   premultipliedAlpha — r185's WebGLState refuses to set a blend func for
    //     MultiplyBlending without it (it logs an error and falls through), so
    //     the overlay ends up on whatever blend mode was last bound and washes
    //     the ground out instead of darkening it.
    //   toneMapped:false — this is a multiplier, not a colour in the scene. Run
    //     it through ACES and the occlusion strength changes with exposure.
    premultipliedAlpha: true,
    toneMapped: false,
    depthWrite: false,
    fog: false,                     // fog already tints what is underneath
  }));
  plane.rotation.x = -Math.PI / 2;
  // Above the worn paths (which sit at y≈0.015–0.03) so it darkens those too,
  // and below anything a player can stand on.
  plane.position.set(centre.x, 0.05, centre.z);
  plane.renderOrder = 1;
  scene.add(plane);
}

export function dispose() {
  if (!plane) return;
  scene.remove(plane);
  plane.geometry.dispose();
  const m = plane.material as THREE.MeshBasicMaterial;
  m.map?.dispose();
  m.dispose();
  plane = null;
}
