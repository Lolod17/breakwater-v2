// The city beyond the playable district: a ring of distant towers 600-1600 m
// out to the north, east and west (the harbour and the far shore close the
// south), so the horizon is never empty. One mesh, one draw call: boxes and
// setback tiers whose shader paints hashed window lights per building (punched
// windows, office ribbons lit floor by floor, glass grids, warm residential;
// anti-aliased into a soft facade glow once a window is smaller than a pixel),
// lit crown bands, sun-side rim, street glow at the base and its own aerial
// perspective, leaving dark violet volumes against the brighter horizon sky. A second,
// taller cluster to the north-east reads as another downtown. The tallest
// carry blinking red beacons (glow sprites).
import * as THREE from '../../vendor/three.min.js';
import { MOOD, CITY } from '../config.js';
import { GeoBuilder } from './geobuilder.js';

// Visual-only hash (the seeded stream keeps its draw order, so the beacons and
// the footprint layout stay where they were).
const fh = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

export function buildFarCity(rng, lm) {
  const b = new GeoBuilder();
  const tops = [];
  // per-vertex building data: seed, lit share, facade type, roof height
  const attr = [];
  const tag = (from, seed, lit, type, top) => {
    for (let i = from; i < b.vertexCount; i++) attr.push(seed, lit, type, top);
  };
  const step = 62;
  for (let x = -1700; x <= 1700; x += step) {
    for (let z = -1700; z <= 260; z += step) {
      const jx = x + rng.float(-18, 18), jz = z + rng.float(-18, 18);
      const r = Math.hypot(jx, jz);
      if (r < 620 || r > 1650) { rng.next(); rng.next(); rng.next(); continue; }
      if (jz > CITY.quayZ - 40 && Math.abs(jx) < 900) { rng.next(); rng.next(); rng.next(); continue; }
      const cluster = Math.exp(-(((jx - 520) ** 2 + (jz + 1080) ** 2) / (2 * 260 * 260)));
      const dens = 0.42 + cluster * 0.5 - (r - 620) / 1030 * 0.18;
      const pick = rng.next();
      const hRoll = rng.next(), wRoll = rng.next();
      if (pick > dens) continue;
      let h = 14 + hRoll * hRoll * 55 + cluster * (40 + hRoll * 120);
      if (hRoll > 0.93) h += 60;
      const w = 22 + wRoll * 26, d = 20 + ((wRoll * 7.3) % 1) * 24;
      const seed = fh(jx * 0.11, jz * 0.13);
      // facade type: 0 punched windows, 1 ribbon bands, 2 glass grid, 3 low residential
      const type = h > 90 ? (seed < 0.55 ? 2 : seed < 0.85 ? 1 : 0) : h < 34 ? (seed < 0.6 ? 3 : 0) : (seed < 0.4 ? 0 : seed < 0.75 ? 1 : 2);
      const lit = 0.14 + fh(jz * 0.07, jx * 0.05) * 0.3 + (type === 2 ? 0.08 : 0);
      const v0 = b.vertexCount;
      let top = h;
      const tiered = h > 70 && seed > 0.3;
      if (tiered) {
        // two or three setback tiers, then a crown or a spire
        const t1 = h * (0.5 + seed * 0.15), t2 = h * 0.82;
        b.box(jx, t1 / 2, jz, w, t1, d, {});
        b.box(jx, (t1 + t2) / 2, jz, w * 0.78, t2 - t1, d * 0.78, {});
        b.box(jx, (t2 + h) / 2, jz, w * 0.58, h - t2, d * 0.58, {});
        if (seed > 0.8 && h > 120) { b.box(jx, h + 14, jz, 1.6, 28, 1.6, {}); top = h + 28; }
      } else {
        b.box(jx, h / 2, jz, w, h, d, {});
        // setback crown on the tall ones
        if (h > 70) { b.box(jx, h + 6, jz, w * 0.6, 12, d * 0.6, {}); top = h + 12; }
        else if (seed > 0.5) b.box(jx + (seed - 0.75) * w * 0.6, h + 2, jz, w * 0.3, 4, d * 0.35, {}); // stair/plant house
      }
      tag(v0, seed, lit, type, tiered ? h : (h > 70 ? h + 12 : h));
      tops.push([jx, top, jz]);
    }
  }
  tops.sort((p, q) => q[1] - p[1]);
  for (const [x, y, z] of tops.slice(0, 26)) {
    lm.glow(x, y + 3, z, [10, 0.6, 0.35], 9, { blink: 0.45 + 0.25 * ((x * 0.013) % 1 + 1) % 1, phase: ((z * 0.0071) % 1 + 1) % 1, pull: 4 });
  }
  const geo = b.build();
  geo.deleteAttribute('uv');
  geo.deleteAttribute('color');
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(attr, 4));
  const sun = MOOD.sunDir;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSil: { value: new THREE.Color('#0b0b16') },
      uFog: { value: MOOD.fogColor.clone() },
      uGlow: { value: MOOD.skyGlow.clone() },
    },
    vertexShader: /* glsl */`
      attribute vec4 aB;
      varying vec3 vW;
      varying vec3 vN;
      varying vec4 vB;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal; vB = aB;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSil, uFog, uGlow;
      varying vec3 vW;
      varying vec3 vN;
      varying vec4 vB;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float seed = vB.x, litShare = vB.y, type = vB.z, top = vB.w;
        float d = length(vW.xz - cameraPosition.xz);
        float f = clamp(0.5 + (1.0 - exp(-max(d - 600.0, 0.0) * 0.0016)) * 0.4, 0.0, 0.92);
        // massing: faces toward the low sun pick up a warm rim, the others stay cool;
        // each building gets its own value so overlapping towers separate
        float sunFace = clamp(dot(vN.xz, normalize(vec2(${sun.x.toFixed(3)}, ${sun.z.toFixed(3)}))), 0.0, 1.0);
        vec3 col = uSil * (0.7 + 0.6 * seed) * (0.8 + 0.5 * clamp(vN.y, 0.0, 1.0));
        col += uGlow * 0.03 * sunFace * smoothstep(0.0, 120.0, vW.y);
        // city glow rising off the streets at the foot of every block
        col += vec3(0.16, 0.08, 0.05) * exp(-vW.y / 18.0);
        vec3 lights = vec3(0.0);
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 cellSz = type < 0.5 ? vec2(3.2, 3.4) : type < 1.5 ? vec2(1.6, 3.6) : type < 2.5 ? vec2(1.5, 3.8) : vec2(4.0, 3.0);
          vec2 g = vec2(u / cellSz.x, vW.y / cellSz.y);
          vec2 fr = fract(g);
          vec2 cell = floor(g);
          vec2 lo = type < 0.5 ? vec2(0.22, 0.28) : type < 1.5 ? vec2(0.0, 0.3) : type < 2.5 ? vec2(0.08, 0.1) : vec2(0.3, 0.3);
          vec2 hi = type < 0.5 ? vec2(0.78, 0.82) : type < 1.5 ? vec2(1.0, 0.8) : type < 2.5 ? vec2(0.92, 0.9) : vec2(0.7, 0.85);
          float win = step(lo.x, fr.x) * step(fr.x, hi.x) * step(lo.y, fr.y) * step(fr.y, hi.y);
          // offices light whole floors in runs; homes light window by window
          vec2 run = type < 2.5 && type > 0.5 ? vec2(floor(cell.x / 6.0), cell.y) : cell;
          float floorOn = step(h(vec2(cell.y, seed * 91.0)), 0.25 + litShare);
          float pr = h(run + seed * 57.0 + floor(vW.xz / 40.0) * 7.31);
          float lit = step(pr, litShare) * mix(1.0, floorOn, step(0.5, type) * step(type, 2.5)) * step(5.0, vW.y) * step(vW.y, top - 1.0);
          float tempK = h(run * 1.73 + 3.1 + seed);
          vec3 warm = vec3(1.0, 0.66, 0.34), cool = vec3(0.68, 0.82, 1.0), fluo = vec3(0.86, 0.95, 0.9);
          vec3 wc = type > 2.5 ? warm : mix(warm, tempK > 0.5 ? cool : fluo, step(0.45 + 0.3 * seed, tempK));
          float dim = 0.6 + 0.4 * h(cell + 0.37);
          float aa = clamp(max(fwidth(g.x), fwidth(g.y)) * 1.6 - 0.3, 0.0, 1.0);
          float avg = (hi.x - lo.x) * (hi.y - lo.y) * litShare * 0.36;
          lights = wc * mix(win * lit * dim, avg, aa) * 1.6;
          // unlit glass still catches a little sky
          lights += vec3(0.05, 0.06, 0.1) * win * (1.0 - lit) * (1.0 - aa) * step(1.5, type) * step(type, 2.5);
          // lit crown band on some towers
          float crown = step(0.62, seed) * step(60.0, top) * smoothstep(top - 2.6, top - 2.2, vW.y) * (1.0 - smoothstep(top - 0.9, top - 0.5, vW.y));
          vec3 cc = seed > 0.85 ? vec3(0.3, 1.0, 0.95) : seed > 0.74 ? vec3(1.0, 0.45, 0.35) : vec3(1.0, 0.85, 0.6);
          lights += cc * crown * 2.2;
        }
        col = mix(col, uFog, f) + lights * (1.0 - f * 0.45);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'far-city';
  mesh.frustumCulled = false;
  return { mesh, count: tops.length };
}
