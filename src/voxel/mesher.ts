/* ============================ greedy mesher ============================ */
// Turns a block of voxels into triangles. Drawing each voxel as a cube would be
// hopeless — the desert map alone has several million solid voxels — so two
// classic reductions are applied:
//
//   Face culling: a face is only emitted where solid meets air. The inside of a
//   wall produces nothing at all.
//
//   Greedy merging: the surviving faces of each slice are swept into the largest
//   rectangles of identical faces. A 30 m wall course becomes one quad instead
//   of 120.
//
// "Identical" includes ambient occlusion. Each face corner gets the standard
// voxel AO term (how many of the three voxels around that corner are solid), and
// two faces merge only if all four corner values match — so the soft darkening
// in creases and under ledges survives the merge exactly. AO is baked straight
// into the vertex colour, which is why it costs nothing at draw time and why a
// chunk has to be re-meshed when a neighbouring voxel changes.
//
// Reads go through the grid's padded storage with raw stride arithmetic: no
// bounds checks anywhere in the inner loops (see grid.ts).
import type { VoxelGrid } from './grid';
import { PAL } from './palette';

export interface MeshData {
  pos: Float32Array;   // xyz per vertex
  nor: Int8Array;      // xyz per vertex, normalised bytes
  col: Uint8Array;     // rgb (sRGB, AO premultiplied) + gloss per vertex
  idx: Uint32Array;
}

// AO darkening per corner level (0 = tight corner … 3 = open), applied in sRGB.
const AOF = [0.5, 0.67, 0.84, 1];

// Scratch buffers, grown on demand and reused across calls.
let P = new Float32Array(12 * 8192), N = new Int8Array(12 * 8192), C = new Uint8Array(16 * 8192), I = new Uint32Array(6 * 8192);
let nq = 0;
let mask = new Int32Array(64 * 64);

function grow() {
  const cap = (P.length / 12) * 2;
  const p = new Float32Array(12 * cap); p.set(P); P = p;
  const n = new Int8Array(12 * cap); n.set(N); N = n;
  const c = new Uint8Array(16 * cap); c.set(C); C = c;
  const i = new Uint32Array(6 * cap); i.set(I); I = i;
}

/* Mesh the voxels in [i0,i0+ni) × [j0,j0+nj) × [k0,k0+nk). Positions come out in
   world space, minus (offX,offY,offZ). Returns null if nothing is visible. */
export function meshRegion(
  g: VoxelGrid, i0: number, j0: number, k0: number, ni: number, nj: number, nk: number,
  ao = true, offX = 0, offY = 0, offZ = 0,
): MeshData | null {
  nq = 0;
  const data = g.data, vs = g.vs;
  const dims = [ni, nj, nk], org = [i0, j0, k0], strides = [g.si, 1, g.sk];
  const wo = [g.ox - offX, g.oy - offY, g.oz - offZ];
  const base0 = g.idx(i0, j0, k0);
  const q = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const nd = dims[d], nu = dims[u], nv = dims[v];
    const sd = strides[d], su = strides[u], sv = strides[v];
    if (mask.length < nu * nv) mask = new Int32Array(nu * nv);

    for (let side = 1; side >= -1; side -= 2) {
      const sn = side * sd;
      for (let a = 0; a < nd; a++) {
        const base = base0 + a * sd;
        let any = false;
        for (let c = 0; c < nv; c++) {
          let id = base + c * sv;
          for (let b = 0; b < nu; b++, id += su) {
            const m = data[id];
            let val = 0;
            if (m !== 0 && data[id + sn] === 0) {
              if (ao) {
                const f = id + sn;       // the empty cell this face looks into
                const um = data[f - su] !== 0 ? 1 : 0, up = data[f + su] !== 0 ? 1 : 0;
                const vm = data[f - sv] !== 0 ? 1 : 0, vp = data[f + sv] !== 0 ? 1 : 0;
                const a0 = um & vm ? 0 : 3 - um - vm - (data[f - su - sv] !== 0 ? 1 : 0);
                const a1 = up & vm ? 0 : 3 - up - vm - (data[f + su - sv] !== 0 ? 1 : 0);
                const a2 = up & vp ? 0 : 3 - up - vp - (data[f + su + sv] !== 0 ? 1 : 0);
                const a3 = um & vp ? 0 : 3 - um - vp - (data[f - su + sv] !== 0 ? 1 : 0);
                val = m | a0 << 8 | a1 << 10 | a2 << 12 | a3 << 14;
              } else val = m | 0xff00;
              any = true;
            }
            mask[b + c * nu] = val;
          }
        }
        if (!any) continue;

        const plane = (org[d] + a + (side > 0 ? 1 : 0)) * vs + wo[d];
        for (let c = 0; c < nv; c++) {
          for (let b = 0; b < nu;) {
            const val = mask[b + c * nu];
            if (val === 0) { b++; continue; }
            let w = 1;
            while (b + w < nu && mask[b + w + c * nu] === val) w++;
            let h = 1;
            rows: while (c + h < nv) {
              const row = (c + h) * nu + b;
              for (let x = 0; x < w; x++) if (mask[row + x] !== val) break rows;
              h++;
            }
            for (let y = 0; y < h; y++) { const row = (c + y) * nu + b; for (let x = 0; x < w; x++) mask[row + x] = 0; }

            // emit the quad
            if ((nq + 1) * 12 > P.length) grow();
            const u0 = (org[u] + b) * vs + wo[u], u1 = (org[u] + b + w) * vs + wo[u];
            const v0 = (org[v] + c) * vs + wo[v], v1 = (org[v] + c + h) * vs + wo[v];
            const m = val & 255, pc = m * 4;
            const r = PAL[pc], gg = PAL[pc + 1], bl = PAL[pc + 2], gl = PAL[pc + 3];
            const a0 = val >> 8 & 3, a1 = val >> 10 & 3, a2 = val >> 12 & 3, a3 = val >> 14 & 3;
            let o = nq * 12, oc = nq * 16;
            for (let n = 0; n < 4; n++) {
              q[d] = plane; q[u] = (n === 1 || n === 2) ? u1 : u0; q[v] = n >= 2 ? v1 : v0;
              P[o] = q[0]; P[o + 1] = q[1]; P[o + 2] = q[2];
              N[o] = 0; N[o + 1] = 0; N[o + 2] = 0; N[o + d] = side * 127;
              const f = AOF[n === 0 ? a0 : n === 1 ? a1 : n === 2 ? a2 : a3];
              C[oc] = r * f; C[oc + 1] = gg * f; C[oc + 2] = bl * f; C[oc + 3] = gl;
              o += 3; oc += 4;
            }
            // Split along the diagonal that keeps the AO gradient symmetric,
            // and wind for the side we face.
            const vb = nq * 4, oi = nq * 6, flip = a0 + a2 > a1 + a3;
            if (side > 0) {
              if (flip) { I[oi] = vb; I[oi + 1] = vb + 1; I[oi + 2] = vb + 3; I[oi + 3] = vb + 1; I[oi + 4] = vb + 2; I[oi + 5] = vb + 3; }
              else      { I[oi] = vb; I[oi + 1] = vb + 1; I[oi + 2] = vb + 2; I[oi + 3] = vb;     I[oi + 4] = vb + 2; I[oi + 5] = vb + 3; }
            } else {
              if (flip) { I[oi] = vb; I[oi + 1] = vb + 3; I[oi + 2] = vb + 1; I[oi + 3] = vb + 1; I[oi + 4] = vb + 3; I[oi + 5] = vb + 2; }
              else      { I[oi] = vb; I[oi + 1] = vb + 2; I[oi + 2] = vb + 1; I[oi + 3] = vb;     I[oi + 4] = vb + 3; I[oi + 5] = vb + 2; }
            }
            nq++;
            b += w;
          }
        }
      }
    }
  }

  if (nq === 0) return null;
  return { pos: P.slice(0, nq * 12), nor: N.slice(0, nq * 12), col: C.slice(0, nq * 16), idx: I.slice(0, nq * 6) };
}
