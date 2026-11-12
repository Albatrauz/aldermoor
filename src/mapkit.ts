/* ============================ map building toolkit ============================ */
// The primitive idiom every map is built from. Each map's build() spins up a
// fresh `Builder` whose helpers add meshes to a private THREE.Group and push
// colliders to a private array — so the world manager can swap a whole map by
// dropping one group and one collider set. Colliders carry a vertical span
// (base..top) and may be ramps whose top interpolates along one axis;
// controls.ts and effects.ts consume them.
import * as THREE from 'three';
import { mesh, uvBox } from './core';
import type { Surface } from './materials';
import type { WeatherSpec } from './weather';
import type { SkyParams } from './sky';

export interface Collider {
  x: number; z: number; hx: number; hz: number;
  base: number; top: number; h: number;
  kind: 'box' | 'ramp';
  loTop?: number; hiTop?: number; axis?: 'x' | 'z';
  // The material this collider was built from. Carried so a bullet impact can
  // look up what it hit (sand throws dust, steel throws sparks) without every
  // map having to declare its surfaces a second time.
  mat?: THREE.Material;
}
export interface Spawn { x: number; z: number; yaw: number; }
// A callout circle. `minY`/`maxY` (feet height) restrict it to one storey of a
// map that has more than one; a zone without them applies at any height.
export interface Zone { x: number; z: number; r: number; name: string; minY?: number; maxY?: number; }

// The colour/atmosphere a map asks the shared sky, sun and fog to wear.
export interface MapEnv {
  // The atmosphere itself. This drives the visible sky AND — baked once at map
  // load — the ambient light every material sees, so the two cannot drift apart.
  sky: SkyParams;
  sunDir: [number, number, number];
  sunColor: number; sunIntensity: number;
  // How much of the baked sky reaches the materials. The lever that lets one
  // lighting rig serve a glaring desert and an overcast street.
  environmentIntensity: number;
  // 0..1. Low on an overcast map, where shadows should be a suggestion rather
  // than a hole — and where a black shadow is somewhere a player disappears.
  shadowIntensity: number;
  // A little direct fill survives the env map: it shapes surfaces the sky alone
  // leaves ambiguous. Both are much weaker than they were before the env map.
  hemiSky: number; hemiGround: number; hemiIntensity: number;
  fillColor: number; fillIntensity: number;
  fogColor: number; fogDensity: number;
  // Fog thickens toward the ground: haze in the desert, mist pooling in alleys.
  fogHeight: number; fogHeightFalloff: number;
  exposure: number;
  toneMapping: THREE.ToneMapping;
  glowColor: number; glowOpacity: number;
  // What the open ground throws up when shot — fire() resolves ground hits
  // geometrically, so there is no collider material to look up.
  groundSurface: Surface;
  // Falling snow, drifting dust, or nothing. count:0 switches it off.
  weather?: WeatherSpec;
  // How much of the ambient light is left where no sky reaches at all (0..1,
  // default 0.3). A map that is mostly indoors raises it: its rooms are lit by
  // lamps the sky-light model knows nothing about.
  interiorMin?: number;
  // Player lanterns. They belong to a night-time market town, not to high noon
  // in a desert — off unless a map actually wants them.
  lanterns: boolean;
}

// Where the lobby camera drifts while the menu is up (a gentle establishing shot).
export interface MenuCam { x: number; y: number; z: number; yaw: number; pitch: number; }

// The playable floor as the outer walls enclose it: the rectangle between their
// inner faces (x0 west, x1 east, z0 south, z1 north), and the height of the
// lowest of them. The voxelizer locks everything a few layers behind these faces,
// so it must be where the walls really are — not merely where the map happens to
// end. A side whose wall wasn't marked `boundary` is undefined, and the voxelizer
// falls back to a rim at the grid edge on that side alone.
export interface Bounds { x0?: number; x1?: number; z0?: number; z1?: number; top: number; }

// One solid span of a wall marked `barrier`: a wall that edges the playable
// lanes, with open ground or a sealed-off block behind it. The voxelizer locks a
// core through its middle, so it can be shot up but never shot through.
// `along` is the axis the wall runs on; its thickness lies across the other one.
export interface Barrier { x0: number; x1: number; z0: number; z1: number; top: number; along: 'x' | 'z'; }

// A picture laid flat on the outer face of some voxels: a logo, a printed sign —
// anything the voxel lattice is far too coarse to draw legibly. It is not
// voxelized; it is drawn as-is, a hair in front of the face it lies on, and it
// loses a cell wherever the voxel behind that cell is shot away (see decals.ts).
// `at` is that face: its z for a decal facing 'n'/'s', its x for 'e'/'w'.
// `a0..a1` is its extent across (x for 'n'/'s', z for 'e'/'w') and `y0..y1` up;
// keep all four on the voxel lattice so the cells line up with the voxels.
export interface Decal {
  tex: THREE.Texture;
  facing: 'n' | 's' | 'e' | 'w';
  at: number;
  a0: number; a1: number;
  y0: number; y1: number;
}

export interface BuiltMap {
  group: THREE.Group;
  decals?: Decal[];
  colliders: Collider[];
  spawns: Spawn[];
  zones: Zone[];
  bounds?: Bounds;     // from B.bounds(); without it the voxelizer locks a rim at the grid edge
  barriers?: Barrier[];
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
  const out = uvBox(g, uvScale);
  // The voxelizer rasterises primitives from their parameters, not their
  // triangles; a hand-built wedge has none, so it carries its dimensions here.
  out.userData.shape = { type: 'Wedge', w, h, d };
  return out;
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
  barriers: Barrier[];
  decals: Decal[];
  WH: number;
  WT: number;
  add(obj: THREE.Object3D): void;
  decal(d: Decal): void;
  addCollider(x: number, z: number, hx: number, hz: number, top?: number, base?: number, mat?: THREE.Material): void;
  addRamp(x: number, z: number, hx: number, hz: number, loTop: number, hiTop: number, axis?: 'x' | 'z', mat?: THREE.Material): void;
  block(cx: number, cz: number, sx: number, sy: number, sz: number, mat?: THREE.Material, base?: number, uv?: number): THREE.Mesh;
  solid(cx: number, cz: number, sx: number, sy: number, sz: number, mat?: THREE.Material, base?: number): void;
  wallX(z: number, x1: number, x2: number, opts?: WallOpts): void;
  wallZ(x: number, z1: number, z2: number, opts?: WallOpts): void;
  lintel(cx: number, cz: number, sx: number, sz: number, under?: number, top?: number, mat?: THREE.Material): void;
  ramp(cx: number, cz: number, sx: number, sz: number, h: number, facing: '+x' | '-x' | '+z' | '-z', mat?: THREE.Material): void;
  bounds(): Bounds | undefined;
}

// `boundary` marks one of the four outer walls (see Bounds); `barrier` an inner
// wall that must never be breached (see Barrier). Every span of the call is one.
interface WallOpts { h?: number; t?: number; gaps?: [number, number][]; mat?: THREE.Material; base?: number; boundary?: boolean; barrier?: boolean; }

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
  const barriers: Barrier[] = [];
  const decals: Decal[] = [];
  const WH = opts.wallH ?? 5;
  const WT = opts.wallT ?? 0.8;
  const wallMat = opts.wallMat;
  const rampMat = opts.rampMat;

  const add = (obj: THREE.Object3D) => { group.add(obj); };
  const decal = (d: Decal) => { decals.push(d); };

  const addCollider: Builder['addCollider'] = (x, z, hx, hz, top = 5, base = 0, mat = wallMat) =>
    colliders.push({ x, z, hx, hz, base, top, h: top, kind: 'box', mat });

  const addRamp: Builder['addRamp'] = (x, z, hx, hz, loTop, hiTop, axis = 'x', mat = rampMat) =>
    colliders.push({ x, z, hx, hz, base: 0, loTop, hiTop, axis,
      top: Math.max(loTop, hiTop), h: Math.max(loTop, hiTop), kind: 'ramp', mat });

  // a textured box whose *base* sits at y=`base` (no collider)
  const block: Builder['block'] = (cx, cz, sx, sy, sz, mat = wallMat, base = 0, uv = .22) => {
    const m = mesh(uvBox(new THREE.BoxGeometry(sx, sy, sz), uv), mat, cx, base + sy / 2, cz);
    group.add(m);
    return m;
  };

  // box + matching collider
  const solid: Builder['solid'] = (cx, cz, sx, sy, sz, mat = wallMat, base = 0) => {
    block(cx, cz, sx, sy, sz, mat, base);
    addCollider(cx, cz, sx / 2, sz / 2, base + sy, base, mat);
  };

  // outer walls, as [position across, thickness, height]: walls along X, along Z
  const outerX: number[][] = [], outerZ: number[][] = [];

  // wall running along X at fixed z, with optional doorway gaps
  const wallX: Builder['wallX'] = (z, x1, x2, { h = WH, t = WT, gaps = [], mat = wallMat, base = 0, boundary = false, barrier = false } = {}) => {
    for (const [a, b] of spans(x1, x2, gaps)) {
      solid((a + b) / 2, z, b - a, h - base, t, mat, base);
      if (barrier) barriers.push({ x0: a, x1: b, z0: z - t / 2, z1: z + t / 2, top: h, along: 'x' });
    }
    if (boundary) outerX.push([z, t, h]);
  };
  // wall running along Z at fixed x
  const wallZ: Builder['wallZ'] = (x, z1, z2, { h = WH, t = WT, gaps = [], mat = wallMat, base = 0, boundary = false, barrier = false } = {}) => {
    for (const [a, b] of spans(z1, z2, gaps)) {
      solid(x, (a + b) / 2, t, h - base, b - a, mat, base);
      if (barrier) barriers.push({ x0: x - t / 2, x1: x + t / 2, z0: a, z1: b, top: h, along: 'z' });
    }
    if (boundary) outerZ.push([x, t, h]);
  };

  // The rectangle the outer walls enclose, one side at a time, so a wall that
  // forgot its `boundary: true` costs only its own side. A marked wall belongs to
  // the side of the map it stands on, measured from the middle of everything
  // built; the outermost one there wins, and its inner face is the one facing in.
  // A side with no marked wall is left undefined; no marked wall at all, no bounds.
  const bounds: Builder['bounds'] = () => {
    if (!outerX.length && !outerZ.length) return undefined;
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
    for (const c of colliders) {
      ax = Math.min(ax, c.x - c.hx); bx = Math.max(bx, c.x + c.hx);
      az = Math.min(az, c.z - c.hz); bz = Math.max(bz, c.z + c.hz);
    }
    // inner face of the outermost wall on the low (s = −1) or high (s = 1) side of `mid`
    const face = (ws: number[][], mid: number, s: number) => {
      let w: number[] | undefined;
      for (const q of ws) if ((q[0] - mid) * s > 0 && (!w || (q[0] - w[0]) * s > 0)) w = q;
      return w && w[0] - s * w[1] / 2;
    };
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    return {
      x0: face(outerZ, mx, -1), x1: face(outerZ, mx, 1), z0: face(outerX, mz, -1), z1: face(outerX, mz, 1),
      top: Math.min(...outerX.map((o) => o[2]), ...outerZ.map((o) => o[2])),
    };
  };

  // overhead beam across a doorway: passable below `under`, blocks shots above
  const lintel: Builder['lintel'] = (cx, cz, sx, sz, under = 3.0, top = WH, mat = wallMat) => {
    block(cx, cz, sx, top - under, sz, mat, under);
    addCollider(cx, cz, sx / 2, sz / 2, top, under, mat);
  };

  // walkable ramp: `facing` is the direction of ascent
  const ramp: Builder['ramp'] = (cx, cz, sx, sz, h, facing, mat = rampMat) => {
    const along = (facing === '+x' || facing === '-x');
    const g = wedgeGeo(along ? sx : sz, h, along ? sz : sx);
    const ry = facing === '+x' ? 0 : facing === '-x' ? Math.PI : facing === '+z' ? -Math.PI / 2 : Math.PI / 2;
    group.add(mesh(g, mat, cx, 0, cz, { ry }));
    if (facing === '+x') addRamp(cx, cz, sx / 2, sz / 2, 0, h, 'x', mat);
    else if (facing === '-x') addRamp(cx, cz, sx / 2, sz / 2, h, 0, 'x', mat);
    else if (facing === '+z') addRamp(cx, cz, sx / 2, sz / 2, 0, h, 'z', mat);
    else addRamp(cx, cz, sx / 2, sz / 2, h, 0, 'z', mat);
  };

  return { group, colliders, barriers, decals, WH, WT, add, decal, addCollider, addRamp, block, solid, wallX, wallZ, lintel, ramp, bounds };
}
