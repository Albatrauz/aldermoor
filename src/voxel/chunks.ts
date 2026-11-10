/* ============================ chunked voxel meshes ============================ */
// The grid is drawn as a lattice of 32³-voxel chunks, each its own mesh. That is
// what makes destruction affordable: knocking a hole in a wall re-meshes the one
// or two chunks the hole touches (about a millisecond each) instead of the map.
// It also hands three's frustum culling something useful to cull.
//
// Edits mark chunks dirty; flush() re-meshes them under a per-frame time budget
// so that a whole facade coming down spreads its cost over a few frames instead
// of landing as one long hitch.
import * as THREE from 'three';
import type { VoxelGrid } from './grid';
import { meshRegion, type MeshData } from './mesher';

export const CH = 32;

export function geometryFrom(d: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3, true));
  g.setAttribute('aVox', new THREE.BufferAttribute(d.col, 4, true));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  return g;
}

export class ChunkSet {
  readonly group = new THREE.Group();
  readonly cx: number; readonly cy: number; readonly cz: number;
  private meshes: (THREE.Mesh | null)[];
  private dirty: Uint8Array;
  private queue: number[] = [];
  quads = 0;

  constructor(readonly grid: VoxelGrid, readonly material: THREE.Material, private shadows = true) {
    this.cx = Math.ceil(grid.nx / CH); this.cy = Math.ceil(grid.ny / CH); this.cz = Math.ceil(grid.nz / CH);
    const n = this.cx * this.cy * this.cz;
    this.meshes = new Array(n).fill(null);
    this.dirty = new Uint8Array(n);
  }

  private rebuild(c: number) {
    const g = this.grid;
    const ci = c % this.cx, cj = Math.floor(c / this.cx) % this.cy, ck = Math.floor(c / (this.cx * this.cy));
    const i0 = ci * CH, j0 = cj * CH, k0 = ck * CH;
    const ni = Math.min(CH, g.nx - i0), nj = Math.min(CH, g.ny - j0), nk = Math.min(CH, g.nz - k0);
    const data = meshRegion(g, i0, j0, k0, ni, nj, nk);
    let mesh = this.meshes[c];
    if (mesh) { this.quads -= mesh.geometry.index!.count / 6; mesh.geometry.dispose(); }
    if (!data) {
      if (mesh) { this.group.remove(mesh); this.meshes[c] = null; }
      return;
    }
    const geo = geometryFrom(data);
    // The chunk's own box is a perfectly good culling volume and costs nothing
    // to compute, unlike a sweep over every vertex.
    const vs = g.vs;
    const min = new THREE.Vector3(g.ox + i0 * vs, g.oy + j0 * vs, g.oz + k0 * vs);
    const max = new THREE.Vector3(min.x + ni * vs, min.y + nj * vs, min.z + nk * vs);
    geo.boundingBox = new THREE.Box3(min, max);
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    if (mesh) mesh.geometry = geo;
    else {
      mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = mesh.receiveShadow = this.shadows;
      mesh.matrixAutoUpdate = false;
      this.meshes[c] = mesh;
      this.group.add(mesh);
    }
    this.quads += data.idx.length / 6;
  }

  buildAll() {
    for (let c = 0; c < this.meshes.length; c++) this.rebuild(c);
  }

  /* A voxel changed. Its faces live in its own chunk, but the AO baked into
     neighbouring faces reaches one voxel further — so every chunk within one
     voxel of the change is stale. */
  markVoxel(i: number, j: number, k: number) {
    const a0 = Math.max(0, (i - 1) >> 5), a1 = Math.min(this.cx - 1, (i + 1) >> 5);
    const b0 = Math.max(0, (j - 1) >> 5), b1 = Math.min(this.cy - 1, (j + 1) >> 5);
    const c0 = Math.max(0, (k - 1) >> 5), c1 = Math.min(this.cz - 1, (k + 1) >> 5);
    for (let ck = c0; ck <= c1; ck++) for (let cj = b0; cj <= b1; cj++) for (let ci = a0; ci <= a1; ci++) {
      const c = ci + this.cx * (cj + this.cy * ck);
      if (!this.dirty[c]) { this.dirty[c] = 1; this.queue.push(c); }
    }
  }

  get pending() { return this.queue.length; }

  /* Re-mesh dirty chunks until the budget runs out. Returns how many were done. */
  flush(budgetMs = 6) {
    if (!this.queue.length) return 0;
    const t0 = performance.now();
    let n = 0;
    while (this.queue.length) {
      const c = this.queue.shift() as number;
      this.dirty[c] = 0;
      this.rebuild(c);
      n++;
      if (performance.now() - t0 > budgetMs) break;
    }
    return n;
  }

  dispose() {
    for (const m of this.meshes) if (m) m.geometry.dispose();
    this.group.clear();
    this.queue.length = 0;
  }
}
