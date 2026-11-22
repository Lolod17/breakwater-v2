// Shared constants: palette, city dimensions, lighting mood.
import * as THREE from '../vendor/three.min.js';

export const CITY = {
  name: 'BREAKWATER',
  district: 'DOWNTOWN',
  streets: [-200, -120, -40, 40, 120, 200], // street centrelines (x and z)
  roadHalf: 6,        // carriageway half width (two lanes each way)
  paveWidth: 4,       // pavement between kerb and building line
  kerbH: 0.15,
  quayZ: 226,         // harbour edge south of the waterfront street
  waterY: -1.6,
  // PASS 17c: z1 reaches the quay railing's face (rail collider at quayZ - 0.4), so the promenade has no
  // invisible stop 1 m short of the drawn rail. The x/z0 edges sit behind the road-closure barriers
  // (world/roadEnds.js) at every street that leaves the district.
  bounds: { x0: -212, x1: 212, z0: -212, z1: 225.6 },
};

export const MOOD = {
  sunDir: new THREE.Vector3(-0.62, 0.16, 0.77).normalize(), // low sun over the harbour, south-west
  sunColor: new THREE.Color('#ffa36b'),
  sunIntensity: 2.4,
  skyZenith: new THREE.Color('#121a35'),
  skyMid: new THREE.Color('#3a3d68'),
  skyHorizon: new THREE.Color('#9a6a7c'),
  skyGlow: new THREE.Color('#ff9a5c'),
  fogColor: new THREE.Color('#4b4560'),
  fogDensity: 0.0029,
  hemiSky: new THREE.Color('#7d86b8'),
  hemiGround: new THREE.Color('#3a2a2c'),
  hemiIntensity: 1.05,
  water: new THREE.Color('#0b3238'),
  waterDeep: new THREE.Color('#041a1e'),
  lamp: new THREE.Color('#ffb25e'),
  exposure: 1.3,
};

export const NEON = ['#ff5f57', '#ff6f61', '#ff4f7a', '#3fe0d0', '#ffb347', '#ff7a59', '#b47bff'];
