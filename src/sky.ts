/* ============================ sky & image-based light ============================ */
// The single biggest reason the maps used to read as painted cardboard: there
// was no `scene.environment`. Every MeshStandardMaterial got its light from one
// sun and one hemisphere term and nothing else — no sky ambient, no indirect
// specular. Metalness had nothing to reflect, so anything metal came out
// near-black, and every surface facing away from the sun went flat.
//
// This module fixes that without adding a single asset. It renders a Preetham
// atmosphere (three's Sky addon, with procedural clouds since r183), and bakes
// that same sky into a pre-filtered environment map. One sun vector then drives
// three things at once — the visible sky, the DirectionalLight, and the ambient
// — so they can never disagree.
//
// The bake happens once per map. The world and the sun are static, so there is
// no per-frame cost beyond the env-map taps the standard shader already does.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { renderer, scene, REVERSED_DEPTH } from './core';

/* Build a Sky whose depth convention matches the renderer's.
   three's own Sky addon is not reverse-Z aware. Its vertex shader ends with
   `gl_Position.z = gl_Position.w;` — after the perspective divide that is depth
   1.0, which is the far plane in a standard buffer and the NEAR plane under
   reverse-Z. Left alone with reversedDepthBuffer on, the sky paints over the
   entire map and the world simply disappears behind it. Under reverse-Z the far
   plane is 0.0, so that is what we pin it to. */
function makeSky() {
  const s = new Sky();
  if (REVERSED_DEPTH) {
    const m = s.material as THREE.ShaderMaterial;
    m.vertexShader = m.vertexShader.replace('gl_Position.z = gl_Position.w;', 'gl_Position.z = 0.0;');
    m.needsUpdate = true;
  }
  return s;
}

/* What a map asks the sky to look like. Turbidity/rayleigh set the haze and how
   blue the zenith reads; the cloud group is a no-op at coverage 0, which is what
   the desert wants. */
export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudScale: number;
  cloudSpeed: number;
  cloudElevation: number;
}

/* ============================ the visible sky ============================ */
// Huge, so it reads as infinitely far away. BackSide + depthWrite:false is the
// addon's own setup; fog is off, so scene fog never tints it — the fog colour
// has to be matched to the horizon by hand in each map's env.
export const sky = makeSky();
sky.scale.setScalar(450000);
sky.renderOrder = -3;
sky.frustumCulled = false;
scene.add(sky);

function applyParams(target: Sky, p: SkyParams) {
  const u = target.material.uniforms;
  u.turbidity.value = p.turbidity;
  u.rayleigh.value = p.rayleigh;
  u.mieCoefficient.value = p.mieCoefficient;
  u.mieDirectionalG.value = p.mieDirectionalG;
  u.cloudCoverage.value = p.cloudCoverage;
  u.cloudDensity.value = p.cloudDensity;
  u.cloudScale.value = p.cloudScale;
  u.cloudSpeed.value = p.cloudSpeed;
  u.cloudElevation.value = p.cloudElevation;
}

/* Point the sky at a sun direction. The shader normalizes `sunPosition`, so a
   unit vector is fine — and it is the same vector the caller should hand the
   DirectionalLight. */
export function setSky(p: SkyParams, dir: THREE.Vector3) {
  applyParams(sky, p);
  sky.material.uniforms.sunPosition.value.copy(dir);
}

/* ============================ the baked environment ============================ */
let envRT: THREE.WebGLRenderTarget | null = null;

/* Bake the current sky into scene.environment.
   Two gotchas here, both of which fail silently rather than loudly:

   1. SCALE. Sky is a unit BoxGeometry that every example scales to 450000. At
      that size its faces sit far outside PMREM's cube camera (near 0.1, far
      100), so you would bake an empty sky — and because the mesh isn't frustum
      culled, nothing warns you. So the bake uses its own small copy in its own
      scene, well inside that frustum.

   2. THE SUN DISC OVERFLOWS FP16. The shader drives disc radiance to ~7.6e5
      against a half-float ceiling of 65504. In PMREM's HalfFloat target that
      becomes Inf, and the blur convolution then smears NaN across the mips as
      black or blown blotches. Killing the disc for the bake avoids it, and is
      the right call regardless: a point that bright should not dominate the
      irradiance. The visible sky keeps its disc. */
export function bakeEnvironment(p: SkyParams, dir: THREE.Vector3) {
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envSky.scale.setScalar(10);                       // gotcha 1
  applyParams(envSky, p);
  envSky.material.uniforms.sunPosition.value.copy(dir);
  envSky.material.uniforms.showSunDisc.value = 0;   // gotcha 2
  envScene.add(envSky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  const rt = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 256 });
  pmrem.dispose();

  envSky.geometry.dispose();
  envSky.material.dispose();

  // Swap, then drop the old one — a map rotation every round would otherwise
  // leak a cubeUV target per round.
  envRT?.dispose();
  envRT = rt;
  scene.environment = rt.texture;
  return rt;
}

export function disposeEnvironment() {
  envRT?.dispose();
  envRT = null;
  scene.environment = null;
}
