/* ============================ GPU particle bursts ============================ */
// Impact debris, and later anything else that throws a handful of specks around.
//
// The naive version of this is one Sprite per speck, which means one draw call
// per speck: four specks per bullet at ten rounds a second is a draw-call storm
// exactly when the frame budget is tightest. So this is a single THREE.Points
// with a custom shader instead — ONE draw call for every particle alive in the
// world, however many that is.
//
// The CPU never animates anything. On spawn it writes a slot's origin, velocity,
// colour and start time; from then on the vertex shader derives the position from
// `uTime` with plain ballistics. That means a burst costs a few attribute writes
// and nothing per frame.
import * as THREE from 'three';
import { scene } from './core';

const COUNT = 512;          // hard ceiling on simultaneous specks
const LIFE = 0.85;          // seconds; also the recycle horizon
const GRAVITY = 14;

let time = 0;

const origin = new Float32Array(COUNT * 3);
const vel = new Float32Array(COUNT * 3);
const colour = new Float32Array(COUNT * 3);
const start = new Float32Array(COUNT);
const seed = new Float32Array(COUNT);
// Every slot starts long-expired so nothing shows until it is actually spawned.
start.fill(-1000);
for (let i = 0; i < COUNT; i++) seed[i] = Math.random();

const geo = new THREE.BufferGeometry();
const aOrigin = new THREE.BufferAttribute(origin, 3);
const aVel = new THREE.BufferAttribute(vel, 3);
const aColour = new THREE.BufferAttribute(colour, 3);
const aStart = new THREE.BufferAttribute(start, 1);
geo.setAttribute('position', aOrigin);           // named `position` so three is happy
geo.setAttribute('aVel', aVel);
geo.setAttribute('aColour', aColour);
geo.setAttribute('aStart', aStart);
geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

const mat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uLife: { value: LIFE },
    uGravity: { value: GRAVITY },
    uSize: { value: 46 },
  },
  vertexShader: /* glsl */`
    attribute vec3 aVel;
    attribute vec3 aColour;
    attribute float aStart;
    attribute float aSeed;
    uniform float uTime, uLife, uGravity, uSize;
    varying vec3 vColour;
    varying float vFade;
    void main(){
      float age = uTime - aStart;
      if (age < 0.0 || age > uLife) {
        // Park dead slots outside clip space; cheaper than any branch downstream.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vFade = 0.0;
        return;
      }
      vec3 p = position + aVel * age;
      p.y -= 0.5 * uGravity * age * age;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float t = age / uLife;
      // Shrink as they die, and scale with distance so specks read at any range.
      gl_PointSize = uSize * (0.45 + aSeed * 0.55) * (1.0 - t * 0.55) / max(-mv.z, 0.5);
      vColour = aColour;
      vFade = 1.0 - t * t;                 // hold, then drop away quickly
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColour;
    varying float vFade;
    void main(){
      // Round speck with a soft edge — no texture needed.
      vec2 q = gl_PointCoord - 0.5;
      float d = dot(q, q);
      if (d > 0.25) discard;
      float a = smoothstep(0.25, 0.05, d) * vFade;
      gl_FragColor = vec4(vColour, a);
    }`,
});

const points = new THREE.Points(geo, mat);
// Positions are derived in the shader, so any bounding volume three computes from
// the origin attribute is a lie and would cull live bursts.
points.frustumCulled = false;
points.renderOrder = 3;
scene.add(points);

let next = 0;

/* Throw `n` specks from `pos`, biased along `dir` (the surface normal) inside a
   cone. `spread` widens the cone, `speed` scales the throw. */
export function burst(
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  col: THREE.Color,
  n = 6,
  speed = 3.4,
  spread = 0.85,
) {
  let lo = COUNT, hi = 0;
  for (let k = 0; k < n; k++) {
    const i = next; next = (next + 1) % COUNT;
    if (i < lo) lo = i;
    if (i > hi) hi = i;

    origin[i * 3] = pos.x; origin[i * 3 + 1] = pos.y; origin[i * 3 + 2] = pos.z;

    // Random direction, pulled toward the surface normal — debris sprays out of
    // the hit rather than in a tidy fan.
    const a = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const s = speed * (0.45 + Math.random() * 0.9);
    vel[i * 3]     = (Math.cos(a) * r * spread + dir.x) * s;
    vel[i * 3 + 1] = (z * spread + dir.y) * s + 1.1;      // a little lift
    vel[i * 3 + 2] = (Math.sin(a) * r * spread + dir.z) * s;

    const v = 0.78 + Math.random() * 0.44;                // per-speck value jitter
    colour[i * 3]     = col.r * v;
    colour[i * 3 + 1] = col.g * v;
    colour[i * 3 + 2] = col.b * v;

    start[i] = time;
  }

  // A burst almost always lands in one contiguous run; uploading just that run
  // keeps this off the "re-send the whole buffer" path.
  if (lo <= hi) {
    aOrigin.addUpdateRange(lo * 3, (hi - lo + 1) * 3); aOrigin.needsUpdate = true;
    aVel.addUpdateRange(lo * 3, (hi - lo + 1) * 3); aVel.needsUpdate = true;
    aColour.addUpdateRange(lo * 3, (hi - lo + 1) * 3); aColour.needsUpdate = true;
    aStart.addUpdateRange(lo, hi - lo + 1); aStart.needsUpdate = true;
  } else {
    aOrigin.needsUpdate = aVel.needsUpdate = aColour.needsUpdate = aStart.needsUpdate = true;
  }
}

export function updateParticles(dt: number) {
  time += dt;
  mat.uniforms.uTime.value = time;
}
