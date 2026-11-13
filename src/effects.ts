/* ============================ transient effects & ray tests ============================ */
// Short-lived visuals (tracers, muzzle flashes, powder smoke, damage numbers)
// plus the ray-cast helpers used by the guns to decide what a shot hits.
//
// Everything here is POOLED. A firefight is the one moment the frame budget is
// tightest, and it used to be the one moment we allocated hardest: every shot
// built a BufferGeometry and a LineBasicMaterial for the tracer, two
// SpriteMaterials for the flash and its smoke, and a PointLight — then threw
// them all away a fraction of a second later.
//
// The light was the expensive one, and not for the obvious reason. Adding or
// removing a light changes the scene's light count, which invalidates three's
// shader cache; at the AK's ten rounds a second, every material in view was
// being re-evaluated ten times a second. So the lights below are created once,
// live in the scene forever, and are "off" at intensity 0.
//
// Two rules that keep that working, both load-bearing:
//   - Pooled lights must stay `visible`. WebGLLights counts every PointLight it
//     walks regardless of intensity, but the renderer skips invisible objects
//     outright — hiding one would change the count again and undo the whole point.
//   - Everything else hides with `visible = false`, which is the cheap way to
//     take it out of the draw without touching the light state.
import * as THREE from 'three';
import { scene, camera } from './core';
import { flameTex, smokeTex, impactTex, blastTex } from './textures';
import { IMPACT, surfaceOf, type Surface } from './materials';
import { burst } from './particles';
// A cycle (voxel/index imports this module), but a safe one: floorUnder is only
// called at blast time, never while either module is still loading.
import { floorUnder } from './voxel';

/* ============================ the live list ============================ */
// One record per currently-animating effect. Pooled objects carry a back-pointer
// to their record (`__fx`) so re-taking an object that is still on screen
// restarts it in place rather than queueing a second record against it.
type FxKind = 'fade' | 'light' | 'puff' | 'dmg' | 'tracer';
interface FxRec {
  obj: any;
  kind: FxKind;
  ttl: number;
  t0: number;
  base?: number;
  vx?: number; vy?: number; vz?: number;
  // tracer: the full path, walked by a short bright segment
  ax?: number; ay?: number; az?: number;
  dx?: number; dy?: number; dz?: number;
  len?: number;
}
const live: FxRec[] = [];

function activate(obj, ttl: number, kind: FxKind, extra?: Partial<FxRec>): FxRec {
  let rec: FxRec = obj.__fx;
  if (!rec) { rec = obj.__fx = { obj, kind, ttl, t0: ttl }; live.push(rec); }
  rec.kind = kind; rec.ttl = ttl; rec.t0 = ttl;
  if (extra) Object.assign(rec, extra);
  if (kind !== 'light') obj.visible = true;
  return rec;
}

function retire(rec: FxRec) {
  if (rec.kind === 'light') rec.obj.intensity = 0;   // never hide a pooled light — see header
  else rec.obj.visible = false;
  rec.obj.__fx = null;
}

/* A ring buffer. When the pool is exhausted the oldest effect is recycled,
   which is exactly the behaviour you want in a firefight: the newest shot is
   always the one you see. */
function makePool<T>(n: number, make: (i: number) => T) {
  const items: T[] = [];
  for (let i = 0; i < n; i++) items.push(make(i));
  let next = 0;
  return { items, take(): T { const it = items[next]; next = (next + 1) % n; return it; } };
}

/* ============================ pools ============================ */
const FLASH_I = 26;   // peak muzzle-flash light intensity

const chipGeo = new THREE.PlaneGeometry(1, 1);
const chipMat = new THREE.MeshBasicMaterial({
  map: impactTex,
  transparent: true,
  depthWrite: false,
  // LDR canvas textures, not scene colour. With map exposure at 0.4 these
  // would be ACES'd into the dirt next to the (correctly lit) world.
  toneMapped: false,
  // A chip sits flush on the surface it marks, so it z-fights by construction.
  // The positional nudge along the normal handles most of it; polygonOffset
  // covers the grazing angles where the nudge is foreshortened to nothing.
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

const tracers = makePool(24, () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  // The endpoints are rewritten on every shot, so a cached bounding sphere would
  // be stale and three would cull tracers that are plainly on screen.
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return line;
});

const flashes = makePool(12, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flameTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  s.visible = false;
  scene.add(s);
  return s;
});

const puffs = makePool(24, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: smokeTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  }));
  s.visible = false;
  scene.add(s);
  return s;
});

// Kept small on purpose: these are the lights whose count must never change.
const lights = makePool(4, () => {
  const l = new THREE.PointLight(0xffb050, 0, 9, 2);
  scene.add(l);
  return l;
});

/* Bullet chips. Deliberately NOT DecalGeometry: that projects onto one specific
   mesh's triangles, which means a fresh BufferGeometry per hit and a hard
   dependency on the world staying as separate meshes. Every surface here is an
   axis-aligned box, so the normal is exact and a flat quad sits perfectly on it.
   One shared material, so all 48 chips are one program. */
const chips = makePool(48, () => {
  const m = new THREE.Mesh(chipGeo, chipMat);
  m.visible = false;
  scene.add(m);
  return m;
});

const dmgNumbers = makePool(24, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  s.renderOrder = 12;   // draw over the world, but still depth-tested
  s.visible = false;
  scene.add(s);
  return s;
});

/* ============================ spawners ============================ */
/* A tracer used to appear at full length for 130ms, which reads as a laser beam
   rather than a round in flight. Instead a short bright segment now walks the
   path at speed: the eye reads direction and travel, and at 70 units the whole
   thing is over in well under a fifth of a second. */
const TRACER_SPEED = 420;   // m/s — fast enough to feel ballistic, slow enough to see
const TRACER_LEN = 9;       // length of the visible streak

export function spawnTracer(a, b) {
  const line = tracers.take();
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const rec = activate(line, Math.min(.16, len / TRACER_SPEED + .045), 'tracer', {
    ax: a.x, ay: a.y, az: a.z,
    dx: dx / len, dy: dy / len, dz: dz / len,
    len,
  });
  // Draw the first frame immediately so a shot is never a blank frame.
  stepTracer(rec, 0);
}

function stepTracer(f: FxRec, age: number) {
  const head = Math.min(f.len, age * TRACER_SPEED);
  const tail = Math.max(0, head - TRACER_LEN);
  const p = f.obj.geometry.attributes.position;
  p.setXYZ(0, f.ax + f.dx * tail, f.ay + f.dy * tail, f.az + f.dz * tail);
  p.setXYZ(1, f.ax + f.dx * head, f.ay + f.dy * head, f.az + f.dz * head);
  p.needsUpdate = true;
}

export function spawnFlash(pos, big = 1) {
  const s = flashes.take();
  s.position.copy(pos); s.scale.setScalar(.55 * big);
  activate(s, .07, 'fade');

  const l = lights.take();
  l.position.copy(pos);
  activate(l, .07, 'light');

  const p = puffs.take();
  p.position.copy(pos); p.scale.setScalar(.3);
  // The puff pool is shared with bullet impacts, which tint their dust to the
  // surface colour — reset or a recycled sprite arrives still wearing it.
  p.material.color.setRGB(1, 1, 1);
  activate(p, .7, 'puff');
}

/* ============================ bullet impacts ============================ */
// Shooting a wall used to do nothing at all — no dust, no mark, no feedback that
// the shot even landed. This is the whole reply: a puff of the surface's own
// colour, a spray of specks, and a chip left behind.

const _chipQ = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _col = new THREE.Color();

/* Which face of an axis-aligned box a point sits on. Cheap and exact: the point
   is on the surface already, so the nearest face plane IS the face that was hit. */
const _n = new THREE.Vector3();
export function aabbNormal(p: THREE.Vector3, c: any, out = _n) {
  const loY = c.base ?? 0, hiY = c.h ?? c.top ?? 5;
  const dx = Math.min(Math.abs(p.x - (c.x - c.hx)), Math.abs(p.x - (c.x + c.hx)));
  const dy = Math.min(Math.abs(p.y - loY), Math.abs(p.y - hiY));
  const dz = Math.min(Math.abs(p.z - (c.z - c.hz)), Math.abs(p.z - (c.z + c.hz)));
  if (dx <= dy && dx <= dz) out.set(p.x >= c.x ? 1 : -1, 0, 0);
  else if (dy <= dz) out.set(0, p.y >= (loY + hiY) / 2 ? 1 : -1, 0);
  else out.set(0, 0, p.z >= c.z ? 1 : -1);
  return out;
}

/* `surface` may be passed directly (ground hits) or resolved from the collider's
   material (everything else). */
export function spawnImpact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, chip = true) {
  const spec = IMPACT[surface];
  _col.setHex(spec.dust);

  // dust: the surface's own colour, lifting and spreading
  if (spec.puff > 0.05) {
    const p = puffs.take();
    p.position.copy(point).addScaledVector(normal, .12);
    p.material.color.copy(_col);
    p.scale.setScalar(.22 * spec.puff);
    activate(p, .45, 'puff');
  }

  // specks flying back out of the hit
  burst(point, normal, _col, spec.specks);

  // The mark it leaves — but only on something that stays put. A voxel that can
  // be shot away takes its own damage (a real hole, a scorched rim); a painted
  // chip on it would be left hanging in the air the moment the wall went.
  if (!chip) return;
  const m = chips.take();
  m.position.copy(point).addScaledVector(normal, .014);
  m.quaternion.copy(_chipQ.setFromUnitVectors(_zAxis, normal));
  // Roughly a fist across, including the smudge. Larger than this and it stops
  // reading as a bullet strike and starts reading as scenery damage.
  const s = .085 + Math.random() * .055;
  m.scale.set(s, s, 1);
  m.rotateZ(Math.random() * Math.PI * 2);   // no two chips look alike
  m.visible = true;
  // Chips are not on the fx list: they persist until the pool wraps around, which
  // is what makes a firefight leave a readable history on the walls.
}

/* A free-standing cloud of dust, for things bigger than one bullet — a section
   of wall coming down. Shares the impact-puff pool. */
export function spawnDust(point: THREE.Vector3, hex: number, scale = 1, ttl = .9) {
  const p = puffs.take();
  p.position.copy(point);
  p.material.color.setHex(hex).lerp(_white, .35);
  p.scale.setScalar(scale);
  activate(p, ttl, 'puff');
}
const _white = new THREE.Color(1, 1, 1);

/* ============================ the grenade ============================ */
// A grenade used to borrow the guns' pools — one flash sprite, one 9 m light,
// six puffs — and read as a large muzzle flash. A heavy blast is layered, and
// every layer has its own timing: it starts abruptly and ends slowly.
//
//   flash      ~90 ms of near-white glare, full on the very first frame
//   fireball   fourteen lumpy billows that swell out in ~0.45 s, white → yellow →
//              orange → deep red, then turn from light into dark smoke
//   pressure   a thin ring racing over the ground to ~11 m in under 0.3 s, and
//              its face-on twin in the air
//   dust       a low brown ring of puffs rolling out to 5–6 m over a second
//   smoke      a dark column that climbs 2–6 m, doubles in size, greys and
//              thins over five seconds
//   sparks     hot streaks on ballistic arcs with drag (particles.ts), and a
//              fountain of dark dirt thrown up out of the crater
//   light      one dedicated long-reach light, peaking in the first 50 ms
//
// The billboard layers (flash, fireball, ring, dust, smoke) are ONE instanced
// mesh drawn from one atlas (textures.ts) with one shader: up to three blasts
// at once cost a single draw call. Each billboard is animated on the CPU —
// there are a couple of hundred at most — and the live ones are packed to the
// front of the instance buffers and sorted far-to-near every frame, so smoke
// layers over smoke correctly.
//
// Fire and smoke share that one draw through premultiplied blending (ONE,
// ONE_MINUS_SRC_ALPHA): the shader writes colour × coverage and puts
// coverage × `blend` in alpha. blend 0 is pure addition (fire, flash), blend 1
// is ordinary over-blending (smoke, dust), and a fireball crossfades between
// the two as it cools — which is exactly the moment fire becomes smoke.

const BLAST_CAP = 176;   // billboards: 52 per blast, sized for three overlapping

const K_FLASH = 0, K_HALO = 1, K_RING = 2, K_FIRE = 3, K_SMOKE = 4, K_DUST = 5;

interface Billow {
  on: boolean;
  fresh: boolean;       // spawned this frame: the first update must not age it
  kind: number;
  age: number;          // starts negative for a delayed billow
  life: number;
  ox: number; oy: number; oz: number;     // where it starts
  tx: number; ty: number; tz: number;     // how far it travels, eased out over moveT
  moveT: number; movePow: number;
  s0: number; s1: number; growT: number; growPow: number;   // diameter, eased out over growT
  rot: number; spin: number;
  cell: number;
  tint: number;         // per-billow value jitter, so a cloud is never one flat colour
  px: number; py: number; pz: number;     // current centre, kept for the sort
}

const billows: Billow[] = [];
for (let i = 0; i < BLAST_CAP; i++) billows.push({
  on: false, fresh: false, kind: 0, age: 0, life: 1,
  ox: 0, oy: 0, oz: 0, tx: 0, ty: 0, tz: 0, moveT: 1, movePow: 3,
  s0: 1, s1: 1, growT: 1, growPow: 3, rot: 0, spin: 0, cell: 0, tint: 1,
  px: 0, py: 0, pz: 0,
});
let nextBillow = 0;
// Oldest-first: the ring order IS spawn order, so wrapping recycles the billow
// that has been on screen longest — a dying wisp of smoke, never a fresh flash.
function takeBillow(kind: number, life: number, delay = 0): Billow {
  const b = billows[nextBillow]; nextBillow = (nextBillow + 1) % BLAST_CAP;
  b.on = true; b.fresh = true; b.kind = kind; b.life = life; b.age = -delay;
  b.tx = b.ty = b.tz = 0; b.moveT = 1; b.movePow = 3;
  b.growT = life; b.growPow = 3; b.spin = 0; b.tint = 1;
  b.rot = Math.random() * Math.PI * 2;
  b.cell = Math.random() < .5 ? 0 : 1;
  return b;
}

const iPos = new Float32Array(BLAST_CAP * 4);    // centre xyz, diameter
const iCol = new Float32Array(BLAST_CAP * 4);    // rgb, opacity
const iMisc = new Float32Array(BLAST_CAP * 3);   // rotation, atlas cell, blend (0 add … 1 over)
const iFx = new Float32Array(BLAST_CAP * 3);     // erosion, near-fade floor, push toward camera
const aIPos = new THREE.InstancedBufferAttribute(iPos, 4).setUsage(THREE.DynamicDrawUsage);
const aICol = new THREE.InstancedBufferAttribute(iCol, 4).setUsage(THREE.DynamicDrawUsage);
const aIMisc = new THREE.InstancedBufferAttribute(iMisc, 3).setUsage(THREE.DynamicDrawUsage);
const aIFx = new THREE.InstancedBufferAttribute(iFx, 3).setUsage(THREE.DynamicDrawUsage);

const blastGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as any);
blastGeo.setAttribute('iPos', aIPos);
blastGeo.setAttribute('iCol', aICol);
blastGeo.setAttribute('iMisc', aIMisc);
blastGeo.setAttribute('iFx', aIFx);
blastGeo.instanceCount = 0;   // the shader prewarm draws this as nothing at all

const blastMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: { uMap: { value: blastTex } },
  vertexShader: /* glsl */`
    attribute vec4 iPos;
    attribute vec4 iCol;
    attribute vec3 iMisc;
    attribute vec3 iFx;
    varying vec2 vUv;
    varying vec4 vCol;
    varying vec2 vFx;      // erosion, blend
    void main(){
      vec3 c = iPos.xyz;
      vec3 toCam = cameraPosition - c;
      float dist = length(toCam);
      // A flat card through a ground-hugging puff is cut in half by the floor
      // (and by any wall it touches) along a hard line. Sliding the card part
      // of its radius toward the eye hides most of that cut; it never slides
      // past the halfway point to the eye, so a close blast still surrounds you.
      float push = min(iPos.w * iFx.z, max(0.0, dist - 0.6) * 0.5);
      c += toCam / max(dist, 1e-4) * push;
      vec4 mv = viewMatrix * vec4(c, 1.0);
      float s = sin(iMisc.x), co = cos(iMisc.x);
      vec2 q = position.xy;
      mv.xy += vec2(co * q.x - s * q.y, s * q.x + co * q.y) * iPos.w;
      gl_Position = projectionMatrix * mv;
      // canvas row 0 is the top of the atlas, i.e. v = 1 after flipY
      vUv = uv * 0.5 + vec2(mod(iMisc.y, 2.0), 1.0 - floor(iMisc.y / 2.0)) * 0.5;
      // From inside a puff it covers the whole screen; thin it there, down to
      // the per-billow floor, so standing in the smoke obscures but never blinds
      // you for its whole life.
      float nf = clamp((dist - 0.25) / max(iPos.w * 0.5, 0.01), 0.0, 1.0);
      vCol = vec4(iCol.rgb, iCol.a * mix(iFx.y, 1.0, nf));
      vFx = vec2(iFx.x, iMisc.z);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    varying vec2 vUv;
    varying vec4 vCol;
    varying vec2 vFx;
    void main(){
      vec4 t = texture2D(uMap, vUv);
      // Erosion raises the floor under the density field, so an ageing billow
      // breaks into its densest lumps rather than fading as a uniform disc.
      float a = clamp((t.a - vFx.x) / max(1.0 - vFx.x, 1e-3), 0.0, 1.0) * vCol.a;
      if (a < 0.003) discard;
      gl_FragColor = vec4(vCol.rgb * t.rgb * a, a * vFx.y);
    }`,
});
const blastMesh = new THREE.Mesh(blastGeo, blastMat);
// Centres live in the instance buffer, so three's bounds (the unit quad at the
// origin) are meaningless.
blastMesh.frustumCulled = false;
blastMesh.matrixAutoUpdate = false;
blastMesh.renderOrder = 2;   // after the ground shock, before the sparks
blastMesh.visible = false;
scene.add(blastMesh);

/* --- the ground shock ---
   A flat ring on the floor rather than a billboard: seen from eye height, a
   front racing across the ground is what sells "pressure wave". Radial maths
   in the shader, no texture — a hard bright leading edge, a short soft glow
   behind it, and a band of kicked-up dust trailing that. Three of them, one per
   overlapping blast; the materials are clones, so they share one program. */
const SHOCK_R = 11.5, SHOCK_T = .28, SHOCK_LIFE = .5, SHOCK_PAD = .3;
const shockGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shockMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  // Lifted 3 cm as well; polygonOffset covers the grazing angles (see chipMat).
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  uniforms: { uR: { value: 0 }, uGlow: { value: 0 }, uDust: { value: 0 }, uSeed: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vP;
    void main(){
      vP = uv * 2.0 - 1.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform float uR, uGlow, uDust, uSeed;
    varying vec2 vP;
    void main(){
      float r = length(vP) * (uR + ${SHOCK_PAD.toFixed(2)});   // metres from the blast
      float d = uR - r;                                         // metres behind the front
      if (d < -0.08 || d > 3.0) discard;
      float th = atan(vP.y, vP.x);
      // break the circle up a little: a perfect ring reads as a UI element
      float wob = 0.72 + 0.28 * sin(th * 7.0 + uSeed) * sin(th * 3.0 - uSeed * 1.7);
      float edge = d < 0.0 ? exp(-d * d / 0.0015) : exp(-d * d / 0.04);
      float band = smoothstep(2.8, 0.3, d) * smoothstep(-0.02, 0.3, d);
      float dustA = band * uDust * wob;
      vec3 col = vec3(1.0, 0.84, 0.6) * edge * uGlow * wob + vec3(0.42, 0.37, 0.3) * dustA;
      gl_FragColor = vec4(col, dustA);
    }`,
});
interface Shock { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; on: boolean; fresh: boolean; age: number }
const shocks: Shock[] = [];
for (let i = 0; i < 3; i++) {
  const mat = i ? shockMat.clone() : shockMat;
  const mesh = new THREE.Mesh(shockGeo, mat);
  mesh.renderOrder = 1;
  mesh.visible = false;
  scene.add(mesh);
  shocks.push({ mesh, mat, on: false, fresh: false, age: 0 });
}
let nextShock = 0;

/* --- the blast light ---
   ONE permanent light, created here and never removed (see the header: the
   light count must not change). The pooled gun lights reach 9 m at intensity
   26; a grenade should light up the street, so this one reaches 34 m and peaks
   at more than ten times that. Overlapping blasts are summed into it, placed at
   their intensity-weighted centre — three blasts never need three lights. */
const BOOM_I = 380, BOOM_HOLD = .05, BOOM_TAU = .1, BOOM_LIFE = .45;
const boomLight = new THREE.PointLight(0xffd8a0, 0, 34, 2);
scene.add(boomLight);
const booms = [0, 1, 2].map(() => ({ on: false, fresh: false, age: 0, x: 0, y: 0, z: 0 }));
let nextBoom = 0;
const _hotLight = new THREE.Color(1, .9, .72), _coolLight = new THREE.Color(1, .5, .2);

/* Where the floor is. pos is usually a resting grenade a few cm above the
   ground — but the crater has already been carved under it, so look just
   outside the crater's rim, and take the height closest to "just below the
   grenade" (a wall column reports its own top, which is further off). Fewer
   than two hits means it went off in the air: no ground ring, no dust. */
function groundNear(pos: THREE.Vector3): number | null {
  let best = NaN, hits = 0;
  const want = pos.y - .07;
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    const f = floorUnder(pos.x + Math.cos(a) * 2.4, pos.z + Math.sin(a) * 2.4, pos.y + .3);
    if (f < pos.y - .8 || f > pos.y + .3) continue;
    if (++hits === 1 || Math.abs(f - want) < Math.abs(best - want)) best = f;
  }
  return hits >= 2 ? best : null;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const _up = new THREE.Vector3(0, 1, 0);
const _flat = new THREE.Vector3(0, .15, 0);
const _sparkCol = new THREE.Color(1, .93, .7);
const _dirt = new THREE.Color(0x2e2620);
const _grit = new THREE.Color(0x5a4a38);
const _o = new THREE.Vector3();

export function spawnExplosion(pos: THREE.Vector3) {
  const ground = groundNear(pos);
  const cx = pos.x, cz = pos.z;
  const cy = pos.y + .45;   // the fireball's heart: lifted so it isn't half buried in the crater

  // --- light ---
  const L = booms[nextBoom]; nextBoom = (nextBoom + 1) % booms.length;
  L.on = true; L.fresh = true; L.age = 0; L.x = cx; L.y = pos.y + .8; L.z = cz;

  // --- flash: near-white, low chroma so it clips to white ---
  let b = takeBillow(K_FLASH, .09);
  b.ox = cx; b.oy = cy; b.oz = cz; b.s0 = 3.4; b.s1 = 4.2; b.cell = 2;
  b = takeBillow(K_HALO, .22);
  b.ox = cx; b.oy = cy; b.oz = cz; b.s0 = 4.5; b.s1 = 7.5; b.cell = 2;

  // --- the pressure front, face-on ---
  b = takeBillow(K_RING, .3);
  b.ox = cx; b.oy = cy; b.oz = cz; b.s0 = .8; b.s1 = 13; b.cell = 3;

  // --- fireball ---
  for (let i = 0; i < 14; i++) {
    b = takeBillow(K_FIRE, rnd(.36, .55));
    // outward, biased up: a blast on the ground has nowhere to go but up and out
    let dx = Math.random() * 2 - 1, dy = Math.random() * .8 + .2, dz = Math.random() * 2 - 1;
    const n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
    const reach = rnd(.6, 1.6);
    b.ox = cx + dx * .15; b.oy = cy + dy * .15; b.oz = cz + dz * .15;
    b.tx = dx * reach; b.ty = dy * reach + rnd(.3, .8); b.tz = dz * reach;
    b.moveT = b.life; b.movePow = 3;
    b.s0 = rnd(.7, 1.1); b.s1 = rnd(3, 4.2); b.growT = b.life * .5;
    b.spin = rnd(-1.5, 1.5); b.tint = rnd(.85, 1.1);
  }

  // --- smoke column: staggered in, so it takes over as the fireball dies ---
  const driftA = Math.random() * Math.PI * 2, drift = rnd(.4, 1.1);   // a breath of wind, the same for the whole column
  const wx = Math.cos(driftA) * drift, wz = Math.sin(driftA) * drift;
  for (let i = 0; i < 14; i++) {
    b = takeBillow(K_SMOKE, rnd(4, 6), rnd(.05, .4));
    b.ox = cx + rnd(-.4, .4); b.oy = pos.y + rnd(.3, 1.1); b.oz = cz + rnd(-.4, .4);
    // stratified heights, so the puffs stack into a column instead of one blob
    b.tx = rnd(-.6, .6) + wx; b.ty = 1.4 + i / 13 * 4 + rnd(0, .8); b.tz = rnd(-.6, .6) + wz;
    b.moveT = b.life * .85; b.movePow = 2;
    b.s0 = rnd(1.8, 2.6); b.s1 = b.s0 * rnd(2, 2.4); b.growT = b.life * .8; b.growPow = 2;
    b.spin = rnd(-.25, .25); b.tint = rnd(.85, 1.15);
  }
  for (let i = 0; i < 5; i++) {   // a low skirt over the crater
    b = takeBillow(K_SMOKE, rnd(3, 4.5), rnd(.1, .3));
    const a = (i + Math.random() * .6) / 5 * Math.PI * 2;
    b.ox = cx + Math.cos(a) * .5; b.oy = pos.y + .4; b.oz = cz + Math.sin(a) * .5;
    b.tx = Math.cos(a) * 1.4 + wx * .6; b.ty = rnd(.5, 1.1); b.tz = Math.sin(a) * 1.4 + wz * .6;
    b.moveT = b.life * .7; b.movePow = 2;
    b.s0 = rnd(2, 2.6); b.s1 = rnd(3.6, 4.4); b.growT = b.life * .7; b.growPow = 2;
    b.spin = rnd(-.25, .25); b.tint = rnd(.9, 1.1);
  }

  if (ground !== null) {
    // --- dust ring rolling out along the floor ---
    for (let i = 0; i < 16; i++) {
      b = takeBillow(K_DUST, rnd(1.8, 2.6), rnd(0, .03));
      const a = (i + Math.random() * .7) / 16 * Math.PI * 2;
      const R = rnd(4.2, 6);
      b.ox = cx + Math.cos(a) * .6; b.oy = ground + .35; b.oz = cz + Math.sin(a) * .6;
      b.tx = Math.cos(a) * (R - .6); b.ty = rnd(.25, .7); b.tz = Math.sin(a) * (R - .6);
      b.moveT = rnd(1, 1.3); b.movePow = 3;
      b.s0 = rnd(.9, 1.2); b.s1 = rnd(2.6, 3.4); b.growT = 1.4; b.growPow = 2;
      b.spin = rnd(-.4, .4); b.tint = rnd(.85, 1.1);
    }

    // --- ground shock ---
    const s = shocks[nextShock]; nextShock = (nextShock + 1) % shocks.length;
    s.on = true; s.fresh = true; s.age = 0;
    s.mesh.position.set(cx, ground + .03, cz);
    s.mat.uniforms.uSeed.value = Math.random() * 100;
    stepShock(s);
    s.mesh.visible = true;
  }

  // --- sparks, dirt and grit (GPU particles) ---
  _o.set(cx, pos.y + .15, cz);
  burst(_o, _up, _sparkCol, 110, 11, 1.25, { hot: true, life: 1.5, lifeMin: .4, drag: 2.2, size: .5, gravity: .9, lift: 2 });
  burst(_o, _flat, _sparkCol, 30, 14, 1, { hot: true, life: 1, lifeMin: .35, drag: 2.6, size: .4, gravity: .6, lift: .5 });
  burst(_o, _up, _dirt, 70, 9, .45, { life: 1.9, lifeMin: 1.1, drag: .5, size: 1.6, lift: 1 });
  burst(_o, _up, _grit, 40, 7, 1.2, { life: 1.2, lifeMin: .6, size: 1.1 });

  // Lay the first frame down now: a blast must never open on a blank frame.
  stepBlast(0);
  stepBoomLight(0);
}

/* ----- per-frame animation of the blast layers ----- */
const easeOut = (x: number, p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), p);
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The fireball's colour over its life: white → yellow → orange → deep red → dark.
const FIRE_RAMP = [
  [0, 1, 1, .95],
  [.12, 1, .9, .55],
  [.3, 1, .58, .2],
  [.5, .85, .28, .07],
  [.7, .3, .1, .05],
  [1, .1, .08, .07],
];
const _rgb = [0, 0, 0];
function fireColour(u: number) {
  let i = 1;
  while (i < FIRE_RAMP.length - 1 && FIRE_RAMP[i][0] < u) i++;
  const a = FIRE_RAMP[i - 1], c = FIRE_RAMP[i];
  const k = Math.min(1, Math.max(0, (u - a[0]) / (c[0] - a[0])));
  _rgb[0] = a[1] + (c[1] - a[1]) * k; _rgb[1] = a[2] + (c[2] - a[2]) * k; _rgb[2] = a[3] + (c[3] - a[3]) * k;
  return _rgb;
}

const order = new Int16Array(BLAST_CAP);
const depth = new Float32Array(BLAST_CAP);

function stepBlast(dt: number) {
  const cam = camera.position;
  let n = 0;
  for (let i = 0; i < BLAST_CAP; i++) {
    const b = billows[i];
    if (!b.on) continue;
    if (b.fresh) { if (dt > 0) b.fresh = false; }
    else b.age += dt;
    if (b.age >= b.life) { b.on = false; continue; }
    if (b.age < 0) continue;   // still waiting on its delay
    const m = easeOut(b.age / b.moveT, b.movePow);
    b.px = b.ox + b.tx * m; b.py = b.oy + b.ty * m; b.pz = b.oz + b.tz * m;
    const dx = b.px - cam.x, dy = b.py - cam.y, dz = b.pz - cam.z;
    depth[i] = dx * dx + dy * dy + dz * dz;
    // insertion sort, far to near — the order barely changes frame to frame,
    // so this is close to linear
    let j = n++;
    while (j > 0 && depth[order[j - 1]] < depth[i]) { order[j] = order[j - 1]; j--; }
    order[j] = i;
  }

  for (let j = 0; j < n; j++) {
    const b = billows[order[j]];
    const u = b.age / b.life;
    const size = b.s0 + (b.s1 - b.s0) * easeOut(b.age / b.growT, b.growPow);
    let r = 1, g = 1, bl = 1, a = 1, blend = 0, erode = 0, nearFloor = .35, push = .3;
    switch (b.kind) {
      case K_FLASH:
        r = 1; g = .97; bl = .9;
        a = 1 - sstep(.4, 1, u);
        nearFloor = 1; push = 0;
        break;
      case K_HALO:
        r = 1; g = .72; bl = .4;
        a = .5 * (1 - u) * (1 - u);
        nearFloor = .5; push = 0;
        break;
      case K_RING:
        r = 1; g = .92; bl = .8;
        a = .3 * Math.pow(1 - u, 1.5);
        nearFloor = 1; push = 0;
        break;
      case K_FIRE: {
        const c = fireColour(u);
        r = c[0] * b.tint; g = c[1] * b.tint; bl = c[2] * b.tint;
        // additive and dimming while it burns, then over-blended dark smoke that fades out
        blend = sstep(.42, .75, u);
        const burn = 1 - .55 * sstep(0, .45, u);
        a = (burn + (.65 - burn) * blend) * (1 - sstep(.72, 1, u));
        erode = .55 * sstep(.3, 1, u);
        break;
      }
      case K_SMOKE: {
        // dark and dense as it boils up, greying and thinning on a long tail
        const k = sstep(0, .55, u) * b.tint;
        r = .11 + .32 * k; g = .105 + .305 * k; bl = .1 + .29 * k;
        a = .85 * Math.min(1, b.age / .3) * Math.pow(1 - u, 1.7);
        blend = 1; erode = .5 * u; nearFloor = .3; push = .35;
        break;
      }
      case K_DUST: {
        const k = sstep(0, .7, u);
        // darker than the sand it rises from, or on dust2 it vanishes into the floor
        r = (.42 + .12 * k) * b.tint; g = (.37 + .13 * k) * b.tint; bl = (.31 + .13 * k) * b.tint;
        a = .65 * Math.min(1, b.age / .08) * Math.pow(1 - u, 1.4);
        blend = 1; erode = .45 * u; nearFloor = .3; push = .5;
        break;
      }
    }
    iPos[j * 4] = b.px; iPos[j * 4 + 1] = b.py; iPos[j * 4 + 2] = b.pz; iPos[j * 4 + 3] = size;
    iCol[j * 4] = r; iCol[j * 4 + 1] = g; iCol[j * 4 + 2] = bl; iCol[j * 4 + 3] = a;
    iMisc[j * 3] = b.rot + b.spin * b.age; iMisc[j * 3 + 1] = b.cell; iMisc[j * 3 + 2] = blend;
    iFx[j * 3] = erode; iFx[j * 3 + 1] = nearFloor; iFx[j * 3 + 2] = push;
  }

  blastGeo.instanceCount = n;
  blastMesh.visible = n > 0;
  if (n > 0) {
    aIPos.clearUpdateRanges(); aIPos.addUpdateRange(0, n * 4); aIPos.needsUpdate = true;
    aICol.clearUpdateRanges(); aICol.addUpdateRange(0, n * 4); aICol.needsUpdate = true;
    aIMisc.clearUpdateRanges(); aIMisc.addUpdateRange(0, n * 3); aIMisc.needsUpdate = true;
    aIFx.clearUpdateRanges(); aIFx.addUpdateRange(0, n * 3); aIFx.needsUpdate = true;
  }
}

function stepShock(s: Shock) {
  const R = SHOCK_R * easeOut(s.age / SHOCK_T, 3);
  const u = s.age / SHOCK_LIFE;
  s.mat.uniforms.uR.value = R;
  s.mat.uniforms.uGlow.value = 1.3 * Math.pow(Math.max(0, 1 - s.age / (SHOCK_T + .05)), 1.3);
  s.mat.uniforms.uDust.value = .35 * (1 - sstep(.2, 1, u));
  const w = 2 * (R + SHOCK_PAD);
  s.mesh.scale.set(w, 1, w);
}

function stepShocks(dt: number) {
  for (const s of shocks) {
    if (!s.on) continue;
    if (s.fresh) s.fresh = false; else s.age += dt;
    if (s.age >= SHOCK_LIFE) { s.on = false; s.mesh.visible = false; continue; }
    stepShock(s);
  }
}

function stepBoomLight(dt: number) {
  let sum = 0, x = 0, y = 0, z = 0, heat = 0;
  for (const L of booms) {
    if (!L.on) continue;
    if (L.fresh) { if (dt > 0) L.fresh = false; }
    else L.age += dt;
    if (L.age >= BOOM_LIFE) { L.on = false; continue; }
    // flat-topped for the first 50 ms, then an exponential fall — and a little
    // flicker once the fireball is burning rather than detonating
    let i = L.age < BOOM_HOLD ? 1 : Math.exp(-(L.age - BOOM_HOLD) / BOOM_TAU) * (.85 + .15 * Math.random());
    i *= 1 - sstep(BOOM_LIFE * .8, BOOM_LIFE, L.age);
    sum += i; x += L.x * i; y += L.y * i; z += L.z * i;
    heat += Math.exp(-L.age / .12) * i;
  }
  if (sum <= 1e-4) { boomLight.intensity = 0; return; }   // never hidden — see the header
  boomLight.position.set(x / sum, y / sum, z / sum);
  boomLight.color.copy(_coolLight).lerp(_hotLight, heat / sum);
  boomLight.intensity = BOOM_I * sum;
}

/* Clear every chip off the walls — the walls themselves are about to be replaced. */
export function clearChips() { for (const c of chips.items) c.visible = false; }

export function impactSurfaceOf(collider: any): Surface {
  return surfaceOf(collider?.mat);
}

/* Borderlands-style floating damage number: a chunky figure that punches in over
   the struck traveller, arcs up and out, then fades — so onlookers (and the
   shooter) read how hard each ball landed. Headshots read bigger and cyan.
   Textures are cached by (amount, head): a firefight reuses a handful of values,
   so we bake each once and share it. Swapping which texture a pooled sprite
   points at is free — three's program key cares whether a map exists, not which. */
const dmgTexCache = new Map<string, THREE.CanvasTexture>();
function dmgTex(amount: number, head: boolean) {
  const key = amount + '|' + (head ? 1 : 0);
  const hit = dmgTexCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const txt = String(amount);
  g.font = '800 ' + (head ? 88 : 70) + 'px Montserrat, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.miterLimit = 2;
  g.lineWidth = head ? 13 : 11;
  g.strokeStyle = 'rgba(0,0,0,.92)';            // heavy dark outline so it reads on any backdrop
  g.strokeText(txt, 128, 66);
  const grad = g.createLinearGradient(0, 22, 0, 108);
  if (head) { grad.addColorStop(0, '#9aeeff'); grad.addColorStop(1, '#00beeb'); }  // crit: RB-Media cyan
  else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#dcdcdc'); }       // clean white
  g.fillStyle = grad;
  g.fillText(txt, 128, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Screen-space text: mipmaps would only soften it, and cost upload time.
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  dmgTexCache.set(key, t);
  return t;
}

export function spawnDamageNumber(pos, amount: number, head = false) {
  const s = dmgNumbers.take();
  s.material.map = dmgTex(Math.round(amount), head);
  s.material.opacity = 1;
  s.position.copy(pos);
  const base = head ? .95 : .72;
  s.scale.set(base * 2, base, 1);                              // canvas is 2:1
  // launch each number on its own arc so a burst of hits fans out instead of stacking
  const ang = Math.random() * Math.PI * 2;
  activate(s, 1.1, 'dmg', { base, vx: Math.cos(ang) * .55, vz: Math.sin(ang) * .55, vy: 1.7 });
}

/* ============================ the driver ============================ */
export function updateFx(dt: number) {
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.ttl -= dt;
    const k = Math.max(f.ttl, 0) / f.t0;

    if (f.kind === 'tracer') {
      const age = f.t0 - f.ttl;
      stepTracer(f, age);
      // Full brightness while travelling, then a quick fade once it has landed.
      const travel = f.len / TRACER_SPEED;
      f.obj.material.opacity = age < travel ? .9 : Math.max(0, 1 - (age - travel) / .045) * .9;
    }
    else if (f.kind === 'light') f.obj.intensity = FLASH_I * k;
    else if (f.kind === 'puff') {
      f.obj.material.opacity = .32 * k;
      f.obj.position.y += dt * .8;
      f.obj.scale.addScalar(dt * 1.5);
    }
    else if (f.kind === 'dmg') {
      const age = f.t0 - f.ttl;
      f.obj.position.x += f.vx * dt;
      f.obj.position.z += f.vz * dt;
      f.obj.position.y += f.vy * dt;
      f.vy -= dt * 2.6;                               // a gentle arc: pops up, settles back
      const punch = 1 + Math.max(0, .1 - age) * 4.5;  // brief overshoot in the first 100ms
      const sc = f.base * punch;
      f.obj.scale.set(sc * 2, sc, 1);
      f.obj.material.opacity = k < .3 ? k / .3 : 1;   // hold full, fade over the last 30%
    }
    else f.obj.material.opacity = .85 * k;

    if (f.ttl <= 0) { retire(f); live.splice(i, 1); }
  }
  // the grenade's layers keep their own books (see "the grenade" above)
  stepBlast(dt);
  stepShocks(dt);
  stepBoomLight(dt);
}

/* --- ray tests: slab AABB for the town, vertical capsule for travellers --- */
export function rayAABB(o, d, c) {
  let tmin = 0, tmax = Infinity;
  const lo = [c.x - c.hx, c.base ?? 0, c.z - c.hz], hi = [c.x + c.hx, c.h ?? c.top ?? 5, c.z + c.hz];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < lo[i] || oo[i] > hi[i]) return Infinity; continue; }
    let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}
export function rayPlayer(o, d, p) {
  const r = .45;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return Infinity;
  const ox = o.x - p.x, oz = o.z - p.z;
  const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return Infinity;
  const y = o.y + d.y * t;
  return (y < p.y - .05 || y > p.y + 1.85) ? Infinity : t;
}
