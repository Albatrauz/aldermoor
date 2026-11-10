/* ============================ voxel surface shader ============================ */
// One material draws every voxel in the world. It is a stock MeshStandardMaterial
// — so it still gets the sun, the baked shadow map, the sky-baked environment
// and the height fog like everything else — with three small additions patched
// in through onBeforeCompile:
//
//   - colour comes from a per-vertex palette colour (`aVox`, with the mesher's
//     ambient occlusion already folded in) instead of a texture;
//   - every voxel is tinted by a hash of its own grid coordinate, and its
//     outline is drawn as a faint darker edge. This is done per PIXEL from the
//     world position, so it works across greedy-merged quads: a wall that is a
//     single 30 m rectangle still reads as thousands of individual blocks;
//   - `aVox.a` carries gloss, which lowers roughness and raises metalness for
//     the painted-steel things (containers, cars, barrels, glass).
//
// Both the per-voxel tint and the outlines are faded out with distance using
// screen-space derivatives. Without that, voxels smaller than a pixel turn into
// shimmering noise the moment the camera moves.
import * as THREE from 'three';
import { injectHeightFog } from '../fog';

export function makeVoxelMaterial(voxelSize: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: .93, metalness: 0 });
  const uVS = { value: voxelSize };

  mat.onBeforeCompile = (shader) => {
    injectHeightFog(shader);
    shader.uniforms.uVS = uVS;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aVox;
        varying vec4 vVox;
        varying vec3 vVoxPos;
        varying vec3 vVoxN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vVox = aVox;
        // Cells are addressed in the mesh's own frame, not the world's, so a
        // tumbling chunk of wall keeps its voxels glued to it instead of
        // swimming through them. (Static chunks sit at the origin: same thing.)
        vVoxPos = transformed;
        vVoxN = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uVS;
        varying vec4 vVox;
        varying vec3 vVoxPos;
        varying vec3 vVoxN;
        float voxHash( vec3 p ) {
          p = fract( p * .1031 );
          p += dot( p, p.zyx + 31.32 );
          return fract( ( p.x + p.y ) * p.z );
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 q = vVoxPos / uVS;
          vec3 an = abs( vVoxN );
          // step half a voxel behind the face so the cell id is unambiguous
          vec3 cell = floor( q - vVoxN * .5 );
          float fw = max( fwidth( q.x ), max( fwidth( q.y ), fwidth( q.z ) ) );
          float tint = mix( voxHash( cell ), .5, smoothstep( .35, 1.4, fw ) );
          // distance to the nearest cell border, measured in the face's plane
          vec3 f = fract( q );
          vec3 e = min( f, 1.0 - f );
          float edge = min( mix( e.x, 1.0, an.x ), min( mix( e.y, 1.0, an.y ), mix( e.z, 1.0, an.z ) ) );
          float line = ( 1.0 - smoothstep( 0.0, max( .05, fw * 1.2 ), edge ) ) * ( 1.0 - smoothstep( .12, .5, fw ) );
          vec3 base = pow( vVox.rgb, vec3( 2.2 ) );
          base *= .88 + .24 * tint;
          base *= 1.0 - .16 * line;
          diffuseColor.rgb *= base;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, .38, vVox.a );`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = vVox.a * .55;`);
  };
  mat.customProgramCacheKey = () => 'voxel';
  return mat;
}
