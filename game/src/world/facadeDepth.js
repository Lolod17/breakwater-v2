// Recessed windows without geometry: a parallax pass chained onto the facade
// materials (after the light-map patch). The facade surface map marks glass
// (low roughness); for a glass texel the view ray is pushed `depth` metres into
// the wall and the textures are sampled where it lands. If it lands on wall,
// the ray hit the window reveal first, which is shaded as a dark jamb/head/sill
// with no window light. Glass close to a reveal gets a contact shadow. All four
// facade maps (albedo, emissive, roughness, metalness) use the shifted UV, so
// lit windows sit visibly behind the wall plane at any angle.
import * as THREE from '../../vendor/three.min.js';

// metres per facade UV unit: 16 bays of 3.2 m across, 16 floors of 3.4 m up
const UV_PER_M = [1 / (16 * 3.2), 1 / (16 * 3.4)];

export function recessWindows(material, { depth = 0.25, reveal = '#6a645c' } = {}) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  const rc = new THREE.Color(reveal);
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uBwDepth = { value: depth };
    shader.uniforms.uBwReveal = { value: rc };
    const swap = (chunk, from) => THREE.ShaderChunk[chunk].split(from).join('bwUv');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBwDepth; uniform vec3 uBwReveal;`)
      .replace('#include <map_fragment>', `
        vec2 bwUv = vMapUv;
        float bwRev = 0.0, bwShade = 1.0;
        {
          vec3 N = normalize(vLmNormal);
          vec3 toC = cameraPosition - vLmWorld;
          float dist = length(toC);
          vec3 V = toC / dist;
          vec3 T = vec3(N.z, 0.0, -N.x);
          float wallW = step(abs(N.y), 0.5) * (1.0 - smoothstep(180.0, 320.0, dist));
          float vz = max(dot(V, N), 0.22);
          vec2 sh = vec2(dot(V, T), V.y) / vz * uBwDepth * vec2(${UV_PER_M[0].toFixed(6)}, ${UV_PER_M[1].toFixed(6)}) * wallW;
          float m0 = smoothstep(0.5, 0.3, texture2D(roughnessMap, vMapUv).g);
          vec2 uv1 = vMapUv - sh;
          float m1 = smoothstep(0.5, 0.3, texture2D(roughnessMap, uv1).g);
          float m2 = smoothstep(0.5, 0.3, texture2D(roughnessMap, vMapUv - sh * 1.9).g);
          bwRev = m0 * (1.0 - m1) * wallW;
          bwUv = mix(vMapUv, uv1, m0);
          bwShade = mix(1.0, mix(0.55, 1.0, m2), m0 * wallW);
        }
        ${swap('map_fragment', 'vMapUv')}
        diffuseColor.rgb = mix(diffuseColor.rgb * bwShade, uBwReveal, bwRev);`)
      .replace('#include <roughnessmap_fragment>', `${swap('roughnessmap_fragment', 'vRoughnessMapUv')}
        roughnessFactor = mix(roughnessFactor, 0.9, bwRev);`)
      .replace('#include <metalnessmap_fragment>', `${swap('metalnessmap_fragment', 'vMetalnessMapUv')}
        metalnessFactor = mix(metalnessFactor, 0.0, bwRev);`)
      .replace('#include <emissivemap_fragment>', `${swap('emissivemap_fragment', 'vEmissiveMapUv')}
        totalEmissiveRadiance *= (1.0 - bwRev) * mix(1.0, bwShade, 0.6);`);
  };
  material.customProgramCacheKey = () => `${prevKey}-bwrecess-${depth}`;
  return material;
}
