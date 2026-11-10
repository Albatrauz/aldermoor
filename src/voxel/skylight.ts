/* ============================ sky light ============================ */
// How much open sky each voxel of air can "see". Out in the street that is all
// of it; a few metres down a tunnel it is next to none. The surface shader
// scales the AMBIENT light (the hemisphere light and the sky-baked environment)
// by this, so rooms and tunnels are dim, doorways glow, and — because it is
// recomputed as the map is shot apart — a hole knocked in a wall lets daylight
// spill into the room behind it. The sun itself is not touched here: that is
// the shadow map's job, and it already re-bakes when geometry changes.
//
// The model is the classic voxel-game one:
//
//   1. every air voxel with nothing but air above it is fully lit (255);
//   2. light then floods sideways and down into covered air, losing FALLOFF per
//      voxel travelled, so it fades to nothing ~10 m from the nearest opening.
//
// Nothing solid is ever ADDED to the map, only removed, so light can only ever
// increase. That makes the update after a carve the easy half of the classic
// algorithm — a flood outward from the new hole, no "un-lighting" pass.
//
// SOLID voxels carry a value too: the light of the air they face ("skin").
// The shader samples half a voxel out from a surface, in the layer of air
// resting on it — but trilinear filtering still blends in the solid voxels at
// the edge of that layer, and if those were black every inside corner in the
// world would get a hard dark seam. A voxel with air on two opposite sides (a
// thin wall) takes the DIMMER side, so daylight never bleeds through to the
// room behind.
//
// The values live in one byte per voxel, laid out exactly like the grid's own
// storage, and that very array is the pixel data of a 3D texture. The shader
// samples it with trilinear filtering, which gives smooth gradients for free
// and means the chunk meshes never need rebuilding when the light changes.
import * as THREE from 'three';
import { renderer } from '../core';
import type { VoxelGrid } from './grid';

const FALLOFF = 6;            // light lost per voxel: 255 → 0 over 42 voxels (10.5 m at 25 cm)
const MAX_BOXES = 48;         // more dirty regions than this in one frame → re-upload everything

/* ============================ shared shader state ============================ */
// One set of uniforms for every material that reads the sky light, so a map
// switch is a few assignments and not a walk over materials.
const white = new THREE.Data3DTexture(new Uint8Array([255]), 1, 1, 1);
white.format = THREE.RedFormat; white.unpackAlignment = 1; white.needsUpdate = true;

export const skyUniforms = {
  uSkyTex: { value: white as THREE.Data3DTexture },
  uSkyOrigin: { value: new THREE.Vector3() },       // world position of the texture's min corner
  uSkyInv: { value: new THREE.Vector3() },          // 1 / its world extent, per world axis (0 = off)
  uSkyMin: { value: .3 },                           // ambient left where no sky reaches at all
};

/* GLSL: uniforms + lookup. `p` is a position in the grid's (world) frame. The
   texture's axes are (y, x, z) — the grid stores columns contiguously, and the
   texture simply adopts that layout so the two can share one array. */
export const SKY_PARS = /* glsl */`
uniform highp sampler3D uSkyTex;
uniform vec3 uSkyOrigin;
uniform vec3 uSkyInv;
uniform float uSkyMin;
float voxSky( vec3 p ) {
	vec3 t = ( p - uSkyOrigin ) * uSkyInv;
	if ( any( lessThan( t, vec3( 0.0 ) ) ) || any( greaterThan( t, vec3( 1.0 ) ) ) ) return 1.0;
	float l = texture( uSkyTex, t.yxz ).r;
	return mix( uSkyMin, 1.0, l * l );
}
`;

/* GLSL: dim the ambient terms. Goes right after <aomap_fragment>, the point
   where three itself applies ambient occlusion — direct light is left alone. */
export const skyApply = (factor: string) => /* glsl */`
#include <aomap_fragment>
{
	float skyL = ${factor};
	reflectedLight.indirectDiffuse *= skyL;
	reflectedLight.indirectSpecular *= skyL;
}
`;

export function bindSkyUniforms(shader: { uniforms: Record<string, any> }) {
  Object.assign(shader.uniforms, skyUniforms);
}

/* Give an ordinary material (debris, a player's coat) the same treatment, with
   the light looked up once per vertex at its world position — plenty for small
   things, and it keeps them from glowing in a dark room. */
export function addSkyLight<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    bindSkyUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKY_PARS}\nvarying float vSkyL;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 skyP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            skyP = instanceMatrix * skyP;
          #endif
          vSkyL = voxSky( ( modelMatrix * skyP ).xyz );
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSkyL;')
      .replace('#include <aomap_fragment>', skyApply('vSkyL'));
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '+sky';
  mat.needsUpdate = true;
  return mat;
}

/* ============================ the light volume ============================ */
let max3D = 0;

export class SkyLight {
  readonly light: Uint8Array;
  readonly ok: boolean;                       // false: the GPU can't hold a texture this size → feature off
  private tex: THREE.Data3DTexture | null = null;
  private src: THREE.Data3DTexture | null = null;   // CPU-only twin over the same bytes, for partial uploads
  private skyJ: Int16Array;                   // per column: lowest (padded) j lit straight from above
  private q = new Int32Array(1 << 16);
  private qn = 0;
  private boxes: number[] = [];               // dirty regions, 6 numbers each (texture coords, max exclusive)
  private full = false;
  // bounds of everything the current update has changed
  private b0 = 0; private b1 = 0; private b2 = 0; private b3 = 0; private b4 = 0; private b5 = 0;
  private changed = false;

  constructor(readonly grid: VoxelGrid) {
    const { SX, SY, SZ } = grid;
    if (!max3D) { const gl = renderer.getContext() as WebGL2RenderingContext; max3D = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) || 256; }
    this.ok = Math.max(SX, SY, SZ) <= max3D;
    this.light = new Uint8Array(this.ok ? SX * SY * SZ : 0);
    this.skyJ = new Int16Array(this.ok ? SX * SZ : 0);
    if (!this.ok) { console.warn('sky light off: 3D texture limit is', max3D); return; }
    const make = () => {
      const t = new THREE.Data3DTexture(this.light, SY, SX, SZ);
      t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.unpackAlignment = 1;
      return t;
    };
    this.tex = make(); this.src = make();
    this.build();
  }

  /* Point the shared uniforms at this volume (or switch the effect off). */
  bind() {
    const g = this.grid, u = skyUniforms;
    if (!this.ok || !this.tex) { u.uSkyTex.value = white; u.uSkyInv.value.set(0, 0, 0); return; }
    u.uSkyTex.value = this.tex;
    u.uSkyOrigin.value.set(g.ox - g.vs, g.oy - g.vs, g.oz - g.vs);
    u.uSkyInv.value.set(1 / (g.SX * g.vs), 1 / (g.SY * g.vs), 1 / (g.SZ * g.vs));
  }

  private push(id: number) {
    if (this.qn === this.q.length) { const n = new Int32Array(this.q.length * 2); n.set(this.q); this.q = n; }
    this.q[this.qn++] = id;
  }

  private touch(id: number) {
    const SY = this.grid.SY, SX = this.grid.SX;
    const j = id % SY, t = (id - j) / SY, i = t % SX, k = (t - i) / SX;
    if (!this.changed) { this.changed = true; this.b0 = this.b3 = j; this.b1 = this.b4 = i; this.b2 = this.b5 = k; return; }
    if (j < this.b0) this.b0 = j; else if (j > this.b3) this.b3 = j;
    if (i < this.b1) this.b1 = i; else if (i > this.b4) this.b4 = i;
    if (k < this.b2) this.b2 = k; else if (k > this.b5) this.b5 = k;
  }

  /* Flood from everything queued. Each step gives a neighbour the light of the
     voxel it came from, less FALLOFF, if that is more than it already has. */
  private spread(track: boolean) {
    const g = this.grid, data = g.data, L = this.light, si = g.si, sk = g.sk;
    for (let h = 0; h < this.qn; h++) {
      const id = this.q[h], l = L[id] - FALLOFF;
      if (l <= 0) continue;
      for (let nb = 0; nb < 6; nb++) {
        const n = nb === 0 ? id - 1 : nb === 1 ? id + si : nb === 2 ? id - si : nb === 3 ? id + sk : nb === 4 ? id - sk : id + 1;
        if (data[n] === 0 && L[n] < l) { L[n] = l; this.push(n); if (track) this.touch(n); }
      }
    }
    this.qn = 0;
  }

  /* The whole map, from nothing. ~100 ms for a 26-million-voxel grid: the sky
     columns are plain memory fills, and the flood only has to visit the air
     that is under cover. */
  private build() {
    const g = this.grid, { SX, SY, SZ, data } = g, L = this.light, sky = this.skyJ;
    for (let k = 0; k < SZ; k++) for (let i = 0; i < SX; i++) {
      const c = i + SX * k, col = SY * c;
      // The padding shell is lit solid. Nothing samples it for real — but it is
      // air above ground, and a flood that wandered into it would walk straight
      // off the end of the array. Fully lit, it can never be entered.
      if (i === 0 || k === 0 || i === SX - 1 || k === SZ - 1) { L.fill(255, col, col + SY); sky[c] = 1; continue; }
      let j = SY - 2;
      while (j >= 1 && data[col + j] === 0) j--;
      L.fill(255, col + j + 1, col + SY);       // open air, and the padding voxel above it
      sky[c] = j + 1;
    }
    // Seeds: a lit voxel beside a column whose own sky stops higher up is where
    // light gets in under that column's cover.
    for (let k = 1; k < SZ - 1; k++) for (let i = 1; i < SX - 1; i++) {
      const c = i + SX * k, s = sky[c], col = SY * c;
      for (let nb = 0; nb < 4; nb++) {
        const nc = nb === 0 ? c + 1 : nb === 1 ? c - 1 : nb === 2 ? c + SX : c - SX;
        const top = Math.min(sky[nc], SY - 1), ncol = SY * nc;
        for (let j = s; j < top; j++) if (data[ncol + j] === 0) this.push(col + j);
      }
    }
    this.spread(false);
    this.skin(1, 1, 1, SY - 1, SX - 1, SZ - 1);
    (this.tex as THREE.Data3DTexture).needsUpdate = true;
  }

  /* Give every solid voxel in the box (texture coords, max exclusive) the light
     of the air it faces — see the note on "skin" at the top of the file. */
  private skin(j0: number, i0: number, k0: number, j1: number, i1: number, k1: number) {
    const g = this.grid, { SX, SY, data, si, sk } = g, L = this.light;
    for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) {
      const col = SY * (i + SX * k);
      for (let j = j0; j < j1; j++) {
        const id = col + j;
        if (data[id] === 0) continue;
        let v = 0;
        for (let ax = 0; ax < 3; ax++) {
          const st = ax === 0 ? 1 : ax === 1 ? si : sk;
          const a = data[id + st] === 0 ? L[id + st] : -1, b = data[id - st] === 0 ? L[id - st] : -1;
          const m = a < 0 ? b : b < 0 ? a : a < b ? a : b;
          if (m > v) v = m;
        }
        L[id] = v;
      }
    }
  }

  /* These voxels (storage indices) have just become air — everything one carve
     and the collapses it caused removed, all of it already gone from the grid. */
  opened(ids: number[]) {
    if (!this.ok || !ids.length) return;
    const g = this.grid, { SX, SY, SZ, data, si, sk } = g, L = this.light;
    // What they held was skin, not light: forget it before anyone reads it.
    for (const id of ids) { L[id] = 0; this.touch(id); }
    for (const id of ids) {
      const j = id % SY, c = (id - j) / SY;
      if (j === this.skyJ[c] - 1) {
        // The roof over this column just went: daylight drops straight down it.
        const col = c * SY;
        let jj = j;
        while (jj >= 1 && data[col + jj] === 0) { L[col + jj] = 255; this.push(col + jj); this.touch(col + jj); jj--; }
        this.skyJ[c] = jj + 1;
        continue;
      }
      if (L[id] === 255) continue;              // already swept up by a column above
      // Otherwise it takes the best its neighbours can give it.
      let best = 0;
      for (let nb = 0; nb < 6; nb++) {
        const n = nb === 0 ? id - 1 : nb === 1 ? id + si : nb === 2 ? id - si : nb === 3 ? id + sk : nb === 4 ? id - sk : id + 1;
        if (data[n] === 0 && L[n] > best) best = L[n];
      }
      best -= FALLOFF;
      if (best > L[id]) { L[id] = best; this.push(id); }
    }
    this.spread(true);
    this.changed = false;
    // The solids around everything that changed need their skin redone, so the
    // dirty region is one voxel bigger than the change itself.
    const j0 = Math.max(1, this.b0 - 1), i0 = Math.max(1, this.b1 - 1), k0 = Math.max(1, this.b2 - 1);
    const j1 = Math.min(SY - 1, this.b3 + 2), i1 = Math.min(SX - 1, this.b4 + 2), k1 = Math.min(SZ - 1, this.b5 + 2);
    this.skin(j0, i0, k0, j1, i1, k1);
    if (this.boxes.length >= MAX_BOXES * 6) { this.full = true; this.boxes.length = 0; }
    if (!this.full) this.boxes.push(j0, i0, k0, j1, i1, k1);
  }

  /* Send what changed to the GPU. Once a frame; a no-op when nothing did. */
  flush() {
    const tex = this.tex;
    if (!tex || !this.src) return;
    if (this.full) { tex.needsUpdate = true; this.full = false; this.boxes.length = 0; return; }
    const b = this.boxes;
    if (!b.length) return;
    for (let n = 0; n < b.length; n += 6) {
      _box.min.set(b[n], b[n + 1], b[n + 2]); _box.max.set(b[n + 3], b[n + 4], b[n + 5]);
      renderer.copyTextureToTexture(this.src, tex, _box, _box.min);
    }
    b.length = 0;
  }

  dispose() {
    if (skyUniforms.uSkyTex.value === this.tex) { skyUniforms.uSkyTex.value = white; skyUniforms.uSkyInv.value.set(0, 0, 0); }
    this.tex?.dispose(); this.src?.dispose();
  }
}
const _box = new THREE.Box3();
