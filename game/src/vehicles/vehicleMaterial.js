// One shader for every vehicle part. Geometry carries per-vertex surface codes
// (aMat: roughness, metalness, paint mask, lamp kind) and each instance carries
// its paint (iPaint) and lamp state (iLamp: brake, reverse + indicators, headlights,
// siren). So a whole vehicle type, all its paint jobs and all its lights are one
// draw call. Each type gets its own material instance (same program) whose
// uniforms describe the shell, so the fragment shader can add what a merged
// mesh cannot carry by itself:
//  - cavity darkening: under the sills, toward the road, inside and round the
//    wheel arches, and in the seal line where the body meets the glass;
//  - panel lines: thin anti-aliased shut lines at the door seams;
//  - glass: dark, with a fresnel lift so it picks up the sky at grazing angles.
// PASS 10c: two more instance attributes carry the garage look (customParts.js):
// iCustom = (paint finish, window tint, headlight colour, livery kind) and
// iLivery = livery rgb. All zero is the factory car, so traffic is unchanged.
//  - finish 1 matte / 2 metallic / 3 pearl override the paint's roughness and
//    metalness and scale (or drop) the clearcoat; pearl adds a coloured grazing sheen;
//  - tint 1-4 recolours the glass (and how much of a cabin shows through);
//  - livery 1-5: stripes / two-tone / roundel painted procedurally in car space.
import * as THREE from '../../vendor/three.min.js';

export const LAMP = { none: 0, head: 1, tail: 2, brake: 3, reverse: 4, sirenRed: 5, sirenBlue: 6, amber: 7, plate: 8, glass: 9, clear: 10 };

// cabin (PASS 10a2): 'clear' glass (LAMP.clear) is drawn hashed at ~40 % coverage so a
// cockpit shows through it, still in the opaque pass (no sorting, no extra draw).
export function createVehicleMaterial(lm, { wheel = false, shade = null, cabin = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1.2 });
  if (cabin) mat.alphaHash = true;
  const sh = shade || { ride: 0.3, belt: 0.9, halfW: 0.9, wheelR: 0.33, arch: 0.39, axles: [1.4, -1.4, -1.4], seams: [99, 99, 99], seamY: [0, 0] };
  const uniforms = {
    uArch: { value: new THREE.Vector4(sh.axles[0], sh.axles[1], sh.axles[2], sh.arch) },
    uBody: { value: new THREE.Vector4(sh.ride, sh.belt, sh.halfW, sh.wheelR) },
    uSeam: { value: new THREE.Vector4(sh.seams[0] ?? 99, sh.seams[1] ?? 99, sh.seams[2] ?? 99, 99) },
    uSeamY: { value: new THREE.Vector2(sh.seamY[0], sh.seamY[1]) },
  };
  const lmHook = lm ? lm.patch(mat, { mode: 'wall', push: 0.2, fall: 0.25 }).onBeforeCompile : null;
  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aMat;
        ${wheel ? '' : 'attribute vec3 iPaint; attribute vec4 iLamp; attribute vec4 iCustom; attribute vec4 iLivery;'}
        varying vec4 vCust;
        varying vec3 vLiv;
        varying vec2 vRM;
        varying vec3 vEmis;
        varying vec3 vCarPos;
        varying vec3 vCarN;
        varying float vPaint;
        varying float vGlass;
        varying float vClear;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vRM = aMat.xy;
        vEmis = vec3(0.0);
        vCarPos = position;
        vCarN = normal;
        vPaint = aMat.z;
        vGlass = step(8.5, aMat.w);
        vClear = step(9.5, aMat.w);
        vCust = vec4(0.0); vLiv = vec3(1.0);
        ${wheel ? '' : `
        vCust = iCustom; vLiv = iLivery.rgb;
        vColor.rgb = mix(vColor.rgb, iPaint, aMat.z);
        float k = aMat.w;
        float sirenOn = step(0.5, iLamp.w);
        float ph = fract(iLamp.w);
        float flashA = sirenOn * step(0.5, ph) * step(0.08, fract(ph * 4.0));
        float flashB = sirenOn * (1.0 - step(0.5, ph)) * step(0.08, fract(ph * 4.0));
        // iLamp.y packs reverse (bit 0) and the indicators: bit 1 left (+x), bit 2 right
        float rev = mod(iLamp.y, 2.0);
        float indL = mod(floor(iLamp.y / 2.0), 2.0), indR = floor(iLamp.y / 4.0);
        float ind = position.x > 0.0 ? indL : indR;
        vec3 headTint = vec3(1.0);
        if (abs(iCustom.z - 1.0) < 0.5) headTint = vec3(0.72, 0.9, 1.35);
        else if (abs(iCustom.z - 2.0) < 0.5) headTint = vec3(1.2, 0.72, 0.18);
        else if (abs(iCustom.z - 3.0) < 0.5) headTint = vec3(0.92, 0.98, 1.12);
        else if (abs(iCustom.z - 4.0) < 0.5) headTint = vec3(0.78, 0.42, 1.4);
        if (abs(k - 1.0) < 0.5) vEmis = vec3(7.0, 6.6, 5.6) * headTint * iLamp.z;
        else if (abs(k - 2.0) < 0.5) vEmis = vec3(2.6, 0.06, 0.04) * (0.08 + 0.92 * iLamp.z) + vec3(7.0, 0.15, 0.08) * iLamp.x;
        else if (abs(k - 3.0) < 0.5) vEmis = vec3(11.0, 0.25, 0.12) * iLamp.x;
        else if (abs(k - 4.0) < 0.5) vEmis = vec3(6.0, 6.0, 6.0) * rev;
        else if (abs(k - 5.0) < 0.5) vEmis = vec3(16.0, 0.5, 0.4) * flashA + vec3(0.25, 0.0, 0.0);
        else if (abs(k - 6.0) < 0.5) vEmis = vec3(0.4, 1.2, 18.0) * flashB + vec3(0.0, 0.0, 0.3);
        else if (abs(k - 7.0) < 0.5) vEmis = vec3(0.12, 0.05, 0.0) + vec3(5.5, 2.2, 0.05) * ind;
        else if (abs(k - 8.0) < 0.5) vEmis = vec3(0.35, 0.33, 0.3) * iLamp.z;`}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRM;
        varying vec3 vEmis;
        varying vec3 vCarPos;
        varying vec3 vCarN;
        varying float vPaint;
        varying float vGlass;
        varying float vClear;
        varying vec4 vCust;
        varying vec3 vLiv;
        uniform vec4 uArch, uBody, uSeam;
        uniform vec2 uSeamY;
        float bwAO = 1.0;
        float bwCavity() {
          ${wheel ? 'return 1.0;' : `
          vec3 p = vCarPos;
          float ao = 1.0;
          // toward the road: sills and lower body lose sky light, underside is black
          ao *= mix(0.42, 1.0, smoothstep(uBody.x - 0.04, uBody.x + 0.42, p.y));
          ao *= 0.55 + 0.45 * clamp(normalize(vCarN).y * 0.6 + 0.75, 0.0, 1.0);
          // round and inside the wheel arches
          float dA = min(min(length(vec2(p.z - uArch.x, p.y - uBody.w)), length(vec2(p.z - uArch.y, p.y - uBody.w))), length(vec2(p.z - uArch.z, p.y - uBody.w)));
          ao *= mix(0.3, 1.0, smoothstep(uArch.w - 0.02, uArch.w + 0.2, dA));
          // seal line where paint meets glass
          ao *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 0.045, abs(p.y - uBody.y))), vPaint);
          // shut lines on the body sides (anti-aliased, fade out when sub-pixel)
          float side = smoothstep(uBody.z - 0.22, uBody.z - 0.06, abs(p.x)) * step(uSeamY.x, p.y) * step(p.y, uSeamY.y);
          float w = max(fwidth(p.z), 1e-4);
          float dz = min(min(abs(p.z - uSeam.x), abs(p.z - uSeam.y)), abs(p.z - uSeam.z));
          float line = 1.0 - smoothstep(0.004, 0.004 + w * 1.5, dz);
          line *= side * vPaint * (1.0 - smoothstep(0.012, 0.03, w));
          ao *= 1.0 - 0.6 * line;
          return ao;`}
        }
        // livery coverage (0..1) on a paint surface, car space
        float bwLivery() {
          ${wheel ? 'return 0.0;' : `
          float kind = vCust.w;
          if (kind < 0.5) return 0.0;
          vec3 p = vCarPos; vec3 n = normalize(vCarN);
          float up = smoothstep(0.3, 0.45, n.y), side = smoothstep(0.5, 0.65, abs(n.x));
          float wx = max(fwidth(p.x), 1e-4), wy = max(fwidth(p.y), 1e-4);
          float mid = mix(uBody.x, uBody.y, 0.6);
          if (kind < 1.5) {          // rally twin: two stripes over bonnet, roof and boot
            float d = abs(abs(p.x) - 0.2) - 0.075;
            return up * (1.0 - smoothstep(-wx, wx, d));
          } else if (kind < 2.5) {   // one wide centre stripe
            return up * (1.0 - smoothstep(-wx, wx, abs(p.x) - 0.16));
          } else if (kind < 3.5) {   // side stripe with a pin line
            float d = abs(p.y - mid);
            float s = (1.0 - smoothstep(0.05 - wy, 0.05 + wy, d)) + (1.0 - smoothstep(0.012 - wy, 0.012 + wy, abs(p.y - mid - 0.085)));
            return side * clamp(s, 0.0, 1.0);
          } else if (kind < 4.5) {   // two-tone: everything above the belt line
            return smoothstep(uBody.y - 0.01 - wy, uBody.y - 0.01 + wy, p.y);
          }
          // race roundel on each door: a disc with a paint-coloured ring
          float r = length(vec2(p.z - 0.05, p.y - mix(uBody.x, uBody.y, 0.5)));
          float wr = max(fwidth(r), 1e-4);
          float disc = 1.0 - smoothstep(0.24 - wr, 0.24 + wr, r);
          float ring = smoothstep(0.18 - wr, 0.18 + wr, r) * (1.0 - smoothstep(0.205 - wr, 0.205 + wr, r));
          return side * disc * (1.0 - ring);`}
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        bwAO = bwCavity();
        if (vPaint > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vLiv, bwLivery());
        // window tint: 1 clear, 2 light, 3 dark, 4 limo (0: factory glass)
        float tintK = vCust.y;
        if (vGlass > 0.5 && tintK > 0.5) diffuseColor.rgb = tintK < 1.5 ? vec3(0.05, 0.075, 0.07) : tintK < 2.5 ? vec3(0.012, 0.016, 0.02) : tintK < 3.5 ? vec3(0.002) : vec3(0.0004);
        diffuseColor.rgb *= bwAO;
        ${cabin ? 'diffuseColor.a = mix(1.0, tintK < 0.5 ? 0.4 : tintK < 1.5 ? 0.22 : tintK < 2.5 ? 0.5 : tintK < 3.5 ? 0.78 : 0.94, vClear);' : ''}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vRM.x;
        float fin = vPaint > 0.5 ? vCust.x : 0.0;
        if (fin > 0.5) roughnessFactor = fin < 1.5 ? 0.82 : fin < 2.5 ? 0.3 : 0.24;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = vRM.y;
        if (fin > 0.5) metalnessFactor = fin < 1.5 ? 0.0 : fin < 2.5 ? 0.78 : 0.42;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vEmis;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular *= mix(1.0, bwAO * bwAO, 0.85);
        reflectedLight.directSpecular *= bwAO;
        #ifdef USE_ENVMAP
        // clearcoat on paint: a sharp env reflection over the base coat, fresnel-weighted
        if (vPaint > 0.5) {
          float cv = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
          float cf = 0.05 + 0.95 * pow(1.0 - cv, 5.0);
          float coat = fin < 0.5 ? 1.1 : fin < 1.5 ? 0.0 : fin < 2.5 ? 1.0 : 1.25;
          reflectedLight.indirectSpecular += getIBLRadiance(geometryViewDir, normal, 0.06) * cf * coat * bwAO * envMapIntensity;
          if (fin > 2.5) {
            // pearl: a hue-shifted sheen that grows toward grazing angles
            vec3 pearl = normalize(diffuseColor.gbr + vec3(0.12)) * 0.9;
            float pf = pow(1.0 - cv, 2.0);
            reflectedLight.indirectSpecular += getIBLRadiance(geometryViewDir, normal, 0.35) * pearl * pf * 0.9 * bwAO * envMapIntensity;
            reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, reflectedLight.directDiffuse * pearl * 1.6, pf * 0.6);
          }
        }
        #endif
        // glass: reflections lift strongly toward grazing angles (dark face-on)
        if (vGlass > 0.5) {
          float gv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          reflectedLight.indirectSpecular *= 1.0 + 2.2 * pow(1.0 - gv, 3.0);
        }`);
    if (lmHook) lmHook(shader, renderer);
  };
  mat.customProgramCacheKey = () => `vehicle2-${wheel ? 'wheel' : 'body'}-${lm ? 'lm' : ''}${cabin ? '-cabin' : ''}`;
  return mat;
}
