/* ============================ materials ============================ */
// Shared StandardMaterials built from the procedural textures. Defined once and
// reused across every building, prop and villager.
import * as THREE from 'three';
import {
  clonedTex, normalFor, plankTex,
  sandTex, sandPathTex, sandstoneTex, sandstoneTex2, concreteTex, crateTex,
  snowTex, snowPathTex, asphaltTex, brickTex,
  facadeConcreteTex, facadeBrickTex, facadeWornTex,
} from './textures';

/* A world surface: albedo plus the relief derived from it.
   The repeat has to be applied to BOTH — three gives every texture slot its own
   UV transform, so a normal map left at 1x1 under a floor tiled 40x34 would
   stretch a single bump across the entire map. `relief` is the normalScale:
   masonry wants a firm edge, sand and snow only want a suggestion. */
function surface(
  tex: THREE.Texture,
  opts: { repeat?: [number, number]; roughness?: number; metalness?: number; relief?: number } = {},
) {
  const [rx, ry] = opts.repeat ?? [1, 1];
  const relief = opts.relief ?? 1;
  return new THREE.MeshStandardMaterial({
    map: (rx === 1 && ry === 1) ? tex : clonedTex(tex, rx, ry),
    normalMap: normalFor(tex, rx, ry),
    normalScale: new THREE.Vector2(relief, relief),
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
  });
}

/* ============================ impact surfaces ============================ */
// What a bullet should throw up when it hits a thing. Colliders carry the
// material they were built from, so the shot code can look the surface up here
// rather than every map having to declare it a second time.
export type Surface = 'stone' | 'sand' | 'snow' | 'metal' | 'wood' | 'concrete';

const surfaces = new WeakMap<THREE.Material, Surface>();
function tag<T extends THREE.Material>(m: T, s: Surface): T { surfaces.set(m, s); return m; }
export function surfaceOf(m?: THREE.Material | null): Surface {
  return (m && surfaces.get(m)) || 'stone';
}

// Dust colour per surface, plus how big a puff it kicks up. Metal throws almost
// no dust but bright sparks; snow throws a lot of very pale powder.
export const IMPACT: Record<Surface, { dust: number; puff: number; specks: number }> = {
  stone:    { dust: 0xc9b48c, puff: 1.0, specks: 6 },
  sand:     { dust: 0xd8bd8b, puff: 1.5, specks: 7 },
  snow:     { dust: 0xeef3f8, puff: 1.7, specks: 8 },
  metal:    { dust: 0xffd08a, puff: 0.35, specks: 9 },
  wood:     { dust: 0xb08b56, puff: 0.8, specks: 7 },
  concrete: { dust: 0xb9b4aa, puff: 1.2, specks: 6 },
};

/* --- shared props & kit (both maps) ---
   What survives of the original market town: the handful of materials the
   weapons and the villager rig still dress themselves in. The rest of the
   medieval set went with the town itself. */
export const matPlank    = tag(new THREE.MeshStandardMaterial({map:plankTex, roughness:.9}), 'wood');
export const matDarkWood = tag(new THREE.MeshStandardMaterial({color:0x3a2a1c, roughness:.9}), 'wood');
export const matIron     = tag(new THREE.MeshStandardMaterial({color:0x2c2824, roughness:.55, metalness:.7}), 'metal');
export const matGoldTrim = tag(new THREE.MeshStandardMaterial({color:0xcaa64e, roughness:.35, metalness:.8}), 'metal');
/* --- desert (Dust2) palette --- */
export const matSand          = tag(surface(sandTex,       {repeat:[40,34], roughness:1,   relief:.35}), 'sand');
export const matSandPath      = tag(surface(sandPathTex,   {repeat:[3,18],  roughness:1,   relief:.25}), 'sand');
export const matSandstone     = tag(surface(sandstoneTex,  {roughness:.95, relief:1.1}), 'stone');   // masonry courses
export const matSandstoneDark = tag(surface(sandstoneTex2, {roughness:.95, relief:1.1}), 'stone');
export const matConcrete      = tag(surface(concreteTex,   {roughness:.9,  relief:.55}), 'concrete');
export const matCrate         = tag(surface(crateTex,      {roughness:.85, relief:.9}), 'wood');   // plank edges
export const matContainerBlue = tag(new THREE.MeshStandardMaterial({color:0x2f6fb0, roughness:.55, metalness:.35}), 'metal');
export const matCarRed        = tag(new THREE.MeshStandardMaterial({color:0xb5402e, roughness:.5,  metalness:.25}), 'metal');
export const matSandbag       = tag(new THREE.MeshStandardMaterial({color:0xb8a878, roughness:1}), 'sand');
export const matMetalDoor     = tag(new THREE.MeshStandardMaterial({color:0x5a6b3a, roughness:.55, metalness:.5}), 'metal');
/* --- urban (Skidrow) palette --- */
export const matSnow      = tag(surface(snowTex,     {repeat:[30,26], roughness:.95, relief:.3}), 'snow');
export const matSnowPath  = tag(surface(snowPathTex, {repeat:[4,16],  roughness:1,   relief:.3}), 'snow');
export const matAsphalt   = tag(surface(asphaltTex,  {repeat:[8,30],  roughness:.95, relief:.45}), 'concrete');
export const matBrick     = tag(surface(brickTex,    {roughness:.95, relief:1.2}), 'stone');   // brick courses read hard
// Facades read their window grid from a tiling texture; the apartment-building
// helper clones these per block so each tower repeats the grid at its own scale.
// Low relief on purpose: the window grid is painted, so a strong normal map
// embosses the glass itself rather than just the reveal around it.
export const matFacadeConcrete = tag(surface(facadeConcreteTex, {roughness:.92, relief:.6}), 'concrete');
export const matFacadeBrick    = tag(surface(facadeBrickTex,    {roughness:.95, relief:.6}), 'stone');
export const matFacadeWorn     = tag(surface(facadeWornTex,     {roughness:.92, relief:.6}), 'concrete');
export const matRoofTar   = tag(new THREE.MeshStandardMaterial({color:0x2b2d31, roughness:.9}), 'concrete');
export const matSnowCap   = tag(new THREE.MeshStandardMaterial({color:0xe6ecf2, roughness:.9}), 'snow');   // snow on ledges/roofs
export const matRust      = tag(new THREE.MeshStandardMaterial({color:0x7a4a32, roughness:.85, metalness:.3}), 'metal');
export const matDumpster  = tag(new THREE.MeshStandardMaterial({color:0x2f5a3e, roughness:.6, metalness:.35}), 'metal');
export const matCarBlue   = tag(new THREE.MeshStandardMaterial({color:0x2c4763, roughness:.5, metalness:.3}), 'metal');
export const matCarGrey   = tag(new THREE.MeshStandardMaterial({color:0x6a6f76, roughness:.5, metalness:.3}), 'metal');