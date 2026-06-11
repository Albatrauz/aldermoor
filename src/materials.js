/* ============================ materials ============================ */
// Shared StandardMaterials built from the procedural textures. Defined once and
// reused across every building, prop and villager.
import * as THREE from 'three';
import {
  clonedTex, cobbleTex, grassTex, dirtTex, stoneTex, stoneTex2, plankTex,
  wallStyles, roofTexes, stripeTex,
} from './textures.js';

export const matCobble = new THREE.MeshStandardMaterial({map:clonedTex(cobbleTex,22,22), roughness:1});
export const matGrass  = new THREE.MeshStandardMaterial({map:clonedTex(grassTex,56,56), roughness:1});
export const matDirt   = new THREE.MeshStandardMaterial({map:clonedTex(dirtTex,1.4,9), roughness:1});
export const matStone  = new THREE.MeshStandardMaterial({map:stoneTex,  roughness:.95});
export const matStone2 = new THREE.MeshStandardMaterial({map:stoneTex2, roughness:.95});
export const matPlank  = new THREE.MeshStandardMaterial({map:plankTex, roughness:.9});
export const matDarkWood = new THREE.MeshStandardMaterial({color:0x3a2a1c, roughness:.9});
export const matIron   = new THREE.MeshStandardMaterial({color:0x2c2824, roughness:.55, metalness:.7});
export const matLitWin = new THREE.MeshBasicMaterial({color:0xffbe69});
export const matLitWin2= new THREE.MeshBasicMaterial({color:0xffa84e});
export const matDarkWin= new THREE.MeshStandardMaterial({color:0x161d2e, roughness:.25, metalness:.5});
export const matFoliage= new THREE.MeshStandardMaterial({color:0x36482c, roughness:1});
export const matFoliage2=new THREE.MeshStandardMaterial({color:0x2c3d26, roughness:1});
export const matGoldTrim=new THREE.MeshStandardMaterial({color:0xcaa64e, roughness:.35, metalness:.8});
export const wallMats  = wallStyles.map(t=>new THREE.MeshStandardMaterial({map:t, roughness:.95}));
export const roofMats  = roofTexes.map(t=>new THREE.MeshStandardMaterial({map:t, roughness:.95}));
export const stripeMats= ['#8d3b32','#3f5d43','#3c4668'].map(c=>new THREE.MeshStandardMaterial({map:stripeTex(c), roughness:.9, side:THREE.DoubleSide}));
