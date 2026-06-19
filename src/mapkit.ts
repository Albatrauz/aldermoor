/* ============================ map building toolkit ============================ */
// The primitive idiom every map is built from. Each map's build() spins up a
// fresh `Builder` whose helpers add meshes to a private THREE.Group and push
// colliders to a private array — so the world manager can swap a whole map by
// dropping one group and one collider set. Colliders carry a vertical span
// (base..top) and may be ramps whose top interpolates along one axis;
// controls.ts and effects.ts consume them.
import * as THREE from 'three';
import { mesh, uvBox } from './core';

export interface Collider {
  x: number; z: number; hx: number; hz: number;
  base: number; top: number; h: number;
  kind: 'box' | 'ramp';
  loTop?: number; hiTop?: number; axis?: 'x' | 'z';
}
export interface Spawn { x: number; z: number; yaw: number; }
export interface Zone { x: number; z: number; r: number; name: string; }

// The colour/atmosphere a map asks the shared sky, sun and fog to wear.
export interface MapEnv {
  skyTop: number; skyMid: number; skyLow: number;
  sunColor: number; sunIntensity: number; sunDir: [number, number, number];
  hemiSky: number; hemiGround: number; hemiIntensity: number;
  fillColor: number; fillIntensity: number;
  fogColor: number; fogDensity: number;
  exposure: number;
  glowColor: number; glowOpacity: number;
}

// Where the lobby camera drifts while the menu is up (a gentle establishing shot).
export interface MenuCam { x: number; y: number; z: number; yaw: number; pitch: number; }

export interface BuiltMap {
  group: THREE.Group;
  colliders: Collider[];
  spawns: Spawn[];
  zones: Zone[];
}

export interface MapDef {
  name: string;        // stable id used on the wire (e.g. 'dust2')
  label: string;       // human title shown in the UI (e.g. 'de_aldermoor')
  blurb: string;       // one-line flavour for the overview's "next up" line
  env: MapEnv;
  menuCam: MenuCam;
  build(): BuiltMap;
}

// Height of a collider's top surface at world point (px,pz). Ramps interpolate
// loTop→hiTop along their axis; boxes are flat.
export function colliderTopAt(c: Collider, px: number, pz: number): number {
  if (c.kind !== 'ramp') return c.top;
  const a = c.axis === 'x' ? (px - (c.x - c.hx)) / (2 * c.hx)
                           : (pz - (c.z - c.hz)) / (2 * c.hz);
  const t = Math.max(0, Math.min(1, a));
  return (c.loTop as number) + ((c.hiTop as number) - (c.loTop as number)) * t;
}

// right-triangle wedge rising from y=0 at −x to y=h at +x
// (triangles wound counter-clockwise seen from outside — front faces out)
export function wedgeGeo(w: number, h: number, d: number, uvScale = .25) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, -hd, hw, 0, hd, -hw, 0, hd,   // bottom
    -hw, 0, -hd, hw, h, hd, hw, h, -hd, -hw, 0, -hd, -hw, 0, hd, hw, h, hd,   // slope
    hw, 0, -hd, hw, h, hd, hw, 0, hd, hw, 0, -hd, hw, h, -hd, hw, h, hd,      // back
    -hw, 0, -hd, hw, h, -hd, hw, 0, -hd,                                       // side −z
    -hw, 0, hd, hw, 0, hd, hw, h, hd,                                          // side +z
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return uvBox(g, uvScale);
}

export interface BuilderOpts {
  wallMat: THREE.Material;   // default material for walls / blocks
  rampMat: THREE.Material;   // default material for walkable ramps
  wallH?: number;            // default wall height
  wallT?: number;            // default wall thickness
}

export interface Builder {
  group: THREE.Group;
  colliders: Collider[];
  WH: number;
  WT: number;
  add(obj: THREE.Object3D): void;
  addCollider(x: number, z: number, hx: number, hz: number, top?: number, base?: number): void;
  addRamp(x: number, z: number, hx: number, hz: number, loTop: number, hiTop: number, axis?: 'x' | 'z'): void;
  block(cx: number, cz: number, sx: number, sy: number, sz: number, mat?: THREE.Material, base?: number, uv?: number): THREE.Mesh;
  solid(cx: number, cz: number, sx: number, sy: number, sz: number, mat?: THREE.Material, base?: number): void;
  wallX(z: number, x1: number, x2: number, opts?: WallOpts): void;
  wallZ(x: number, z1: number, z2: number, opts?: WallOpts): void;
  lintel(cx: number, cz: number, sx: number, sz: number, under?: number, top?: number, mat?: THREE.Material): void;
  ramp(cx: number, cz: number, sx: number, sz: number, h: number, facing: '+x' | '-x' | '+z' | '-z', mat?: THREE.Material): void;
}

interface WallOpts { h?: number; t?: number; gaps?: [number, number][]; mat?: THREE.Material; base?: number; }

// split [a,b] by sorted gap intervals → the solid spans between the gaps
function spans(a: number, b: number, gaps: [number, number][]): [number, number][] {
  const gs = [...gaps].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = []; let cur = a;
  for (const [g1, g2] of gs) { if (g1 > cur + .01) out.push([cur, g1]); cur = Math.max(cur, g2); }
  if (cur < b - .01) out.push([cur, b]);
  return out;
}

export function createBuilder(opts: BuilderOpts): Builder {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const WH = opts.wallH ?? 5;
  const WT = opts.wallT ?? 0.8;
  const wallMat = opts.wallMat;
  const rampMat = opts.rampMat;

  const add = (obj: THREE.Object3D) => { group.add(obj); };

  const addCollider: Builder['addCollider'] = (x, z, hx, hz, top = 5, base = 0) =>
    colliders.push({ x, z, hx, hz, base, top, h: top, kind: 'box' });

  const addRamp: Builder['addRamp'] = (x, z, hx, hz, loTop, hiTop, axis = 'x') =>
    colliders.push({ x, z, hx, hz, base: 0, loTop, hiTop, axis,
      top: Math.max(loTop, hiTop), h: Math.max(loTop, hiTop), kind: 'ramp' });

  // a textured box whose *base* sits at y=`base` (no collider)
  const block: Builder['block'] = (cx, cz, sx, sy, sz, mat = wallMat, base = 0, uv = .22) => {
    const m = mesh(uvBox(new THREE.BoxGeometry(sx, sy, sz), uv), mat, cx, base + sy / 2, cz);
    group.add(m);
    return m;
  };

  // box + matching collider
  const solid: Builder['solid'] = (cx, cz, sx, sy, sz, mat = wallMat, base = 0) => {
    block(cx, cz, sx, sy, sz, mat, base);
    addCollider(cx, cz, sx / 2, sz / 2, base + sy, base);
  };

  // wall running along X at fixed z, with optional doorway gaps
  const wallX: Builder['wallX'] = (z, x1, x2, { h = WH, t = WT, gaps = [], mat = wallMat, base = 0 } = {}) => {
    for (const [a, b] of spans(x1, x2, gaps)) solid((a + b) / 2, z, b - a, h - base, t, mat, base);
  };
  // wall running along Z at fixed x
  const wallZ: Builder['wallZ'] = (x, z1, z2, { h = WH, t = WT, gaps = [], mat = wallMat, base = 0 } = {}) => {
    for (const [a, b] of spans(z1, z2, gaps)) solid(x, (a + b) / 2, t, h - base, b - a, mat, base);
  };

  // overhead beam across a doorway: passable below `under`, blocks shots above
  const lintel: Builder['lintel'] = (cx, cz, sx, sz, under = 3.0, top = WH, mat = wallMat) => {
    block(cx, cz, sx, top - under, sz, mat, under);
    addCollider(cx, cz, sx / 2, sz / 2, top, under);
  };

  // walkable ramp: `facing` is the direction of ascent
  const ramp: Builder['ramp'] = (cx, cz, sx, sz, h, facing, mat = rampMat) => {
    const along = (facing === '+x' || facing === '-x');
    const g = wedgeGeo(along ? sx : sz, h, along ? sz : sx);
    const ry = facing === '+x' ? 0 : facing === '-x' ? Math.PI : facing === '+z' ? -Math.PI / 2 : Math.PI / 2;
    group.add(mesh(g, mat, cx, 0, cz, { ry }));
    if (facing === '+x') addRamp(cx, cz, sx / 2, sz / 2, 0, h, 'x');
    else if (facing === '-x') addRamp(cx, cz, sx / 2, sz / 2, h, 0, 'x');
    else if (facing === '+z') addRamp(cx, cz, sx / 2, sz / 2, 0, h, 'z');
    else addRamp(cx, cz, sx / 2, sz / 2, h, 0, 'z');
  };

  return { group, colliders, WH, WT, add, addCollider, addRamp, block, solid, wallX, wallZ, lintel, ramp };
}
