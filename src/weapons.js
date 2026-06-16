/* ============================ weapon configs & viewmodels ============================ */
// Shared weapon stats and geometry builders (FP + TP) for every weapon in the game.
// Imported by combat.js (first-person) and villagers.js (third-person).
import * as THREE from 'three';
import { mesh } from './core.js';
import { matPlank, matIron, matGoldTrim, matDarkWood } from './materials.js';

// `spread` is the shot-scatter cone (half-angle in radians) read by combat.js:
//   base — idle floor (even a settled shot isn't a guaranteed headshot at range)
//   walk/run/air — added to the floor while moving, sprinting, or airborne
//   shot — bloom added per shot; eases back toward the floor at `recover`
//   max  — hard cap on the cone     recover — ease rate toward the floor
// The crosshair draws this same cone, so its tick gap is an honest hit-area gauge.
// The AK starts tighter but blooms harder, so a sustained spray walks wide open.
export const WEAPONS = [
  { id:'handgonne', name:'Handgonne', fireCd:.9, mag:5,  spareMax:Infinity, reloadTime:2.2,
    full:false, range:70, kick:1,  reloadLabel:'ramming powder…',
    spread:{ base:.007, walk:.028, run:.045, air:.08, shot:.024, max:.12, recover:5 } },
  { id:'ak47',      name:'AK-47',     fireCd:.1, mag:30, spareMax:160,      reloadTime:2.6,
    full:true,  range:70, kick:.6, reloadLabel:'reloading…',
    spread:{ base:.005, walk:.03,  run:.05,  air:.09, shot:.03,  max:.16, recover:4 } },
];

/* ── first-person: handgonne (original combat.js geometry) ── */
export function buildHandgonneFP() {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const stock = mesh(new THREE.BoxGeometry(.06,.07,.44), matPlank, 0,-.012,-.1, {cast:false});
  stock.rotation.x = .07;
  g.add(stock);
  g.add(mesh(new THREE.CylinderGeometry(.026,.033,.62,8), matIron, 0,.03,-.42, {rx:Math.PI/2, cast:false}));
  g.add(mesh(new THREE.CylinderGeometry(.042,.042,.05,8), matIron, 0,.03,-.18, {rx:Math.PI/2, cast:false}));
  g.add(mesh(new THREE.CylinderGeometry(.04,.04,.04,8), matGoldTrim, 0,.03,-.68, {rx:Math.PI/2, cast:false}));
  muzzle.position.set(0,.03,-.74);
  g.add(muzzle);
  const base = {x:.34, y:-.3, z:-.5};
  g.position.set(base.x, base.y, base.z);
  return {group:g, muzzle, base};
}

/* ── first-person: AK-47 ── */
export function buildAK47FP() {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  // stock
  const stock = mesh(new THREE.BoxGeometry(.055,.06,.22), matDarkWood, 0,.015,-.06, {cast:false});
  stock.rotation.x = -.04;
  g.add(stock);
  // receiver
  g.add(mesh(new THREE.BoxGeometry(.06,.055,.38), matIron, 0,.025,-.28, {cast:false}));
  // handguard
  g.add(mesh(new THREE.BoxGeometry(.055,.042,.2), matDarkWood, 0,.008,-.5, {cast:false}));
  // barrel
  g.add(mesh(new THREE.CylinderGeometry(.013,.013,.54,8), matIron, 0,.025,-.56, {rx:Math.PI/2, cast:false}));
  // gas tube (above barrel)
  g.add(mesh(new THREE.CylinderGeometry(.008,.008,.2,6), matIron, 0,.052,-.48, {rx:Math.PI/2, cast:false}));
  // pistol grip
  const grip = mesh(new THREE.BoxGeometry(.04,.13,.05), matDarkWood, 0,-.042,-.2, {cast:false});
  grip.rotation.x = .25;
  g.add(grip);
  // banana magazine
  const mag = mesh(new THREE.CylinderGeometry(.028,.022,.22,8), matIron, 0,-.08,-.28, {cast:false});
  mag.rotation.x = -.18;
  g.add(mag);
  // front sight
  g.add(mesh(new THREE.BoxGeometry(.008,.03,.008), matIron, 0,.052,-.78, {cast:false}));
  muzzle.position.set(0,.025,-.86);
  g.add(muzzle);
  const base = {x:.3, y:-.28, z:-.44};
  g.position.set(base.x, base.y, base.z);
  return {group:g, muzzle, base};
}

/* ── third-person: handgonne (original villagers.js geometry) ── */
export function buildHandgonneTP() {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  g.position.set(0,-.52,.1);
  g.add(mesh(new THREE.BoxGeometry(.05,.06,.3), matPlank, 0,0,.08, {cast:false}));
  g.add(mesh(new THREE.CylinderGeometry(.022,.027,.42,7), matIron, 0,.02,.28, {rx:Math.PI/2, cast:false}));
  muzzle.position.set(0,.02,.5);
  g.add(muzzle);
  return {group:g, muzzle};
}

/* ── third-person: AK-47 ── */
export function buildAK47TP() {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  g.position.set(0,-.52,.1);
  // receiver
  g.add(mesh(new THREE.BoxGeometry(.04,.04,.26), matIron, 0,.01,.17, {cast:false}));
  // barrel (longer than gonne)
  g.add(mesh(new THREE.CylinderGeometry(.01,.01,.38,6), matIron, 0,.01,.38, {rx:Math.PI/2, cast:false}));
  // handguard
  g.add(mesh(new THREE.BoxGeometry(.038,.03,.14), matDarkWood, 0,.005,.32, {cast:false}));
  // stock
  g.add(mesh(new THREE.BoxGeometry(.036,.04,.14), matDarkWood, 0,.01,.01, {cast:false}));
  // pistol grip
  const grip = mesh(new THREE.BoxGeometry(.03,.09,.035), matDarkWood, 0,-.03,.12, {cast:false});
  grip.rotation.x = .25;
  g.add(grip);
  // banana magazine
  const mag = mesh(new THREE.CylinderGeometry(.02,.016,.16,7), matIron, 0,-.055,.18, {cast:false});
  mag.rotation.x = -.18;
  g.add(mag);
  muzzle.position.set(0,.01,.58);
  g.add(muzzle);
  return {group:g, muzzle};
}
