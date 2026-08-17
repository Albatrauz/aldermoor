/* ============================ height fog ============================ */
// Uniform FogExp2 veils a distant skyline exactly as much as it veils the alley
// you're standing in, which reads as a flat grey wash. Real air is thicker near
// the ground: dust hanging over the desert, mist pooling between the buildings.
//
// Core three has nothing for this — Fog and FogExp2 are still the only options
// at r185, and the volumetric work all went to the WebGPU path. So we patch the
// fog maths ourselves: a few extra ALU ops in the fragment shader, no extra
// pass, no extra draw call.
//
// IMPORTANT — why this patches materials and not THREE.ShaderChunk:
// the obvious implementation is to overwrite the global fog chunks. That breaks
// the game. `fog_vertex` is shared with sprite.glsl.js, whose vertex shader has
// no `transformed` in scope (it builds mvPosition from modelViewMatrix[3]
// directly), so any patch referencing world position fails to compile every
// Sprite we have — nametags, damage numbers, muzzle flashes, the sun glow.
// Patching per-material through onBeforeCompile keeps the change on the
// MeshStandardMaterials that actually want it and leaves sprites alone.
import * as THREE from 'three';
import * as mats from './materials';

// Shared across every patched material, so a map switch is one assignment.
const fogHeight = { value: 8 };
const fogHeightFalloff = { value: 0.12 };

const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	// Full strength at and below fogHeight, thinning exponentially above it, so
	// haze sits in the streets without veiling the skyline.
	fogFactor *= exp( - max( 0.0, vFogWorldY - fogHeight ) * fogHeightFalloff );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

function patch(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.fogHeight = fogHeight;
    shader.uniforms.fogHeightFalloff = fogHeightFalloff;

    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying float vFogWorldY;')
      // `transformed` is in scope here for every mesh shader, and already
      // carries any instancing/skinning transform.
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFogWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>',
        '#include <fog_pars_fragment>\nuniform float fogHeight;\nuniform float fogHeightFalloff;\nvarying float vFogWorldY;')
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  // Without this three would happily share a compiled program between a patched
  // and an unpatched material with otherwise identical parameters.
  mat.customProgramCacheKey = () => 'heightFog';
  mat.needsUpdate = true;
}

// Applied to every shared world material at import time — before world.ts builds
// a map, so nothing compiles unpatched and then has to be thrown away.
for (const v of Object.values(mats)) {
  if (v instanceof THREE.Material) patch(v);
}

export function setFogHeight(height: number, falloff: number) {
  fogHeight.value = height;
  fogHeightFalloff.value = falloff;
}
