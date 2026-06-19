/* ============================ world — the map manager ============================ */
// The game can be played on more than one map, and the server rotates them
// between rounds. This module owns the shared sky/sun/fog and the *active* map:
// it builds a map's geometry into a group, swaps that group on demand, and keeps
// the live `colliders`, `SPAWNS` and `ZONES` arrays (which controls/combat/zones
// read every frame) pointing at the current map's data. The exported arrays keep
// a stable identity — they're refilled in place — so importers never re-bind.
import * as THREE from 'three';
import { scene, renderer } from './core';
import { glowTex } from './textures';
import { colliderTopAt, type Collider, type Spawn, type Zone, type MapEnv, type MenuCam, type MapDef } from './mapkit';
import { dust2 } from './maps/dust2';
import { skidrow } from './maps/skidrow';

export { colliderTopAt };

/* ============================ shared sky, sun & fog ============================ */
// These objects persist across map switches; each map repaints them via its env.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(560, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4a78b8) },
      mid: { value: new THREE.Color(0x9fc0e0) },
      low: { value: new THREE.Color(0xe8d9b0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){
        float h=normalize(vP).y;
        vec3 c = h<0.14 ? mix(low,mid,smoothstep(-0.06,0.14,h)) : mix(mid,top,smoothstep(0.14,0.6,h));
        gl_FragColor=vec4(c,1.0);
      }`,
  }),
);
sky.renderOrder = -3; sky.frustumCulled = false;
scene.add(sky);
const skyU = (sky.material as THREE.ShaderMaterial).uniforms;

const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xfff4dc, transparent: true, opacity: .85,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
glow.scale.setScalar(150); glow.renderOrder = -2;
scene.add(glow);

const hemi = new THREE.HemisphereLight(0x9fc0e0, 0x8a7350, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 460;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xb9c9de, 0.4);
fill.position.set(-60, 40, -45);
scene.add(fill);

function applyEnv(env: MapEnv) {
  skyU.top.value.setHex(env.skyTop);
  skyU.mid.value.setHex(env.skyMid);
  skyU.low.value.setHex(env.skyLow);
  const dir = new THREE.Vector3(...env.sunDir).normalize();
  sun.color.setHex(env.sunColor); sun.intensity = env.sunIntensity;
  sun.position.copy(dir).multiplyScalar(160);
  glow.material.color.setHex(env.glowColor);
  glow.material.opacity = env.glowOpacity;
  glow.visible = env.glowOpacity > 0;
  glow.position.copy(dir).multiplyScalar(520);
  hemi.color.setHex(env.hemiSky); hemi.groundColor.setHex(env.hemiGround); hemi.intensity = env.hemiIntensity;
  fill.color.setHex(env.fillColor); fill.intensity = env.fillIntensity;
  (scene.fog as THREE.FogExp2).color.setHex(env.fogColor);
  (scene.fog as THREE.FogExp2).density = env.fogDensity;
  renderer.toneMappingExposure = env.exposure;
}

/* ============================ map registry & rotation ============================ */
const MAPS: Record<string, MapDef> = { dust2, skidrow };
// The order the server rotates through; mirrored in server.js.
export const MAP_ORDER = ['dust2', 'skidrow'];

// Live, stable-identity arrays the rest of the game reads. Refilled on switch.
export const colliders: Collider[] = [];
export const SPAWNS: Spawn[] = [];
export const ZONES: Zone[] = [];
// The lobby establishing-shot camera; mutated in place so controls keeps its ref.
export const menuCam: MenuCam = { x: -48, y: 12, z: 2, yaw: -Math.PI / 2, pitch: -.16 };

export let currentMapName = MAP_ORDER[0];
let currentGroup: THREE.Group | null = null;

const changeListeners = new Set<(name: string) => void>();
export function onMapChange(fn: (name: string) => void) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

export function mapLabel(name = currentMapName) { return MAPS[name]?.label ?? name; }
export function mapBlurb(name = currentMapName) { return MAPS[name]?.blurb ?? ''; }

// Drop the active map's geometry (freeing its per-instance geometries; shared
// materials are left alone) so a swap doesn't leak GPU memory over a long match.
function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  scene.remove(g);
}

/* Build and show the named map. Idempotent: re-selecting the live map is a no-op,
   so a stray duplicate `lobby`/`welcome` won't rebuild the world mid-look. */
export function setMap(name: string) {
  const def = MAPS[name];
  if (!def) { console.warn('unknown map', name); return; }
  if (currentGroup && name === currentMapName) return;

  const built = def.build();
  if (currentGroup) disposeGroup(currentGroup);
  currentGroup = built.group;
  scene.add(currentGroup);

  // refill the live arrays in place — importers hold these very references
  colliders.length = 0; colliders.push(...built.colliders);
  SPAWNS.length = 0; SPAWNS.push(...built.spawns);
  ZONES.length = 0; ZONES.push(...built.zones);
  Object.assign(menuCam, def.menuCam);
  applyEnv(def.env);

  currentMapName = name;
  for (const fn of changeListeners) { try { fn(name); } catch { /* ignore */ } }
}

// Advance to the next map in the rotation (used by the debug hook / offline play).
export function rotateMap() {
  const i = MAP_ORDER.indexOf(currentMapName);
  setMap(MAP_ORDER[(i + 1) % MAP_ORDER.length]);
}

// Build the first map at load so the scene is populated before the socket opens.
setMap(currentMapName);

/* ============================ per-frame ambient animation ============================ */
// Kept because main.ts calls it every frame; both maps are static daylight.
export function updateAmbient(_time?: number) {}
