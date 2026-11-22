// Top-down baked lighting for the district. Street lamps, shop windows and neon
// paint warm light into an RGB map; props and building bases paint contact
// shadow into an AO map. Ground, wall and prop materials sample both by world XZ,
// so lamp pools follow kerbs exactly and wet surfaces pick up glints.
import * as THREE from '../../vendor/three.min.js';
import { WET, MAX_REFLECT } from '../render/lightfx.js';
import { ATMOS_U, attachAtmosUniforms } from '../render/daylight.js';


// Wet asphalt, shared by every 'wet' ground material:
//  - macro wetness: two octaves of world-space value noise make whole patches of
//    road glossy and others merely damp; gutters (the baked kerb AO) hold water;
//  - wet = darker albedo + low roughness;
//  - fresnel sky tint at grazing angles (horizon colour, warmer toward the sun);
//  - vertical reflection smears of the brightest nearby lights (picked per frame
//    in render/lightfx.js): each source is mirrored in the surface plane and its
//    image is spread a little in azimuth and a lot in elevation, which is what a
//    rough wet surface does to a point light.
const WET_PARS = /* glsl */`
  uniform vec4 uWetPos[${MAX_REFLECT}];
  uniform vec3 uWetCol[${MAX_REFLECT}];
  uniform int uWetCount;
  uniform float uWetAmt, uWetCover;
  uniform vec3 bwLmSun, bwLmHor, bwLmGlow;
  float bwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bwNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(bwHash(i), bwHash(i + vec2(1.0, 0.0)), u.x), mix(bwHash(i + vec2(0.0, 1.0)), bwHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;


const SIZE = 2048;

export class LightMap {
  constructor(rect) {
    this.rect = rect; // { x0, z0, w, h }
    this.light = document.createElement('canvas');
    this.ao = document.createElement('canvas');
    this.light.width = this.light.height = this.ao.width = this.ao.height = SIZE;
    this.lg = this.light.getContext('2d');
    this.ag = this.ao.getContext('2d');
    this.lg.fillStyle = '#000'; this.lg.fillRect(0, 0, SIZE, SIZE);
    this.ag.fillStyle = '#fff'; this.ag.fillRect(0, 0, SIZE, SIZE);
    this.lg.globalCompositeOperation = 'lighter';
    this.sx = SIZE / rect.w;
    // registry for render/lightfx.js: glow sprites, light shafts, wet-road reflection sources
    this.lights = { sprites: [], shafts: [], sources: [], fx: null };
    this.uniforms = {
      uLightMap: { value: null },
      uAoMap: { value: null },
      uLmRect: { value: new THREE.Vector4(rect.x0, rect.z0, rect.w, rect.h) },
      uLmStrength: { value: 3.4 },
    };
  }
  // A glow billboard. rgb is HDR linear; returns its index (static sprites can be recoloured).
  glow(x, y, z, rgb, size, opts = {}) {
    this.lights.sprites.push({ x, y, z, r: rgb[0], g: rgb[1], b: rgb[2], size, ...opts });
    return this.lights.sprites.length - 1;
  }
  // A faint additive cone of lit air from (x,y,z) along (dx,dy,dz).
  shaft(x, y, z, dx, dy, dz, len, radius, rgb) {
    this.lights.shafts.push({ x, y, z, dx, dy, dz, len, radius, r: rgb[0], g: rgb[1], b: rgb[2] });
  }
  // A light the wet road reflects; w widens the smear for broad sources (signs, windows).
  source(x, y, z, rgb, w = 1) {
    const s = { x, y, z, r: rgb[0], g: rgb[1], b: rgb[2], w };
    this.lights.sources.push(s);
    return s;
  }

  px(x) { return (x - this.rect.x0) * this.sx; }
  pz(z) { return (z - this.rect.z0) * this.sx; }

  // Soft pool of light. colour as [r,g,b] 0..255, intensity 0..1 at centre.
  pool(x, z, radius, rgb, intensity = 1, squashX = 1, squashZ = 1) {
    const g = this.lg, cx = this.px(x), cz = this.pz(z), r = radius * this.sx;
    g.save();
    g.translate(cx, cz);
    g.scale(squashX, squashZ);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    const c = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    gr.addColorStop(0, c(intensity));
    gr.addColorStop(0.25, c(intensity * 0.62));
    gr.addColorStop(0.6, c(intensity * 0.2));
    gr.addColorStop(1, c(0));
    g.fillStyle = gr;
    g.fillRect(-r, -r, 2 * r, 2 * r);
    g.restore();
  }

  // Light spilling from a window strip: rectangle along a side, fading outward.
  spill(x0, z0, x1, z1, nx, nz, depth, rgb, intensity) {
    const g = this.lg;
    const ax = this.px(x0), az = this.pz(z0), bx = this.px(x1), bz = this.pz(z1);
    const d = depth * this.sx;
    const gr = g.createLinearGradient((ax + bx) / 2, (az + bz) / 2, (ax + bx) / 2 + nx * d, (az + bz) / 2 + nz * d);
    const c = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    gr.addColorStop(0, c(intensity)); gr.addColorStop(0.4, c(intensity * 0.35)); gr.addColorStop(1, c(0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(ax, az); g.lineTo(bx, bz); g.lineTo(bx + nx * d, bz + nz * d); g.lineTo(ax + nx * d, az + nz * d);
    g.closePath(); g.fill();
  }

  shadow(x, z, radius, strength = 0.55) {
    const g = this.ag, cx = this.px(x), cz = this.pz(z), r = radius * this.sx;
    const gr = g.createRadialGradient(cx, cz, 0, cx, cz, r);
    gr.addColorStop(0, `rgba(0,0,0,${strength})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(cx - r, cz - r, 2 * r, 2 * r);
  }

  // Darkening band along a line (building bases, kerb gutters), fading along the normal.
  shadowStrip(x0, z0, x1, z1, nx, nz, width, strength = 0.5) {
    const g = this.ag;
    const ax = this.px(x0), az = this.pz(z0), bx = this.px(x1), bz = this.pz(z1), w = width * this.sx;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const gr = g.createLinearGradient(mx, mz, mx + nx * w, mz + nz * w);
    gr.addColorStop(0, `rgba(0,0,0,${strength})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(ax, az); g.lineTo(bx, bz); g.lineTo(bx + nx * w, bz + nz * w); g.lineTo(ax + nx * w, az + nz * w);
    g.closePath(); g.fill();
  }

  finish() {
    const make = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.uniforms.uLightMap.value = make(this.light, true);
    this.uniforms.uAoMap.value = make(this.ao, false);
  }

  // Inject baked lighting into a MeshStandardMaterial.
  //  mode 'ground': full light + AO + wet glints.  'wall': light fading with height.
  patch(material, { mode = 'ground', spec = 0, push = 0, fall = 0.35, wet = 0 } = {}) {
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      attachAtmosUniforms(shader);                  // PASS 16: live fog colours / sun (render/daylight.js)
      if (wet > 0) Object.assign(shader.uniforms, WET, { bwLmSun: ATMOS_U.bwLmSun, bwLmHor: ATMOS_U.bwLmHor, bwLmGlow: ATMOS_U.bwLmGlow });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLmWorld;\nvarying vec3 vLmNormal;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 lmW = vec4(transformed, 1.0);
          vec3 lmN = objectNormal;
          #ifdef USE_INSTANCING
            lmW = instanceMatrix * lmW;
            lmN = mat3(instanceMatrix) * lmN;
          #endif
          lmW = modelMatrix * lmW;
          vLmWorld = lmW.xyz;
          vLmNormal = normalize(mat3(modelMatrix) * lmN);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vLmWorld; varying vec3 vLmNormal;
          uniform sampler2D uLightMap; uniform sampler2D uAoMap;
          uniform vec4 uLmRect; uniform float uLmStrength;
          ${wet > 0 ? WET_PARS : ''}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          ${wet > 0 ? `
          float bwWet;
          {
            vec2 wq = vLmWorld.xz;
            float m = bwNoise(wq / 23.0) * 0.65 + bwNoise(wq / 6.5 + 13.7) * 0.35;
            bwWet = smoothstep(0.38 - 0.12 * uWetCover, 0.72 - 0.1 * uWetCover, m);   // after rain more of the road holds water
            vec2 aoUv = (vLmWorld.xz - uLmRect.xy) / uLmRect.zw;
            float gut = 1.0 - texture2D(uAoMap, aoUv).r;
            bwWet = clamp(max(bwWet, gut * 1.6) * ${wet.toFixed(2)} * uWetAmt, 0.0, 1.0);
            roughnessFactor = mix(roughnessFactor, 0.07, bwWet * 0.9);
            diffuseColor.rgb *= 1.0 - 0.32 * bwWet;
          }` : ''}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            vec2 lmUv = (vLmWorld.xz + vLmNormal.xz * ${push.toFixed(2)} - uLmRect.xy) / uLmRect.zw;
            float inside = step(0.0, lmUv.x) * step(lmUv.x, 1.0) * step(0.0, lmUv.y) * step(lmUv.y, 1.0);
            vec3 lm = texture2D(uLightMap, lmUv).rgb * uLmStrength * inside;
            ${mode === 'ground' ? `
            // ground pools read stronger than the wall spill: the lamp is overhead
            lm *= 1.3;
            float ao = mix(1.0, texture2D(uAoMap, lmUv).r, inside);
            reflectedLight.directDiffuse *= ao;
            reflectedLight.indirectDiffuse *= ao;
            reflectedLight.indirectSpecular *= mix(1.0, ao, 0.6);` : `
            float facing = clamp(dot(vLmNormal, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.7, 0.35, 1.0);
            lm *= exp(-max(vLmWorld.y - 0.3, 0.0) * ${fall.toFixed(3)}) * facing;`}
            reflectedLight.indirectDiffuse += diffuseColor.rgb * lm;
            ${spec > 0 ? `reflectedLight.indirectSpecular += lm * pow(1.0 - roughnessFactor, 3.0) * ${spec.toFixed(2)};` : ''}
            ${wet > 0 ? `
            {
              vec3 toP = vLmWorld - cameraPosition;
              float dP = length(toP);
              vec3 d = toP / max(dP, 1e-4);
              float ndv = clamp(-d.y, 0.0, 1.0);
              float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
              vec2 dh = d.xz / max(length(d.xz), 1e-4);
              // sky tint at grazing angles: horizon colour, warming toward the low sun
              float sunAz = pow(max(dot(dh, normalize(bwLmSun.xz)), 0.0), 3.0);
              vec3 skyT = mix(bwLmHor * 0.55, bwLmGlow * 0.9, sunAz) * min(uWetAmt, 1.0);
              float glossW = 0.35 + 0.65 * bwWet;
              reflectedLight.indirectSpecular += skyT * fres * glossW * 0.55 * ao;
              // lamp pools glisten where the road holds water
              reflectedLight.indirectSpecular += lm * bwWet * (0.18 + 0.5 * fres);
              // ripple break-up: streaks shimmer in bands instead of solid bars
              float rip = bwNoise(vLmWorld.xz * 1.6) * 0.6 + bwNoise(vLmWorld.xz * 4.3 + 7.1) * 0.4;
              float wob = (bwNoise(vLmWorld.xz * 2.2 + 3.3) - 0.5);
              vec3 refl = vec3(0.0);
              float sa0 = 0.0015 + 0.005 * roughnessFactor;
              float se = 0.035 + 0.17 * roughnessFactor;
              for (int i = 0; i < ${MAX_REFLECT}; i++) {
                if (i >= uWetCount) break;
                vec4 L = uWetPos[i];
                vec3 e = vec3(L.x, 2.0 * vLmWorld.y - L.y, L.z) - cameraPosition;
                float de = length(e);
                e /= de;
                vec2 eh = e.xz / max(length(e.xz), 1e-4);
                float azc = dot(dh, eh);
                if (azc <= 0.0) continue;
                float sa = sa0 + 0.07 * L.w / de;
                float az = dh.x * eh.y - dh.y * eh.x + wob * sa * 0.9;
                float el = d.y - e.y;
                float s = exp(-az * az / (sa * sa) - el * el / (se * se));
                // the smear thins out the further it is from the lamp's foot
                vec2 foot = vLmWorld.xz - L.xz;
                float fk = 3.5 + 2.0 * max(L.y - vLmWorld.y, 0.5) * L.w;
                s *= exp(-dot(foot, foot) / (fk * fk));
                refl += uWetCol[i] * s;
              }
              refl *= 0.35 + 1.1 * rip;
              reflectedLight.indirectSpecular += refl * (0.12 + 0.88 * fres) * (0.12 + 0.88 * bwWet) * ${(1.05 * wet).toFixed(3)} * uWetAmt * ao;
            }` : ''}
          }`);
    };
    material.customProgramCacheKey = () => `lm-${mode}-${spec}-${push}-${fall}-${wet}`;
    return material;
  }
}
