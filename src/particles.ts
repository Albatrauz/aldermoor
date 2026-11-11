/* ============================ GPU particle bursts ============================ */
// Impact debris, grenade sparks and the dirt a blast throws up.
//
// The naive version of this is one Sprite per speck, which means one draw call
// per speck: four specks per bullet at ten rounds a second is a draw-call storm
// exactly when the frame budget is tightest. So this is a single THREE.Points
// with a custom shader instead — ONE draw call for every particle alive in the
// world, however many that is.
//
// The CPU never animates anything. On spawn it writes a slot's origin, velocity,
// colour, start time and lifespan; from then on the vertex shader derives the
// position from `uTime` with plain ballistics (plus linear air drag, which has a
// closed form too). That means a burst costs a few attribute writes and nothing
// per frame.
//
// Two kinds of speck share the one draw:
//   - dust and grit (the default): a round, alpha-blended speck, exactly what a
//     bullet impact has always thrown;
//   - HOT specks: sparks and embers. These are additive and drawn as a short
//     streak along their own screen-space motion — a point sprite stretched into
//     a capsule — so a fast spark reads as a scratch of light rather than a dot,
//     and shrinks back to a dot as drag slows it.
// One blend mode serves both: the shader writes premultiplied colour and puts
// the "how much does this cover what is behind it" into alpha. Alpha 0 with
// colour > 0 is pure addition; alpha = coverage is ordinary over-blending.
import * as THREE from 'three';
import { scene, renderer } from './core';

const COUNT = 1536;         // hard ceiling on simultaneous specks (~3 grenades + a firefight)
const LIFE = 0.85;          // seconds; the default lifespan of an impact speck
const GRAVITY = 14;
const STREAK = 0.03;        // seconds of travel a hot streak trails behind its head

let time = 0;

const origin = new Float32Array(COUNT * 3);
const vel = new Float32Array(COUNT * 3);
const colour = new Float32Array(COUNT * 3);
// start, life, drag, hot — packed so a burst re-uploads one attribute, not four
const meta = new Float32Array(COUNT * 4);
// size seed, size multiplier, gravity multiplier
const shape = new Float32Array(COUNT * 3);
// Every slot starts long-expired so nothing shows until it is actually spawned.
for (let i = 0; i < COUNT; i++) {
  meta[i * 4] = -1000; meta[i * 4 + 1] = LIFE;
  shape[i * 3] = Math.random(); shape[i * 3 + 1] = 1; shape[i * 3 + 2] = 1;
}

const geo = new THREE.BufferGeometry();
const aOrigin = new THREE.BufferAttribute(origin, 3);
const aVel = new THREE.BufferAttribute(vel, 3);
const aColour = new THREE.BufferAttribute(colour, 3);
const aMeta = new THREE.BufferAttribute(meta, 4);
const aShape = new THREE.BufferAttribute(shape, 3);
geo.setAttribute('position', aOrigin);           // named `position` so three is happy
geo.setAttribute('aVel', aVel);
geo.setAttribute('aColour', aColour);
geo.setAttribute('aMeta', aMeta);
geo.setAttribute('aShape', aShape);

// A streak is one point sprite, and the GPU caps how big a point may be. Ask
// rather than assume: past the cap the sprite is silently clamped and the
// capsule drawn inside it would be cut off square.
const gl = renderer.getContext();
const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
const MAX_PT = Math.max(8, Math.min(160, pointRange ? pointRange[1] : 64));

const mat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: {
    uTime: { value: 0 },
    uGravity: { value: GRAVITY },
    uSize: { value: 46 },
    uStreak: { value: STREAK },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMaxPt: { value: MAX_PT },
  },
  vertexShader: /* glsl */`
    attribute vec3 aVel;
    attribute vec3 aColour;
    attribute vec4 aMeta;     // start, life, drag, hot
    attribute vec3 aShape;    // size seed, size, gravity scale
    uniform float uTime, uGravity, uSize, uStreak, uMaxPt;
    uniform vec2 uRes;
    varying vec3 vColour;
    varying float vFade;
    varying float vHot;
    varying vec2 vDir;        // screen direction from head to tail
    varying vec2 vShape;      // half-length of the streak's core, radius — both in point-sprite units

    // Ballistics with linear drag: v' = -k v - g. Closed form, so any age can be
    // evaluated directly — which is what lets the streak look back in time.
    vec3 at(float age){
      float k = aMeta.z, g = uGravity * aShape.z;
      if (k < 1e-3) {
        vec3 p = position + aVel * age;
        p.y -= 0.5 * g * age * age;
        return p;
      }
      float e = (1.0 - exp(-k * age)) / k;
      vec3 p = position + aVel * e;
      p.y -= g / k * (age - e);
      return p;
    }

    void main(){
      float age = uTime - aMeta.x;
      float life = aMeta.y;
      vHot = 0.0; vDir = vec2(1.0, 0.0); vShape = vec2(0.0, 0.5);
      if (age < 0.0 || age > life) {
        // Park dead slots outside clip space; cheaper than any branch downstream.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vFade = 0.0;
        return;
      }
      float t = age / life;
      vec4 mv = modelViewMatrix * vec4(at(age), 1.0);
      vec4 clip = projectionMatrix * mv;
      float depth = max(-mv.z, 0.5);

      if (aMeta.w < 0.5) {
        // Dust and grit. Shrink as they die, and scale with distance so specks
        // read at any range.
        gl_Position = clip;
        gl_PointSize = uSize * aShape.y * (0.45 + aShape.x * 0.55) * (1.0 - t * 0.55) / depth;
        vColour = aColour;
        vFade = 1.0 - t * t;                 // hold, then drop away quickly
        return;
      }

      // A hot speck: find where it was uStreak ago on screen, and stretch the
      // sprite over both ends. Width shrinks as it cools.
      float w = max(1.5, uSize * aShape.y * (0.5 + aShape.x * 0.5) * (1.0 - t * 0.75) / depth);
      vec4 tail = projectionMatrix * (modelViewMatrix * vec4(at(max(0.0, age - uStreak)), 1.0));
      vec2 head = clip.xy / clip.w * 0.5 * uRes;
      vec2 d = vec2(0.0);
      if (clip.w > 0.05 && tail.w > 0.05) d = tail.xy / tail.w * 0.5 * uRes - head;
      float len = length(d);
      vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
      w = min(w, uMaxPt);
      len = min(len, uMaxPt - w);
      float size = len + w;
      vec2 mid = head + dir * (len * 0.5);
      gl_Position = vec4(mid / (0.5 * uRes) * clip.w, clip.z, clip.w);
      gl_PointSize = size;
      vDir = dir;
      vShape = vec2(0.5 * len / size, 0.5 * w / size);
      // white-yellow as thrown, through orange, to a dull red as it dies
      vec3 c = mix(aColour, vec3(1.0, 0.42, 0.08), smoothstep(0.0, 0.45, t));
      vColour = mix(c, vec3(0.55, 0.08, 0.02), smoothstep(0.45, 1.0, t));
      vFade = 1.0 - smoothstep(0.55, 1.0, t);
      vHot = 1.0;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColour;
    varying float vFade;
    varying float vHot;
    varying vec2 vDir;
    varying vec2 vShape;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      if (vHot < 0.5) {
        // Round speck with a soft edge — no texture needed.
        float d = dot(q, q);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.05, d) * vFade;
        gl_FragColor = vec4(vColour * a, a);
        return;
      }
      // A capsule along vDir. gl_PointCoord runs top-down; screen space bottom-up.
      q.y = -q.y;
      float along = dot(q, vDir);
      float across = dot(q, vec2(-vDir.y, vDir.x));
      float c = clamp(along, -vShape.x, vShape.x);
      float d = length(vec2(along - c, across)) / max(vShape.y, 1e-4);
      if (d > 1.0) discard;
      float a = (1.0 - d * d) * vFade;
      // the head (where it is now) burns brightest; the trail behind it cools
      float k = vShape.x > 1e-4 ? c / vShape.x * 0.5 + 0.5 : 0.0;
      a *= mix(1.0, 0.3, k);
      gl_FragColor = vec4(vColour * a, 0.0);   // alpha 0: pure addition
    }`,
});

const points = new THREE.Points(geo, mat);
// Positions are derived in the shader, so any bounding volume three computes from
// the origin attribute is a lie and would cull live bursts.
points.frustumCulled = false;
points.renderOrder = 3;
scene.add(points);

let next = 0;

/* Optional shaping for a burst. Everything defaults to what a bullet impact has
   always thrown, so `burst(pos, dir, col, n)` is unchanged. */
export interface BurstOpts {
  life?: number;      // seconds — the longest a speck lives (default 0.85)
  lifeMin?: number;   // the shortest; each speck picks between the two
  drag?: number;      // linear air drag, 1/s — a spark slows and hangs instead of arcing forever
  hot?: boolean;      // additive streak that cools from `col` through orange to red
  size?: number;      // multiplier on the speck's on-screen size
  gravity?: number;   // multiplier on gravity
  lift?: number;      // extra upward speed, m/s (default 1.1)
}
const NO_OPTS: BurstOpts = {};

/* Throw `n` specks from `pos`, biased along `dir` (the surface normal) inside a
   cone. `spread` widens the cone, `speed` scales the throw. */
export function burst(
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  col: THREE.Color,
  n = 6,
  speed = 3.4,
  spread = 0.85,
  opts: BurstOpts = NO_OPTS,
) {
  const lifeHi = opts.life ?? LIFE, lifeLo = opts.lifeMin ?? lifeHi;
  const drag = opts.drag ?? 0, hot = opts.hot ? 1 : 0;
  const size = opts.size ?? 1, grav = opts.gravity ?? 1, lift = opts.lift ?? 1.1;
  n = Math.min(n, COUNT);
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
    vel[i * 3 + 1] = (z * spread + dir.y) * s + lift;     // a little lift
    vel[i * 3 + 2] = (Math.sin(a) * r * spread + dir.z) * s;

    const v = hot ? 1 : 0.78 + Math.random() * 0.44;      // per-speck value jitter (sparks start at full heat)
    colour[i * 3]     = col.r * v;
    colour[i * 3 + 1] = col.g * v;
    colour[i * 3 + 2] = col.b * v;

    meta[i * 4]     = time;
    meta[i * 4 + 1] = lifeLo + Math.random() * (lifeHi - lifeLo);
    meta[i * 4 + 2] = drag;
    meta[i * 4 + 3] = hot;
    shape[i * 3]     = Math.random();
    shape[i * 3 + 1] = size;
    shape[i * 3 + 2] = grav;
  }

  // A burst almost always lands in one contiguous run; uploading just that run
  // keeps this off the "re-send the whole buffer" path. (A run that wraps the
  // ring spans lo..hi = nearly everything, which is still correct.)
  if (lo <= hi) {
    const c = hi - lo + 1;
    aOrigin.addUpdateRange(lo * 3, c * 3); aOrigin.needsUpdate = true;
    aVel.addUpdateRange(lo * 3, c * 3); aVel.needsUpdate = true;
    aColour.addUpdateRange(lo * 3, c * 3); aColour.needsUpdate = true;
    aMeta.addUpdateRange(lo * 4, c * 4); aMeta.needsUpdate = true;
    aShape.addUpdateRange(lo * 3, c * 3); aShape.needsUpdate = true;
  }
}

const _res = new THREE.Vector2();
export function updateParticles(dt: number) {
  time += dt;
  mat.uniforms.uTime.value = time;
  // Streaks are measured in framebuffer pixels, so the shader needs the real size.
  mat.uniforms.uRes.value.copy(renderer.getDrawingBufferSize(_res));
}
