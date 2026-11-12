/* ============================ decals — pictures on the voxels ============================ */
// The voxel lattice is 0.25 m. That is plenty for a wall and far too coarse for
// a logo: a wordmark a few metres wide is a dozen voxels across, and lettering
// at that size is mush. So a map can lay a picture over a face instead (see
// `Decal` in mapkit.ts). It is drawn as a plain textured quad a hair in front of
// the voxels, lit and fogged like them, and never voxelized.
//
// It still has to behave like part of the wall when the wall is shot. Each decal
// carries a mask with one cell per voxel of the face behind it. A cell that had
// a voxel behind it when the map was built goes see-through once that voxel is
// gone, so a bullet hole in the sign is a hole in the picture too. Cells that
// were over air from the start (a picture can overhang its backing, like the
// rounded edge of a crest on a blocky plate) stay as drawn — until most of the
// backing has been shot away, and then the whole decal goes with it.
import * as THREE from 'three';
import { renderer } from './core';
import type { Decal } from './mapkit';
import { solidAt } from './voxel';
import { VS } from './voxel/voxelize';
import { injectHeightFog } from './fog';
import { addSkyLight } from './voxel/skylight';

const LIFT = .012;          // how far in front of its face a decal floats
const KEEP = .35;           // below this share of its backing left, a decal comes down whole

const NORMAL: Record<Decal['facing'], [number, number]> = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
const TURN: Record<Decal['facing'], number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

interface Live {
  mesh: THREE.Mesh;
  mask: THREE.DataTexture;
  cells: Float32Array;      // world position of the voxel behind each cell, xyz
  backed: Uint8Array;       // 1 where that voxel was there at build time
}
let live: Live[] = [];

function dispose() {
  for (const L of live) {
    const mat = L.mesh.material as THREE.MeshStandardMaterial;
    mat.map?.dispose(); L.mask.dispose(); mat.dispose(); L.mesh.geometry.dispose();
  }
  live = [];
}

/* Build the decals for a freshly voxelized map; the previous map's are freed.
   Call after the voxel world is up — the masks are read from it. */
export function buildDecals(list: Decal[]): THREE.Group {
  dispose();
  const group = new THREE.Group();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const p = new THREE.Vector3();
  for (const d of list) {
    const w = d.a1 - d.a0, h = d.y1 - d.y0;
    const nw = Math.max(1, Math.round(w / VS)), nh = Math.max(1, Math.round(h / VS));
    const mask = new THREE.DataTexture(new Uint8Array(nw * nh * 4).fill(255), nw, nh);
    mask.magFilter = mask.minFilter = THREE.NearestFilter;
    mask.needsUpdate = true;
    d.tex.colorSpace = THREE.SRGBColorSpace;
    d.tex.anisotropy = aniso;

    const mat = new THREE.MeshStandardMaterial({
      map: d.tex, alphaMap: mask, transparent: true, depthWrite: false, roughness: .75, metalness: 0,
    });
    mat.onBeforeCompile = injectHeightFog;
    mat.customProgramCacheKey = () => 'heightFog';
    addSkyLight(mat);

    const [nx, nz] = NORMAL[d.facing], ca = (d.a0 + d.a1) / 2, cy = (d.y0 + d.y1) / 2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    if (nz) mesh.position.set(ca, cy, d.at + nz * LIFT);
    else mesh.position.set(d.at + nx * LIFT, cy, ca);
    mesh.rotation.y = TURN[d.facing];
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    group.add(mesh);

    // half a voxel behind the face, under the centre of each cell
    const cells = new Float32Array(nw * nh * 3), back = LIFT + VS / 2;
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      p.set(((i + .5) / nw - .5) * w, ((j + .5) / nh - .5) * h, 0).applyMatrix4(mesh.matrixWorld);
      cells.set([p.x - nx * back, p.y, p.z - nz * back], (j * nw + i) * 3);
    }
    live.push({ mesh, mask, cells, backed: new Uint8Array(nw * nh) });
  }
  refresh(true);
  return group;
}

function refresh(first: boolean) {
  for (const L of live) {
    const { cells, backed } = L, px = L.mask.image.data as Uint8Array;
    let had = 0, has = 0, changed = false;
    for (let c = 0, n = backed.length; c < n; c++) {
      const s = solidAt(cells[c * 3], cells[c * 3 + 1], cells[c * 3 + 2]);
      if (first) backed[c] = s ? 1 : 0;
      if (!backed[c]) continue;
      had++; if (s) has++;
      const a = s ? 255 : 0;
      if (px[c * 4 + 1] !== a) { px.fill(a, c * 4, c * 4 + 4); changed = true; }
    }
    if (changed) L.mask.needsUpdate = true;
    L.mesh.visible = had === 0 || has / had >= KEEP;
  }
}

/* The voxels changed (a shot, a collapse): punch the same holes in the pictures. */
export function refreshDecals() { refresh(false); }
