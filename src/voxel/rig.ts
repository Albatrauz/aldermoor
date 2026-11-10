/* ============================ voxel rigs ============================ */
// The fighters and their guns are built from a handful of primitives — boxes
// for limbs, cylinders for torsos and barrels, a sphere for the head, cones for
// the hood. Boxes already belong in a voxel world. The round ones do not: a
// smooth 10-sided cylinder standing in front of a wall of cubes looks like it
// wandered in from another game.
//
// So each round primitive is rasterised into small voxels in its OWN local
// space and re-meshed. Nothing else about the rig changes — same hierarchy, same
// pivots, same materials — so every animation that swings an arm or kicks a gun
// back keeps working untouched; the arm is simply made of blocks now.
import * as THREE from 'three';
import { uvBox } from '../core';
import { VoxelGrid } from './grid';
import { meshRegion } from './mesher';
import { tester, shapeOf } from './voxelize';

const ROUND = new Set(['CylinderGeometry', 'ConeGeometry', 'SphereGeometry']);

// Every player wears the same shapes, so a blocky torso is built once and shared.
const cache = new Map<string, THREE.BufferGeometry>();

function blocky(geo: THREE.BufferGeometry, size: number, withUV: boolean) {
  const s = shapeOf(geo);
  const key = JSON.stringify(s) + '|' + size + '|' + withUV;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  const n = (lo: number, hi: number) => Math.max(1, Math.ceil((hi - lo) / size - 1e-6));
  const nx = n(bb.min.x, bb.max.x), ny = n(bb.min.y, bb.max.y), nz = n(bb.min.z, bb.max.z);
  // centre the lattice on the shape so it stays symmetric
  const g = new VoxelGrid(nx, ny, nz, size,
    (bb.min.x + bb.max.x - nx * size) / 2, (bb.min.y + bb.max.y - ny * size) / 2, (bb.min.z + bb.max.z - nz * size) / 2);
  const inside = tester(geo, size);
  if (!inside) return geo;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++)
    if (inside(g.ox + (i + .5) * size, g.oy + (j + .5) * size, g.oz + (k + .5) * size)) g.data[g.idx(i, j, k)] = 1;
  const d = meshRegion(g, 0, 0, 0, nx, ny, nz, false);
  if (!d) return geo;

  let out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3, true));
  out.setIndex(new THREE.BufferAttribute(d.idx, 1));
  if (withUV) out = uvBox(out, .45);
  cache.set(key, out);
  return out;
}

/* Replace every round primitive under `root` with a voxel version of itself,
   `size` metres to the voxel. Safe to call on a rig that has already been done
   (converted meshes no longer report a round shape). */
export function voxelizeRig<T extends THREE.Object3D>(root: T, size: number): T {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !ROUND.has(shapeOf(m.geometry).type)) return;
    const next = blocky(m.geometry, size, !!(m.material as THREE.MeshStandardMaterial).map);
    if (next !== m.geometry) { m.geometry.dispose(); m.geometry = next; }
  });
  return root;
}
