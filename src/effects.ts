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
import { scene } from './core';
import { flameTex, smokeTex, impactTex } from './textures';
import { IMPACT, surfaceOf, type Surface } from './materials';
import { burst } from './particles';

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
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.visible = false;
  scene.add(s);
  return s;
});

const puffs = makePool(24, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
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
export function spawnImpact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface) {
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

  // the mark it leaves
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

export function impactSurfaceOf(collider: any): Surface {
  return surfaceOf(collider?.mat);
}

/* Borderlands-style floating damage number: a chunky figure that punches in over
   the struck traveller, arcs up and out, then fades — so onlookers (and the
   shooter) read how hard each ball landed. Headshots read bigger and gold.
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
  g.font = '900 ' + (head ? 92 : 72) + 'px Georgia, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.miterLimit = 2;
  g.lineWidth = head ? 13 : 11;
  g.strokeStyle = 'rgba(18,7,2,.95)';            // heavy dark outline so it reads on any backdrop
  g.strokeText(txt, 128, 66);
  const grad = g.createLinearGradient(0, 22, 0, 108);
  if (head) { grad.addColorStop(0, '#fff3b0'); grad.addColorStop(1, '#ff8a1e'); }  // crit gold→orange
  else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#ffcf8c'); }       // warm white
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
