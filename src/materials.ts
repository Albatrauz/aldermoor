/* ============================ materials ============================ */
// Shared StandardMaterials built from the procedural textures. Defined once and
// reused across every building, prop and villager.
import * as THREE from 'three';
import {
  clonedTex, cobbleTex, grassTex, dirtTex, stoneTex, stoneTex2, plankTex,
  wallStyles, roofTexes, stripeTex,
  sandTex, sandPathTex, sandstoneTex, sandstoneTex2, concreteTex, crateTex,
  snowTex, snowPathTex, asphaltTex, brickTex,
  facadeConcreteTex, facadeBrickTex, facadeWornTex,
} from './textures';

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

/* --- desert (Dust2) palette --- */
export const matSand          = new THREE.MeshStandardMaterial({map:clonedTex(sandTex,40,34), roughness:1});
export const matSandPath      = new THREE.MeshStandardMaterial({map:clonedTex(sandPathTex,3,18), roughness:1});
export const matSandstone     = new THREE.MeshStandardMaterial({map:sandstoneTex,  roughness:.95});
export const matSandstoneDark = new THREE.MeshStandardMaterial({map:sandstoneTex2, roughness:.95});
export const matConcrete      = new THREE.MeshStandardMaterial({map:concreteTex, roughness:.9});
export const matCrate         = new THREE.MeshStandardMaterial({map:crateTex, roughness:.85});
export const matContainerBlue = new THREE.MeshStandardMaterial({color:0x2f6fb0, roughness:.55, metalness:.35});
export const matCarRed        = new THREE.MeshStandardMaterial({color:0xb5402e, roughness:.5,  metalness:.25});
export const matSandbag       = new THREE.MeshStandardMaterial({color:0xb8a878, roughness:1});
export const matMetalDoor     = new THREE.MeshStandardMaterial({color:0x5a6b3a, roughness:.55, metalness:.5});

/* --- urban (Skidrow) palette --- */
export const matSnow      = new THREE.MeshStandardMaterial({map:clonedTex(snowTex,30,26), roughness:.95});
export const matSnowPath  = new THREE.MeshStandardMaterial({map:clonedTex(snowPathTex,4,16), roughness:1});
export const matAsphalt   = new THREE.MeshStandardMaterial({map:clonedTex(asphaltTex,8,30), roughness:.95});
export const matBrick     = new THREE.MeshStandardMaterial({map:brickTex, roughness:.95});
// Facades read their window grid from a tiling texture; the apartment-building
// helper clones these per block so each tower repeats the grid at its own scale.
export const matFacadeConcrete = new THREE.MeshStandardMaterial({map:facadeConcreteTex, roughness:.92});
export const matFacadeBrick    = new THREE.MeshStandardMaterial({map:facadeBrickTex,    roughness:.95});
export const matFacadeWorn     = new THREE.MeshStandardMaterial({map:facadeWornTex,     roughness:.92});
export const matRoofTar   = new THREE.MeshStandardMaterial({color:0x2b2d31, roughness:.9});
export const matSnowCap   = new THREE.MeshStandardMaterial({color:0xe6ecf2, roughness:.9});  // snow on ledges/roofs
export const matRust      = new THREE.MeshStandardMaterial({color:0x7a4a32, roughness:.85, metalness:.3});
export const matDumpster  = new THREE.MeshStandardMaterial({color:0x2f5a3e, roughness:.6, metalness:.35});
export const matCarBlue   = new THREE.MeshStandardMaterial({color:0x2c4763, roughness:.5, metalness:.3});
export const matCarGrey   = new THREE.MeshStandardMaterial({color:0x6a6f76, roughness:.5, metalness:.3});
