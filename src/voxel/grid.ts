/* ============================ voxel grid ============================ */
// The world as a dense block of bytes: one palette index per voxel, 0 = air.
// Everything the voxel engine does — meshing, shot traces, player collision,
// destruction, the support check — reads and writes this one array.
//
// The array is stored with a one-voxel PADDING shell on every side. That is the
// single trick that keeps the hot loops honest: the mesher and the flood fill
// look at a voxel's six (or, for ambient occlusion, twenty-six) neighbours
// millions of times, and with the shell in place none of those reads can ever
// leave the array — so none of them needs a bounds check. The shell is filled
// with VOID (a solid nobody ever draws) below ground level and air above it,
// which also stops the mesher from emitting the world's unseen underside.
//
// Layout is column-major: a vertical column of voxels is contiguous in memory,
// because "what is under / in front of the player" is by far the most common
// question and it is always asked one column at a time.

export const VOID = 127;      // padding-only: solid, never meshed, never carved
export const SCORCH = 128;    // high bit: this voxel has been scorched by a hit
export const MAT_MASK = 127;

export interface RayHit {
  t: number;                        // distance along the ray, world units
  i: number; j: number; k: number;  // the voxel that stopped it
  nx: number; ny: number; nz: number; // face normal of the entry face
  m: number;                        // its palette byte (may carry SCORCH)
}
export const makeHit = (): RayHit => ({ t: 0, i: 0, j: 0, k: 0, nx: 0, ny: 1, nz: 0, m: 0 });

export class VoxelGrid {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly vs: number; readonly inv: number;
  readonly ox: number; readonly oy: number; readonly oz: number;
  // padded storage dims and strides
  readonly SX: number; readonly SY: number; readonly SZ: number;
  readonly si: number; readonly sj = 1; readonly sk: number;
  readonly data: Uint8Array;
  // Voxels with j < groundJ are the ground itself: always supported, and the
  // thing every other voxel must ultimately be connected to.
  groundJ = 0;
  // Indestructible shell: the bottom layer (bedrock), plus every column outside
  // the box lockI0 ≤ i < lockI1, lockK0 ≤ k < lockK1, at every height — so no
  // amount of gunfire opens a hole out of the world. The voxelizer sets the four
  // planes a few layers into the boundary walls (lockBounds in voxelize.ts); by default the
  // box is the whole grid and nothing but bedrock is locked.
  lockI0 = 0; lockI1: number; lockK0 = 0; lockK1: number;
  // Where a player may stand, which is not the same question. Below wallTop the
  // lock planes, so a hole shot into the wall can be walked into; from wallTop up
  // the walls' inner faces (faceI0 is the first open column inside the west wall,
  // faceI1 the first column of the east wall; likewise in k), so the top of the
  // wall is no ledge. setLock puts them on the lock planes, which is where they
  // stay on a side with no known wall. Player-only: they change nothing a shot can dig.
  faceI0 = 0; faceI1: number; faceK0 = 0; faceK1: number; wallTop = Infinity;
  // The locked cores of inner barrier walls, per column (i + nx·k): every voxel
  // with j < coreTop is locked. A core runs from bedrock to the wall top, so a
  // column is either core all the way up or not at all. Null when the map
  // marks no barriers.
  coreTop: Uint16Array | null = null;

  constructor(nx: number, ny: number, nz: number, vs: number, ox: number, oy: number, oz: number) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.vs = vs; this.inv = 1 / vs;
    this.ox = ox; this.oy = oy; this.oz = oz;
    this.SX = nx + 2; this.SY = ny + 2; this.SZ = nz + 2;
    this.si = this.SY; this.sk = this.SY * this.SX;
    this.data = new Uint8Array(this.SX * this.SY * this.SZ);
    this.lockI1 = this.faceI1 = nx; this.lockK1 = this.faceK1 = nz;
  }

  idx(i: number, j: number, k: number) { return (j + 1) + this.SY * ((i + 1) + this.SX * (k + 1)); }
  inside(i: number, j: number, k: number) {
    return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz;
  }
  get(i: number, j: number, k: number) { return this.inside(i, j, k) ? this.data[this.idx(i, j, k)] : 0; }
  set(i: number, j: number, k: number, m: number) { if (this.inside(i, j, k)) this.data[this.idx(i, j, k)] = m; }

  /* Four integer compares: this sits in the carve's inner loop, and it must be a
     pure function of (i,j,k) so every client agrees on what a shot can take. */
  lockedCol(i: number, k: number) {
    return i < this.lockI0 || k < this.lockK0 || i >= this.lockI1 || k >= this.lockK1;
  }
  locked(i: number, j: number, k: number) {
    return (this.groundJ > 0 && j === 0) || this.lockedCol(i, k) ||
      (this.coreTop !== null && j < this.coreTop[i + this.nx * k]);
  }
  setLock(i0: number, i1: number, k0: number, k1: number) {
    const c = (v: number, n: number) => Math.max(0, Math.min(n, v));
    this.lockI0 = c(i0, this.nx); this.lockI1 = c(i1, this.nx);
    this.lockK0 = c(k0, this.nz); this.lockK1 = c(k1, this.nz);
    this.faceI0 = this.lockI0; this.faceI1 = this.lockI1; this.faceK0 = this.lockK0; this.faceK1 = this.lockK1;
  }

  /* Fill the padding shell: solid under the floor and beside the ground slab,
     air everywhere else. Call once after the grid has been populated. */
  sealPadding() {
    const { SX, SY, SZ, data } = this;
    for (let pk = 0; pk < SZ; pk++) for (let pi = 0; pi < SX; pi++) {
      const col = SY * (pi + SX * pk);
      const edge = pi === 0 || pk === 0 || pi === SX - 1 || pk === SZ - 1;
      data[col] = this.groundJ > 0 ? VOID : 0;                 // under the world
      data[col + SY - 1] = 0;                                  // above it
      if (edge) for (let pj = 1; pj < SY - 1; pj++) data[col + pj] = (pj - 1) < this.groundJ ? VOID : 0;
    }
  }

  /* world → voxel index along one axis */
  ix(x: number) { return Math.floor((x - this.ox) * this.inv); }
  iy(y: number) { return Math.floor((y - this.oy) * this.inv); }
  iz(z: number) { return Math.floor((z - this.oz) * this.inv); }

  solidAt(x: number, y: number, z: number) {
    const i = this.ix(x), j = this.iy(y), k = this.iz(z);
    return this.inside(i, j, k) && this.data[this.idx(i, j, k)] !== 0;
  }
  containsXZ(x: number, z: number) {
    return x >= this.ox && z >= this.oz && x < this.ox + this.nx * this.vs && z < this.oz + this.nz * this.vs;
  }

  /* Top of the highest solid voxel in the column under (x,z) whose top is at or
     below `maxY`. This is "the floor within step reach" for the player. Outside
     the grid the world is flat ground at y = 0. */
  groundBelow(x: number, z: number, maxY: number) {
    const i = this.ix(x), k = this.iz(z);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return 0;
    let j = Math.floor((maxY - this.oy) * this.inv + 1e-4) - 1;
    if (j >= this.ny) j = this.ny - 1;
    const col = this.idx(i, 0, k);
    for (; j >= 0; j--) if (this.data[col + j] !== 0) return this.oy + (j + 1) * this.vs;
    return this.oy;
  }

  /* Is anything solid in column (i,k) between world heights yLo and yHi? A voxel
     counts if it pokes above yLo and starts below yHi — exactly the test the old
     box colliders used ("taller than a step, lower than my head"). */
  columnBlocked(i: number, k: number, yLo: number, yHi: number) {
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return false;
    let j0 = Math.floor((yLo - this.oy) * this.inv + 1e-4);
    let j1 = Math.ceil((yHi - this.oy) * this.inv - 1e-4) - 1;
    if (j0 < 0) j0 = 0;
    if (j1 >= this.ny) j1 = this.ny - 1;
    const col = this.idx(i, 0, k);
    for (let j = j0; j <= j1; j++) if (this.data[col + j] !== 0) return true;
    return false;
  }

  /* The lowest place in the column under (x,z) where a body `height` tall can
     stand: solid underfoot, clear above. Used to drop spawning players onto the
     floor rather than onto the roof above it. */
  standAt(x: number, z: number, height: number) {
    const i = this.ix(x), k = this.iz(z);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return 0;
    const need = Math.ceil(height * this.inv);
    const col = this.idx(i, 0, k);
    let run = 0;
    for (let j = 0; j < this.ny; j++) {
      if (this.data[col + j] !== 0) run = 0;
      else if (++run >= need && j - run >= 0) return this.oy + (j - run + 1) * this.vs;
    }
    // nothing overhead all the way up: stand on the highest solid
    for (let j = this.ny - 1; j >= 0; j--) if (this.data[col + j] !== 0) return this.oy + (j + 1) * this.vs;
    return this.oy;
  }

  /* Amanatides–Woo voxel traversal. `d` must be unit length; `maxT` is in world
     units. Visits each voxel the ray passes through exactly once, in order, so a
     70 m shot costs a few hundred array reads however complex the map is. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: RayHit) {
    const inv = this.inv;
    const px = (ox - this.ox) * inv, py = (oy - this.oy) * inv, pz = (oz - this.oz) * inv;
    let t0 = 0, t1 = maxT * inv, axis = -1;
    // clip the ray to the grid's box, remembering which face it came in through
    const P = [px, py, pz], D = [dx, dy, dz], N = [this.nx, this.ny, this.nz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (P[a] < 0 || P[a] >= N[a]) return false; continue; }
      let ta = -P[a] / D[a], tb = (N[a] - P[a]) / D[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) { t0 = ta; axis = a; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    let t = t0;
    const eps = 1e-6;
    let i = Math.floor(px + dx * (t + eps)), j = Math.floor(py + dy * (t + eps)), k = Math.floor(pz + dz * (t + eps));
    if (i < 0) i = 0; else if (i >= this.nx) i = this.nx - 1;
    if (j < 0) j = 0; else if (j >= this.ny) j = this.ny - 1;
    if (k < 0) k = 0; else if (k >= this.nz) k = this.nz - 1;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const ddy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const ddz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let mx = dx > 0 ? (i + 1 - px) / dx : dx < 0 ? (i - px) / dx : Infinity;
    let my = dy > 0 ? (j + 1 - py) / dy : dy < 0 ? (j - py) / dy : Infinity;
    let mz = dz > 0 ? (k + 1 - pz) / dz : dz < 0 ? (k - pz) / dz : Infinity;
    const { data, si, sk } = this;
    let id = this.idx(i, j, k);
    for (;;) {
      const m = data[id];
      if (m !== 0) {
        out.t = t * this.vs; out.i = i; out.j = j; out.k = k; out.m = m;
        out.nx = axis === 0 ? -sx : 0; out.ny = axis === 1 ? -sy : 0; out.nz = axis === 2 ? -sz : 0;
        if (axis < 0) { out.nx = 0; out.ny = 1; out.nz = 0; }   // started inside a solid
        return true;
      }
      if (mx <= my && mx <= mz) { t = mx; mx += ddx; i += sx; id += sx * si; axis = 0; if (i < 0 || i >= this.nx) return false; }
      else if (my <= mz)        { t = my; my += ddy; j += sy; id += sy;      axis = 1; if (j < 0 || j >= this.ny) return false; }
      else                      { t = mz; mz += ddz; k += sz; id += sz * sk; axis = 2; if (k < 0 || k >= this.nz) return false; }
      if (t > t1) return false;
    }
  }
}
