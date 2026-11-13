/* ============================ voxel models from glTF ============================ */
// The fighters' guns used to be built in code from boxes and cylinders. A gun can
// now also come from a modelled .glb (e.g. generated in Tripo): smooth, textured,
// a few thousand triangles. Dropped into a voxel world as-is it would look like
// it wandered in from another game, so it goes through the same treatment as the
// round primitives in rig.ts — rasterised into small voxels and re-meshed — only
// here every voxel also takes its colour from the model's texture.
//
// How a model becomes voxels:
//   1. Put it in a canonical frame: barrel along +Z, Y up, scaled to `length`.
//      Models are expected to lie with their long axis on X (Tripo's default),
//      muzzle toward `muzzleSign`·X.
//   2. Surface pass: every triangle is sampled at half-voxel steps; each sample
//      marks its voxel and adds the texel under it to that voxel's colour. A
//      barrel thinner than a voxel still leaves a line of voxels behind.
//   3. Fill: air is flood-filled in from outside the model. Whatever the flood
//      never reaches is the inside, and is made solid so it emits no faces.
//   4. Mesh: one quad per voxel face that looks into outside air, coloured with
//      the voxel's averaged texel.
// The result is cached per (url, length, voxel size), so every remote player
// carrying the same gun shares one geometry.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface VoxelModelFit {
  length: number;      // overall length after scaling, metres
  vs: number;          // voxel edge, metres
  muzzleSign?: 1 | -1; // which end of the model's X axis the muzzle is on (default +X)
}

export interface VoxelModel {
  geometry: THREE.BufferGeometry;
  muzzle: THREE.Vector3;  // muzzle point in the geometry's own frame (barrel along +Z)
}

const loader = new GLTFLoader();
const gltfs = new Map<string, Promise<THREE.Group>>();
const models = new Map<string, Promise<VoxelModel>>();

function loadScene(url: string) {
  let p = gltfs.get(url);
  if (!p) { p = loader.loadAsync(url).then((g) => g.scene); gltfs.set(url, p); }
  return p;
}

export function loadVoxelModel(url: string, fit: VoxelModelFit): Promise<VoxelModel> {
  const key = `${url}|${fit.length}|${fit.vs}|${fit.muzzleSign ?? 1}`;
  let p = models.get(key);
  if (!p) { p = loadScene(url).then((scene) => voxelize(scene, fit)); models.set(key, p); }
  return p;
}

/* Texel reader for a material's base-colour map (sRGB bytes). */
type Sampler = (u: number, v: number, out: number[]) => void;
const pixelCache = new WeakMap<object, Sampler>();

function samplerFor(mat: THREE.Material | undefined): Sampler {
  const std = mat as THREE.MeshStandardMaterial | undefined;
  const map = std?.map;
  const img = map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img || !img.width) {
    const c = (std?.color ?? new THREE.Color(0x888888)).clone().convertLinearToSRGB();
    const rgb = [c.r * 255, c.g * 255, c.b * 255];
    return (_u, _v, out) => { out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; };
  }
  const hit = pixelCache.get(img);
  if (hit) return hit;
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, w, h).data;
  const flip = map!.flipY;  // glTF textures are not flipped: v=0 is the top row
  const s: Sampler = (u, v, out) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const x = Math.min(w - 1, (u * w) | 0);
    const y = Math.min(h - 1, ((flip ? 1 - v : v) * h) | 0);
    const o = (y * w + x) * 4;
    out[0] = px[o]; out[1] = px[o + 1]; out[2] = px[o + 2];
  };
  pixelCache.set(img, s);
  return s;
}

interface Tri { pos: Float32Array; uv: Float32Array | null; idx: ArrayLike<number>; sample: Sampler }

function voxelize(scene: THREE.Object3D, fit: VoxelModelFit): VoxelModel {
  scene.updateMatrixWorld(true);
  const sign = fit.muzzleSign ?? 1;

  // Gather every mesh in world space.
  const parts: Tri[] = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    const src = geo.getAttribute('position');
    const pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      box.expandByPoint(v);
    }
    const uvA = geo.getAttribute('uv');
    const uv = uvA ? new Float32Array(uvA.count * 2) : null;
    if (uvA && uv) for (let i = 0; i < uvA.count; i++) { uv[i * 2] = uvA.getX(i); uv[i * 2 + 1] = uvA.getY(i); }
    const idx = geo.index ? geo.index.array : Array.from({ length: src.count }, (_, i) => i);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    parts.push({ pos, uv, idx, sample: samplerFor(mat) });
  });

  // Canonical frame: model X (muzzle end) → +Z, Y stays up, centred on the
  // bounding box, scaled so the long axis is `length` metres.
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const k = fit.length / size.x;
  const toLocal = (x: number, y: number, z: number, out: THREE.Vector3) =>
    out.set(-sign * (z - mid.z) * k, (y - box.min.y) * k, sign * (x - mid.x) * k);

  const vs = fit.vs;
  const lo = toLocal(box.min.x, box.min.y, box.min.z, new THREE.Vector3());
  const hi = toLocal(box.max.x, box.max.y, box.max.z, new THREE.Vector3());
  const min = lo.clone().min(hi), max = lo.max(hi);
  // one voxel of air all round, so the outside flood can wrap the whole model
  const nx = Math.ceil((max.x - min.x) / vs) + 2;
  const ny = Math.ceil((max.y - min.y) / vs) + 2;
  const nz = Math.ceil((max.z - min.z) / vs) + 2;
  const ox = min.x - vs, oy = min.y - vs, oz = min.z - vs;
  const N = nx * ny * nz;
  const at = (i: number, j: number, l: number) => (l * ny + j) * nx + i;

  const solid = new Uint8Array(N);       // 1 = surface, 2 = inside, 3 = outside air
  const sum = new Float32Array(N * 3);
  const cnt = new Uint16Array(N);

  // Surface pass.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const rgb = [0, 0, 0];
  let muzzleZ = -Infinity;
  for (const t of parts) {
    for (let f = 0; f + 2 < t.idx.length; f += 3) {
      const i0 = t.idx[f], i1 = t.idx[f + 1], i2 = t.idx[f + 2];
      toLocal(t.pos[i0 * 3], t.pos[i0 * 3 + 1], t.pos[i0 * 3 + 2], a);
      toLocal(t.pos[i1 * 3], t.pos[i1 * 3 + 1], t.pos[i1 * 3 + 2], b);
      toLocal(t.pos[i2 * 3], t.pos[i2 * 3 + 1], t.pos[i2 * 3 + 2], c);
      muzzleZ = Math.max(muzzleZ, a.z, b.z, c.z);
      const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const n = Math.max(1, Math.ceil(edge / (vs * .5)));
      for (let s = 0; s <= n; s++) for (let r = 0; r <= n - s; r++) {
        const wb = s / n, wc = r / n, wa = 1 - wb - wc;
        p.set(a.x * wa + b.x * wb + c.x * wc, a.y * wa + b.y * wb + c.y * wc, a.z * wa + b.z * wb + c.z * wc);
        const i = Math.floor((p.x - ox) / vs), j = Math.floor((p.y - oy) / vs), l = Math.floor((p.z - oz) / vs);
        const id = at(i, j, l);
        solid[id] = 1;
        if (t.uv) {
          const u = t.uv[i0 * 2] * wa + t.uv[i1 * 2] * wb + t.uv[i2 * 2] * wc;
          const w = t.uv[i0 * 2 + 1] * wa + t.uv[i1 * 2 + 1] * wb + t.uv[i2 * 2 + 1] * wc;
          t.sample(u, w, rgb);
        } else t.sample(0, 0, rgb);
        if (cnt[id] < 65535) { sum[id * 3] += rgb[0]; sum[id * 3 + 1] += rgb[1]; sum[id * 3 + 2] += rgb[2]; cnt[id]++; }
      }
    }
  }

  // Fill: flood outside air from the corner (always air thanks to the margin).
  const stack = new Int32Array(N);
  let sp = 0;
  stack[sp++] = 0; solid[0] = 3;
  while (sp) {
    const id = stack[--sp];
    const i = id % nx, j = ((id / nx) | 0) % ny, l = (id / (nx * ny)) | 0;
    const push = (q: number) => { if (solid[q] === 0) { solid[q] = 3; stack[sp++] = q; } };
    if (i > 0) push(id - 1); if (i < nx - 1) push(id + 1);
    if (j > 0) push(id - nx); if (j < ny - 1) push(id + nx);
    if (l > 0) push(id - nx * ny); if (l < nz - 1) push(id + nx * ny);
  }

  // Mesh: a quad for every surface-voxel face that looks into outside air.
  const P: number[] = [], Nn: number[] = [], C: number[] = [], I: number[] = [];
  const col = new THREE.Color();
  const FACES: [number, number, number, number[][]][] = [
    [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [-1, 0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [0, 1, 0, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [0, 0, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  // Cheap directional shade per face, so flat-coloured blocks still read as
  // blocks even where the scene lighting is flat.
  const SHADE = [.92, .92, 1, .7, .86, .86];
  for (let l = 1; l < nz - 1; l++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const id = at(i, j, l);
    if (solid[id] !== 1) continue;
    const n = cnt[id] || 1;
    col.setRGB(sum[id * 3] / n / 255, sum[id * 3 + 1] / n / 255, sum[id * 3 + 2] / n / 255, THREE.SRGBColorSpace);
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz, corners] = FACES[f];
      if (solid[at(i + dx, j + dy, l + dz)] !== 3) continue;
      const base = P.length / 3;
      for (const [cx, cy, cz] of corners) {
        P.push(ox + (i + cx) * vs, oy + (j + cy) * vs, oz + (l + cz) * vs);
        Nn.push(dx, dy, dz);
        C.push(col.r * SHADE[f], col.g * SHADE[f], col.b * SHADE[f]);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geometry.setIndex(I);
  geometry.computeBoundingSphere();

  // Muzzle: the middle of the vertices in the last 2% of the barrel.
  const tip = new THREE.Vector3();
  let tn = 0;
  for (const t of parts) for (let i = 0; i < t.pos.length; i += 3) {
    toLocal(t.pos[i], t.pos[i + 1], t.pos[i + 2], p);
    if (p.z > muzzleZ - fit.length * .02) { tip.add(p); tn++; }
  }
  tip.divideScalar(tn || 1); tip.z = muzzleZ;
  return { geometry, muzzle: tip };
}
