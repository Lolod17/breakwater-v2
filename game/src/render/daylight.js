// PASS 16 — day, night and weather on screen.
// LOOK is the live version of config.MOOD: sun direction / colour / strength, sky
// gradient, fog colour and density, hemisphere fill, street-lamp and glow strength,
// exposure, wet-road amount and rain. update(minutes, weights, wetness) blends
// hour keyframes, then lays the weather over them. The 19:20 keyframe IS the
// dusk MOOD, and a clear sky changes nothing, so the default start looks exactly
// as it did before this pass.
// The renderer side (bind) points the sky, harbour water and far-city uniforms at
// LOOK's objects, feeds the fog chunk / wet ground / glow sprites through shared
// uniforms (ATMOS_U, WET, LightFX.gain), and sets the sun, hemisphere and fog.
import * as THREE from '../../vendor/three.min.js';
import { MOOD } from '../config.js';

const COLOR_KEYS = ['sunColor', 'skyZenith', 'skyMid', 'skyHorizon', 'skyGlow', 'fogColor', 'hemiSky', 'hemiGround', 'water', 'waterDeep'];

export const LOOK = {
  sunDir: MOOD.sunDir.clone(),
  ...Object.fromEntries(COLOR_KEYS.map((k) => [k, MOOD[k].clone()])),
  sunIntensity: MOOD.sunIntensity, hemiIntensity: MOOD.hemiIntensity, fogDensity: MOOD.fogDensity, exposure: MOOD.exposure,
  lamps: 1, glow: 1, env: 1, wet: 1, windows: 1, wetCover: 0, rain: 0, hour: 19 + 20 / 60, weather: 'clear',
};

// Shared uniforms for the fog chunk (render/atmosphere.js) and the wet-ground sky
// tint (world/lightmap.js). Every built-in material gets them at compile time.
export const ATMOS_U = {
  bwOn: { value: 1 },
  bwSunDir: { value: LOOK.sunDir },
  bwGlow: { value: LOOK.skyGlow },
  bwHor: { value: LOOK.skyHorizon },
  bwMid: { value: LOOK.skyMid },
  // the wet-ground sky tint (world/lightmap.js) reads the same objects under its own names
  bwLmSun: { value: LOOK.sunDir },
  bwLmHor: { value: LOOK.skyHorizon },
  bwLmGlow: { value: LOOK.skyGlow },
};
const FOG_U = { bwOn: ATMOS_U.bwOn, bwSunDir: ATMOS_U.bwSunDir, bwGlow: ATMOS_U.bwGlow, bwHor: ATMOS_U.bwHor, bwMid: ATMOS_U.bwMid };
export function attachAtmosUniforms(shader) { Object.assign(shader.uniforms, FOG_U); }

const hex = (h) => new THREE.Color(h);
const dir = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
// One keyframe per time of day; scalars are absolute, lamps/glow/env/wet are multipliers.
const KEY = (o) => ({ ...o, colors: Object.fromEntries(COLOR_KEYS.filter((k) => o[k]).map((k) => [k, hex(o[k])])) });
const NIGHT = KEY({ sunDir: dir(0.35, 0.62, -0.5), sunColor: '#7d93cc', sunIntensity: 0.45, skyZenith: '#03050c', skyMid: '#0a0e20', skyHorizon: '#1e1b30',
  skyGlow: '#3a2434', fogColor: '#171a2a', fogDensity: 0.0031, hemiSky: '#3a4470', hemiGround: '#1a1418', hemiIntensity: 0.62,
  water: '#06222a', waterDeep: '#020f12', exposure: 1.42, lamps: 1.12, glow: 1.08, env: 0.55, wet: 1, windows: 1.05 });
const DAWN = KEY({ sunDir: dir(0.82, 0.1, -0.45), sunColor: '#ffb48a', sunIntensity: 2.5, skyZenith: '#27396a', skyMid: '#6b6f9c', skyHorizon: '#e0a08c',
  skyGlow: '#ffb27a', fogColor: '#8a7f96', fogDensity: 0.0025, hemiSky: '#8c97c6', hemiGround: '#3b302e', hemiIntensity: 1.35,
  water: '#0d3a42', waterDeep: '#05202a', exposure: 1.2, lamps: 0.55, glow: 0.55, env: 0.95, wet: 0.85, windows: 0.7 });
const DAY = KEY({ sunDir: dir(0.18, 0.86, 0.34), sunColor: '#fff1dc', sunIntensity: 4.4, skyZenith: '#2b5aa6', skyMid: '#6f9ad4', skyHorizon: '#c6d4e6',
  skyGlow: '#fff2d6', fogColor: '#a5b4c8', fogDensity: 0.0019, hemiSky: '#c4d6f4', hemiGround: '#6a5a4a', hemiIntensity: 2.1,
  water: '#14505a', waterDeep: '#08303a', exposure: 1.1, lamps: 0.12, glow: 0.16, env: 1.2, wet: 0.4, windows: 0.4 });
const GOLDEN = KEY({ sunDir: dir(-0.55, 0.3, 0.78), sunColor: '#ffbd85', sunIntensity: 3.2, skyZenith: '#22447e', skyMid: '#6c78aa', skyHorizon: '#dba48e',
  skyGlow: '#ffb070', fogColor: '#7f7690', fogDensity: 0.0024, hemiSky: '#9aa2cc', hemiGround: '#4a3632', hemiIntensity: 1.45,
  water: '#0e3a40', waterDeep: '#051e22', exposure: 1.18, lamps: 0.45, glow: 0.5, env: 1.0, wet: 0.7, windows: 0.75 });
const DUSK = KEY({ sunDir: MOOD.sunDir.clone(), ...Object.fromEntries(COLOR_KEYS.map((k) => [k, '#' + MOOD[k].getHexString()])),
  sunIntensity: MOOD.sunIntensity, fogDensity: MOOD.fogDensity, hemiIntensity: MOOD.hemiIntensity, exposure: MOOD.exposure, lamps: 1, glow: 1, env: 1, wet: 1, windows: 1 });
for (const k of COLOR_KEYS) DUSK.colors[k] = MOOD[k].clone();     // exact, not via hex

const DUSK_H = 19 + 20 / 60;
const FRAMES = [[0, NIGHT], [4.9, NIGHT], [6.3, DAWN], [8.6, DAY], [16.0, DAY], [18.1, GOLDEN], [DUSK_H, DUSK], [20.9, NIGHT], [24, NIGHT]];
const SCALARS = ['sunIntensity', 'fogDensity', 'hemiIntensity', 'exposure', 'lamps', 'glow', 'env', 'wet', 'windows'];

const _grey = new THREE.Color();
const toGrey = (c, k, lift = 1) => {
  if (k <= 0) return;
  const l = (c.r * 0.3 + c.g * 0.55 + c.b * 0.15) * lift;
  _grey.setRGB(l, l * 1.02, l * 1.08);
  c.lerp(_grey, k);
};
const smooth = (t) => t * t * (3 - 2 * t);

// minutes: 0..1440 since midnight; weights: { clear, overcast, rain, fog }; wetness 0..1
export function update(minutes, weights = { clear: 1 }, wetness = 0) {
  const h = ((minutes / 60) % 24 + 24) % 24;
  let i = 0;
  while (i < FRAMES.length - 2 && h >= FRAMES[i + 1][0]) i++;
  const [h0, a] = FRAMES[i], [h1, b] = FRAMES[i + 1];
  const t = a === b ? 0 : smooth(Math.min(1, Math.max(0, (h - h0) / (h1 - h0))));
  LOOK.hour = h;
  LOOK.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  for (const k of COLOR_KEYS) LOOK[k].copy(a.colors[k]).lerp(b.colors[k], t);
  for (const k of SCALARS) LOOK[k] = a[k] + (b[k] - a[k]) * t;

  // weather over the hour: overcast greys and dims, rain more so (and wets), fog thickens
  const o = weights.overcast ?? 0, r = weights.rain ?? 0, f = weights.fog ?? 0;
  const grey = Math.min(1, o * 0.6 + r * 0.75 + f * 0.5);
  if (grey > 0) {
    for (const k of ['skyZenith', 'skyMid', 'skyHorizon', 'fogColor', 'hemiSky']) toGrey(LOOK[k], grey, k === 'fogColor' ? 1 + f * 0.25 : 1);
    LOOK.skyGlow.multiplyScalar(1 - 0.7 * Math.min(1, o + r) - 0.4 * f);
    toGrey(LOOK.sunColor, grey * 0.5);
  }
  if (r > 0) { LOOK.skyZenith.multiplyScalar(1 - 0.3 * r); LOOK.skyMid.multiplyScalar(1 - 0.25 * r); }
  LOOK.sunIntensity *= 1 - 0.62 * o - 0.8 * r - 0.5 * f;
  LOOK.hemiIntensity *= 1 - 0.12 * o - 0.2 * r + 0.05 * f;
  LOOK.fogDensity *= 1 + 0.45 * o + 0.9 * r + 2.4 * f;
  LOOK.lamps *= 1 + 0.25 * (o + r + f) * (1 - LOOK.lamps);       // grey days: lamps come on earlier
  LOOK.glow *= 1 + 0.35 * (r + f);                                  // halos bloom in wet / foggy air
  LOOK.windows *= 1 + 0.3 * (o + r + f) * (1 - LOOK.windows);      // and lit windows read stronger on grey days
  // wet ground: the time-of-day dampness plus what the rain left behind
  const wet = Math.min(1, Math.max(0, wetness));
  LOOK.wet = Math.min(1.3, LOOK.wet + wet * 0.35);
  LOOK.env *= 1 - 0.3 * Math.min(1, o + r) - 0.15 * f;              // a grey sky reflects less
  LOOK.wetCover = wet;
  LOOK.rain = Math.min(1, r);
  let best = 'clear';
  for (const k of ['overcast', 'rain', 'fog']) if ((weights[k] ?? 0) > (weights[best] ?? 0)) best = k;
  LOOK.weather = best;
  return LOOK;
}

// ---- renderer side ----------------------------------------------------------------
// targets: { scene, world, fx, lm, rain }
export function bind(targets) {
  const { scene } = targets;
  const bound = [];
  const extra = [];
  const lit = new Map();      // emissive world materials (windows, signs, lamp heads) -> their dusk intensity
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.isMeshStandardMaterial && m.emissiveIntensity > 0 && (m.emissiveMap || m.emissive.getHex() !== 0)) lit.set(m, m.emissiveIntensity);
      if (!m.uniforms) continue;
      for (const [name, u] of Object.entries(m.uniforms)) {
        const v = u.value;
        if (!v || typeof v !== 'object') continue;
        if (v === MOOD.sunDir) { u.value = LOOK.sunDir; bound.push(name); continue; }
        if (name === 'uSunCol' && v.isColor) { extra.push({ u, k: v.r / MOOD.sunColor.r }); continue; }
        for (const k of COLOR_KEYS) {
          if (v === MOOD[k] || (v.isColor && v.equals(MOOD[k]))) { u.value = LOOK[k]; bound.push(name); break; }
        }
      }
    }
  });
  return { ...targets, bound, extra, lit };
}

export function apply(b) {
  const { scene, world, fx, lm } = b;
  world.sun.color.copy(LOOK.sunColor);
  world.sun.intensity = LOOK.sunIntensity;
  world.hemi.color.copy(LOOK.hemiSky);
  world.hemi.groundColor.copy(LOOK.hemiGround);
  world.hemi.intensity = LOOK.hemiIntensity;
  scene.fog.color.copy(LOOK.fogColor);
  scene.fog.density = LOOK.fogDensity;
  scene.environmentIntensity = 0.9 * LOOK.env;
  lm.uniforms.uLmStrength.value = 3.4 * LOOK.lamps;
  fx.setLook(LOOK.glow, LOOK.fogDensity, LOOK.wet, LOOK.wetCover);
  for (const [m, base] of b.lit) m.emissiveIntensity = base * LOOK.windows;
  // water sun glint follows the sun's colour and strength (dusk: its old value)
  const ratio = LOOK.sunIntensity / MOOD.sunIntensity;
  for (const e of b.extra) e.u.value.copy(LOOK.sunColor).multiplyScalar(e.k * ratio);
  return LOOK.exposure;
}
