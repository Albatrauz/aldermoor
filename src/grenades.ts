/* ============================ grenades ============================ */
// Hold G to pull the pin: a ring fills round the crosshair over the fuse and a
// dotted arc shows where the grenade will go. Let go to throw it with whatever
// fuse is left; hold on past the end and it goes off in your hand.
//
// The thrower's client works out the whole flight against its copy of the map —
// the throw, then a keyframe at every bounce — and sends it. Everyone else draws
// those same keyframes, so the grenade is in the same place on every screen. The
// server keeps the fuse and announces the blast, which lands in the shot order
// like any shot: every client blows the same crater. The thrower then reports
// who the blast could reach and how exposed they stood; the server measures the
// distance itself and deals the damage.
import * as THREE from 'three';
import { scene, camera, EYE } from './core';
import { traceWorld, blastImpact, solidAt } from './voxel';
import { remotes } from './villagers';
import { myId, sendNet } from './net';
import { spawnExplosion } from './effects';
import { blast, pinSnd, fuseTick } from './audio';
import { setNades, setNadeRing } from './hud';
import { matIron, matGoldTrim } from './materials';
import { introVisible, frozen, dead, locked, dragLook, player } from './controls';
import { onMapChange } from './world';

export const NADES_PER_LIFE = 2;
const FUSE = 5;               // seconds from the pin to the blast — server.js holds the same
const GRAVITY = 13;           // the players' own gravity, so a lob reads like a hop
const THROW_SPEED = 15;       // ≈ 20 m on the flat at 45°
const THROW_LIFT = 2.5;       // a little loft on top of the aim, as an overarm throw has
const BOUNCE = .4;            // share of the speed into a surface that comes back out
const SLIDE = .7;             // share of the speed along a surface kept through a bounce
const REST_SPEED = 1.2;       // landing on a floor slower than this, it stays put
const RADIUS = .07;
const SIM_DT = 1 / 120;
const MAX_KEYS = 40;
const ARC_SPAN = 3.5;         // seconds of flight the preview draws, at most
const ARC_STEP = .025;
// The blast's reach — server.js deals the damage; this only decides whom to report.
const BLAST_REACH = 8;

// One keyframe of a flight: [t, x, y, z, vx, vy, vz]. Between keyframes the
// grenade is ballistic; zero velocity means it is lying still.
type Key = [number, number, number, number, number, number, number];

/* ============================ flight ============================ */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _seg = new THREE.Vector3();

/* Throw from `o` at `v` and follow it for `maxT` seconds: bounce off whatever
   voxels it meets, settle on a floor once it is slow. */
function simulate(o: THREE.Vector3, v: THREE.Vector3, maxT: number): Key[] {
  const keys: Key[] = [[0, o.x, o.y, o.z, v.x, v.y, v.z]];
  let t0 = 0, px = o.x, py = o.y, pz = o.z, vx = v.x, vy = v.y, vz = v.z;
  let t = 0;
  while (t < maxT) {
    const t1 = Math.min(maxT, t + SIM_DT);
    const da = t - t0, db = t1 - t0;
    _a.set(px + vx * da, py + vy * da - GRAVITY * .5 * da * da, pz + vz * da);
    _b.set(px + vx * db, py + vy * db - GRAVITY * .5 * db * db, pz + vz * db);
    _seg.subVectors(_b, _a);
    const len = _seg.length();
    if (len > 1e-6) {
      _seg.divideScalar(len);
      const hit = traceWorld(_a, _seg, len + RADIUS);
      if (hit.hit) {
        const back = Math.max(0, hit.end - RADIUS);
        const th = t + (t1 - t) * Math.min(1, back / len);
        const r = hit.ray;
        const hvx = vx, hvy = vy - GRAVITY * (th - t0), hvz = vz;
        const vn = hvx * r.nx + hvy * r.ny + hvz * r.nz;
        let nvx = hvx, nvy = hvy, nvz = hvz;
        if (vn < 0) {
          nvx = (hvx - r.nx * vn) * SLIDE - r.nx * vn * BOUNCE;
          nvy = (hvy - r.ny * vn) * SLIDE - r.ny * vn * BOUNCE;
          nvz = (hvz - r.nz * vn) * SLIDE - r.nz * vn * BOUNCE;
        }
        px = _a.x + _seg.x * back; py = _a.y + _seg.y * back; pz = _a.z + _seg.z * back;
        if ((r.ny > .6 && -vn * BOUNCE < REST_SPEED) || keys.length >= MAX_KEYS - 1) {
          keys.push([th, px, py, pz, 0, 0, 0]);
          return keys;
        }
        keys.push([th, px, py, pz, nvx, nvy, nvz]);
        t0 = t = th; vx = nvx; vy = nvy; vz = nvz;
        continue;
      }
    }
    t = t1;
  }
  return keys;
}

/* What goes on the wire, and therefore what every client — the thrower too — draws. */
function roundKeys(keys: Key[]): Key[] {
  return keys.map(k => [+k[0].toFixed(3),
    +k[1].toFixed(2), +k[2].toFixed(2), +k[3].toFixed(2),
    +k[4].toFixed(2), +k[5].toFixed(2), +k[6].toFixed(2)] as Key);
}

const resting = (k: ArrayLike<number>) => k[4] === 0 && k[5] === 0 && k[6] === 0;

/* Where a flight is `t` seconds after the throw. */
function pathAt(keys: ArrayLike<number>[], t: number, out: THREE.Vector3) {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1][0] <= t) i++;
  const k = keys[i];
  if (resting(k)) return out.set(k[1], k[2], k[3]);
  const dt = Math.max(0, t - k[0]);
  return out.set(k[1] + k[4] * dt, k[2] + k[5] * dt - GRAVITY * .5 * dt * dt, k[3] + k[6] * dt);
}

/* The hand: a little ahead of the eye, low and to the right, unless that would
   put it inside a wall the player is pressed against. */
const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _upv = new THREE.Vector3();
function aim(o: THREE.Vector3, v: THREE.Vector3) {
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(_eye);
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
  o.copy(_eye).addScaledVector(_fwd, .35).addScaledVector(_right, .12).addScaledVector(_upv, -.1);
  _seg.subVectors(o, _eye);
  const len = _seg.length();
  if (traceWorld(_eye, _seg.divideScalar(len), len + RADIUS).hit) o.copy(_eye);
  v.copy(_fwd).multiplyScalar(THROW_SPEED);
  v.y += THROW_LIFT;
}

/* ============================ meshes ============================ */
const nadeGeo = new THREE.SphereGeometry(RADIUS, 12, 8);
const leverGeo = new THREE.BoxGeometry(.02, .07, .025);
function buildNade(scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(nadeGeo, matIron);
  const lever = new THREE.Mesh(leverGeo, matGoldTrim);
  lever.position.set(0, RADIUS * .9, 0);
  g.add(body, lever);
  g.scale.setScalar(scale);
  return g;
}

// held in the off hand while cooking
const held = buildNade(.55);
held.position.set(-.22, -.2, -.45);
held.visible = false;
camera.add(held);

// the arc: a dotted line of small beads, then a ring where it ends up
const ARC_MAX = Math.ceil(ARC_SPAN / ARC_STEP) + 1;
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.035, 6, 4),
  new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: .85, depthWrite: false, toneMapped: false }),
  ARC_MAX);
dots.frustumCulled = false;
dots.renderOrder = 10;
dots.visible = false;
scene.add(dots);
const landMat = new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: .8,
  depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const landRing = new THREE.Mesh(new THREE.RingGeometry(.28, .4, 28), landMat);
landRing.rotation.x = -Math.PI / 2;
landRing.renderOrder = 10;
landRing.visible = false;
scene.add(landRing);

/* ============================ state ============================ */
interface Flight {
  keys: ArrayLike<number>[];
  fuse: number;
  start: number;            // performance.now() when it left the hand / we heard of it
  ex: number[];
  n: number | null;         // the server's id, once it has acknowledged the throw
  mine: boolean;
  offline: boolean;
  mesh: THREE.Group;
}
const flights: Flight[] = [];
let nades = NADES_PER_LIFE;
let cookStart = 0;          // performance.now() when the pin came out; 0 = not cooking
let nextTick = 0;
let shake = 0;

export const isCooking = () => cookStart > 0;

/* A fresh life: a fresh pair, and nothing in hand. */
export function resetNades() {
  stopCooking();
  nades = NADES_PER_LIFE;
  setNades(nades, NADES_PER_LIFE);
}
setNades(nades, NADES_PER_LIFE);

function stopCooking() {
  cookStart = 0;
  held.visible = false;
  dots.visible = false;
  landRing.visible = false;
  setNadeRing(null);
}

function canCook() {
  return !introVisible && !frozen && !dead && (locked || dragLook) && nades > 0 && !cookStart;
}

addEventListener('keydown', e => {
  if (e.code !== 'KeyG' || e.repeat || !canCook()) return;
  cookStart = performance.now();
  nextTick = 1;
  held.visible = true;
  pinSnd();
});
addEventListener('keyup', e => { if (e.code === 'KeyG' && cookStart) release(false); });
// alt-tabbing away never delivers the keyup — it counts as letting go
addEventListener('blur', () => { if (cookStart) release(false); });

const _o = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

/* Let go of the grenade — or, `cooked`, have it go off in the hand. */
function release(cooked: boolean) {
  const held_s = (performance.now() - cookStart) / 1000;
  stopCooking();
  const fuse = cooked ? 0 : Math.max(.05, +(FUSE - held_s).toFixed(2));
  aim(_o, _v);
  const keys: Key[] = cooked
    ? [[0, +_o.x.toFixed(2), +_o.y.toFixed(2), +_o.z.toFixed(2), 0, 0, 0]]
    : roundKeys(simulate(_o, _v, fuse));
  pathAt(keys, fuse, _p);
  const ex = [+_p.x.toFixed(2), +_p.y.toFixed(2), +_p.z.toFixed(2)];
  nades -= 1;
  setNades(nades, NADES_PER_LIFE);
  const wire: Record<string, unknown> = { t: 'nade', k: keys, f: fuse, ex };
  if (cooked) wire.c = 1;
  const online = sendNet(wire);  addFlight(keys, fuse, ex, online ? null : -1, true, !online);
}

function addFlight(keys: ArrayLike<number>[], fuse: number, ex: number[], n: number | null, mine: boolean, offline: boolean) {
  const mesh = buildNade();
  pathAt(keys, 0, mesh.position);
  scene.add(mesh);
  flights.push({ keys, fuse, start: performance.now(), ex, n, mine, offline, mesh });
}

function dropFlight(i: number) {
  scene.remove(flights[i].mesh);
  flights.splice(i, 1);
}

/* ============================ network ============================ */
/* The server relayed a throw — someone else's to draw, or our own acknowledged. */
export function handleNade(m) {
  if (m.id === myId) {
    const f = flights.find(f => f.mine && f.n === null);
    if (f) f.n = m.n;
    return;
  }
  if (!Array.isArray(m.k) || !Array.isArray(m.ex)) return;
  addFlight(m.k, m.f, m.ex, m.n, false, false);
}

/* The server says a grenade has gone off. */
export function handleBoom(m) {
  const i = flights.findIndex(f => f.n === m.n);
  if (i >= 0) dropFlight(i);
  explode(m.ex, m.id === myId ? m.n : null);
}

/* The blast itself. Exposure is judged on the map as it stands before the
   crater is dug, which is the map every client holds at this point. */
function explode(ex: number[], reportAs: number | null) {
  if (reportAs !== null) sendNet({ t: 'nadehit', n: reportAs, h: exposures(ex) });
  blastImpact(ex[0], ex[1], ex[2]);
  _p.set(ex[0], ex[1], ex[2]);
  spawnExplosion(_p);
  const d = _p.distanceTo(camera.position);
  blast(Math.min(1, 14 / Math.max(4, d)));
  shake = Math.max(shake, Math.max(0, 1 - d / 18));
}

/* Who stands within reach of a blast at `ex`, and how much of each is in the
   open from it: rays from the blast to shins, chest and head; the share that
   arrive unblocked. A wall between you and the grenade is what saves you. */
const BODY_PTS = [.3, 1.0, 1.6];
const _e = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3();
function exposures(ex: number[]): [number, number][] {
  _e.set(ex[0], ex[1] + .2, ex[2]);
  if (solidAt(_e.x, _e.y, _e.z)) _e.set(ex[0], ex[1], ex[2]);
  const bodies: [number, number, number, number][] = [];
  if (!dead && myId !== null) bodies.push([myId, player.x, player.y - EYE, player.z]);
  for (const [id, v] of remotes) if (!(v.deadT > 0)) bodies.push([id, v.cur.x, v.cur.y, v.cur.z]);
  const out: [number, number][] = [];
  for (const [id, x, feet, z] of bodies) {
    const cy = Math.max(feet, Math.min(feet + EYE, _e.y));
    if (Math.hypot(x - _e.x, cy - _e.y, z - _e.z) > BLAST_REACH) continue;
    let open = 0;
    for (const h of BODY_PTS) {
      _t.set(x, feet + h, z);
      _dir.subVectors(_t, _e);
      const len = _dir.length();
      if (len < 1e-3) { open++; continue; }
      if (!traceWorld(_e, _dir.divideScalar(len), len).hit) open++;
    }
    if (open) out.push([id, +(open / BODY_PTS.length).toFixed(2)]);
  }
  return out;
}

/* ============================ per frame ============================ */
const _m = new THREE.Matrix4();
function drawArc(left: number) {
  aim(_o, _v);
  const span = Math.min(left, ARC_SPAN);
  const keys = simulate(_o, _v, span);
  const last = keys[keys.length - 1];
  const end = resting(last) ? Math.min(span, last[0]) : span;
  let n = 0;
  for (let t = .06; t <= end && n < ARC_MAX; t += ARC_STEP) {
    pathAt(keys, t, _p);
    // grow with distance so the far end of the arc still reads
    const s = Math.min(3, Math.max(1, _p.distanceTo(_eye) / 5));
    dots.setMatrixAt(n++, _m.makeScale(s, s, s).setPosition(_p));
  }
  dots.count = n;
  dots.instanceMatrix.needsUpdate = true;
  dots.visible = n > 0;
  pathAt(keys, end, _p);
  landRing.position.set(_p.x, _p.y - RADIUS + .03, _p.z);
  // red when the fuse will run out on this arc: that is where it goes off
  landMat.color.setHex(left <= ARC_SPAN ? 0xff4a24 : 0xfff1cf);
  landRing.visible = true;
}

export function update(dt: number) {
  const now = performance.now();
  if (cookStart) {
    if (dead || frozen) stopCooking();
    else if (introVisible) release(false);
    else {
      const t = (now - cookStart) / 1000;
      if (t >= FUSE) release(true);
      else {
        const left = FUSE - t;
        setNadeRing(left / FUSE);
        drawArc(left);
        // a tick a second, then quickening through the last stretch
        if (t >= nextTick) {
          fuseTick(left < 1.5);
          nextTick = left < 1.5 ? t + .25 : nextTick + 1;
        }
      }
    }
  }

  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const t = Math.min((now - f.start) / 1000, f.fuse);
    pathAt(f.keys, t, f.mesh.position);
    const last = f.keys[f.keys.length - 1];
    if (!resting(last) || t < last[0]) { f.mesh.rotation.x = t * 9; f.mesh.rotation.z = t * 5; }
    if (f.offline && t >= f.fuse) { dropFlight(i); explode(f.ex, null); continue; }
    // a throw the server never acknowledged (we died as it left the hand, or the
    // round ended): it fizzles rather than lying there for ever
    if (f.n === null && (now - f.start) / 1000 > f.fuse + 2) dropFlight(i);
    else if ((now - f.start) / 1000 > f.fuse + 5) dropFlight(i);
  }

  if (shake > 0 && !introVisible && !frozen) {
    camera.position.x += (Math.random() - .5) * shake * .12;
    camera.position.y += (Math.random() - .5) * shake * .12;
    camera.rotation.x += (Math.random() - .5) * shake * .03;
  }
  shake = Math.max(0, shake - dt * 2.5);
}

/* A new map: whatever was in the air belonged to the old one. */
onMapChange(() => { for (let i = flights.length - 1; i >= 0; i--) dropFlight(i); });

/* debug: throw now with the current aim, as though G had been held `heldFor` seconds */
export function debugThrow(heldFor = 0) {
  if (nades <= 0) return false;
  cookStart = performance.now() - heldFor * 1000;
  release(heldFor >= FUSE);
  return true;
}
export const debugState = () => ({ nades, cooking: !!cookStart, flights: flights.length,
  arcEnd: landRing.visible ? landRing.position.toArray().map(n => +n.toFixed(2)) : null, arcDots: dots.visible ? dots.count : 0 });
