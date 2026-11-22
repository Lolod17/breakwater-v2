// Layered atmosphere for every built-in material that uses scene fog. Replaces
// three's fog chunks (once, before any program compiles) with:
//  - the original exp2 distance haze (scene.fog.density),
//  - a ground-hugging mist layer whose density falls off with height, integrated
//    analytically along the view ray (so tower tops rise out of it),
//  - thin industrial haze over the container terminal, warm and low,
//  - sun inscatter: fog looking toward the low sun takes on the sunset glow.
// Constants are baked from MOOD, so there are no extra uniforms to wire.
import * as THREE from '../../vendor/three.min.js';
import { MOOD } from '../config.js';
import { attachAtmosUniforms } from './daylight.js';

const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const c3 = (c, k = 1) => `vec3(${(c.r * k).toFixed(4)}, ${(c.g * k).toFixed(4)}, ${(c.b * k).toFixed(4)})`;

export const ATMOS = {
  mist: 0.0016,       // ground mist density at y = 0 (per metre)
  mistFall: 0.055,    // 1/scale height of the mist (m^-1)
  port: 0.0038,       // extra haze density over the terminal
  sunInscatter: 0.55,
  nearScale: 0.75,    // scale on the exp2 haze (keeps the near street unwashed)
  farStart: 170,      // metres where the far wall layer begins
  far: 0.0045,        // far wall layer: tau = ((d - farStart) * far)^2
};

let installed = false;
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  // PASS 16: every built-in material gets the live sky/sun uniforms (render/daylight.js) at
  // compile time. Materials with their own onBeforeCompile call attachAtmosUniforms
  // themselves (lightmap.patch); any that do not keep bwOn = 0, i.e. the baked dusk values.
  THREE.Material.prototype.onBeforeCompile = function (shader) { attachAtmosUniforms(shader); };
  const C = THREE.ShaderChunk;
  const sun = MOOD.sunDir.clone().normalize();
  const portCol = new THREE.Color('#6d5a52');
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogRay;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogRay = mvPosition.xyz * mat3(viewMatrix);
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float bwOn;
  uniform vec3 bwSunDir, bwGlow, bwHor, bwMid;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    float fDist = length(vFogRay);
    vec3 fDir = vFogRay / max(fDist, 1e-4);
    vec3 fMid = cameraPosition + vFogRay * 0.5;
    float port = smoothstep(170.0, 300.0, fMid.x) * smoothstep(110.0, 230.0, fMid.z) * exp(-max(fMid.y, 0.0) / 28.0);
    #ifdef FOG_EXP2
      // near street stays crisp: the exp2 haze is eased off close in, and a far
      // wall layer ramps in past ~${ATMOS.farStart} m to swallow the district edge
      float tau = fogDensity * fogDensity * fDist * fDist * ${ATMOS.nearScale.toFixed(3)};
      float farD = max(fDist - ${ATMOS.farStart.toFixed(1)}, 0.0) * ${ATMOS.far.toFixed(5)};
      tau += farD * farD;
      float ry = vFogRay.y * ${ATMOS.mistFall.toFixed(4)};
      float k = abs(ry) > 1e-3 ? (1.0 - exp(-ry)) / ry : 1.0 - ry * 0.5;
      float mist = ${ATMOS.mist.toFixed(5)} * exp(-${ATMOS.mistFall.toFixed(4)} * max(cameraPosition.y, 0.0)) * fDist * k;
      float haze = port * fDist * ${ATMOS.port.toFixed(5)};
      tau += mist + haze;
      float fogFactor = 1.0 - exp(-tau);
      float portW = haze / max(tau, 1e-4);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fDist);
      float portW = 0.0;
    #endif
    bool live = bwOn > 0.5;
    float sunAmt = pow(max(dot(fDir, live ? normalize(bwSunDir) : ${v3(sun)}), 0.0), 7.0);
    vec3 fCol = mix(fogColor, ${c3(portCol)}, portW * 0.8);
    // layered colour: warm dusk band at street level, cooling into the sky
    // colour on upward rays so tower tops dissolve into the sky, not into grey
    fCol = mix(fCol, live ? bwHor * 0.75 : ${c3(MOOD.skyHorizon, 0.75)}, (1.0 - smoothstep(-0.02, 0.06, fDir.y)) * smoothstep(120.0, 400.0, fDist) * 0.35);
    fCol = mix(fCol, live ? bwMid : ${c3(MOOD.skyMid)}, smoothstep(0.04, 0.4, fDir.y) * 0.6);
    fCol += (live ? bwGlow * ${ATMOS.sunInscatter.toFixed(3)} : ${c3(MOOD.skyGlow, ATMOS.sunInscatter)}) * sunAmt;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
  }
#endif`;
}
