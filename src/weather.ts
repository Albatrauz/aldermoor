/* ============================ weather ============================ */
// Falling snow on the winter map, drifting dust in the desert. This is the
// cheapest atmosphere available: a single THREE.Points that follows the camera,
// with every speck's motion derived in the vertex shader from one clock uniform.
// The CPU writes the buffer once at startup and never touches it again.
//
// The trick that makes it look like weather rather than a fixed cage of dots:
// each speck's height is `mod()`-wrapped over the box, so a speck that falls out
// of the bottom reappears at the top with no bookkeeping at all. The box itself
// is snapped to the camera each frame, so you are always inside the weather.
import * as THREE from 'three';
import { scene, camera } from './core';

export interface WeatherSpec {
  count: number;      // 0 disables the system entirely
  colour: number;
  size: number;       // point size in px at 1 unit distance
  fall: number;       // units/sec downward
  sway: number;       // horizontal drift amplitude
  opacity: number;
  streak: number;     // 0 = round fleck, 1 = elongated (falling snow reads streaky)
}

const BOX = 70;       // side of the cube of weather that follows the camera
const HEIGHT = 46;

const MAX = 2400;     // ceiling; a spec's `count` selects how many are drawn

const pos = new Float32Array(MAX * 3);
const phase = new Float32Array(MAX);
const speed = new Float32Array(MAX);
for (let i = 0; i < MAX; i++) {
  pos[i * 3]     = (Math.random() - .5) * BOX;
  pos[i * 3 + 1] = Math.random() * HEIGHT;
  pos[i * 3 + 2] = (Math.random() - .5) * BOX;
  phase[i] = Math.random() * Math.PI * 2;
  speed[i] = .6 + Math.random() * .8;      // per-speck variation so it never marches in step
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
geo.setDrawRange(0, 0);                    // nothing until a map asks for weather

const mat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uColour: { value: new THREE.Color(0xffffff) },
    uSize: { value: 90 },
    uFall: { value: 3 },
    uSway: { value: 1.2 },
    uOpacity: { value: .6 },
    uStreak: { value: 1 },
    uHeight: { value: HEIGHT },
  },
  vertexShader: /* glsl */`
    attribute float aPhase;
    attribute float aSpeed;
    uniform float uTime, uSize, uFall, uSway, uHeight;
    varying float vFade;
    void main(){
      vec3 p = position;
      // Wrap the fall over the box height: a speck leaving the bottom is the same
      // speck arriving at the top, so the system never needs respawning.
      p.y = mod(p.y - uTime * uFall * aSpeed, uHeight);
      p.x += sin(uTime * 0.6 * aSpeed + aPhase) * uSway;
      p.z += cos(uTime * 0.45 * aSpeed + aPhase * 1.7) * uSway;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float d = max(-mv.z, 0.5);
      gl_PointSize = uSize * aSpeed / d;
      // Fade the far specks so the box has no visible wall.
      vFade = 1.0 - smoothstep(18.0, 42.0, d);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColour;
    uniform float uOpacity, uStreak;
    varying float vFade;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      // Squash horizontally to suggest a falling streak; uStreak 0 keeps it round.
      q.x *= mix(1.0, 2.6, uStreak);
      float d = dot(q, q);
      if (d > 0.25) discard;
      float a = smoothstep(0.25, 0.02, d) * uOpacity * vFade;
      gl_FragColor = vec4(uColour, a);
    }`,
});

const points = new THREE.Points(geo, mat);
points.frustumCulled = false;             // positions are shader-derived
points.renderOrder = 2;
scene.add(points);

let time = 0;

export function setWeather(spec: WeatherSpec | null | undefined) {
  if (!spec || spec.count <= 0) { geo.setDrawRange(0, 0); points.visible = false; return; }
  points.visible = true;
  geo.setDrawRange(0, Math.min(spec.count, MAX));
  mat.uniforms.uColour.value.setHex(spec.colour);
  mat.uniforms.uSize.value = spec.size;
  mat.uniforms.uFall.value = spec.fall;
  mat.uniforms.uSway.value = spec.sway;
  mat.uniforms.uOpacity.value = spec.opacity;
  mat.uniforms.uStreak.value = spec.streak;
}

export function updateWeather(dt: number) {
  if (!points.visible) return;
  time += dt;
  mat.uniforms.uTime.value = time;
  // Snap the box to the camera on a grid the size of the box, so specks never
  // appear to be dragged along by the player — the weather stays world-locked
  // while the *box* teleports a whole period at a time.
  points.position.set(
    Math.round(camera.position.x / BOX) * BOX,
    0,
    Math.round(camera.position.z / BOX) * BOX,
  );
}
