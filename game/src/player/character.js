// The protagonist (and, with another palette, the police officer), built per bone
// segment as merged vertex-coloured meshes: pelvis, torso with open jacket and
// collar, head with ears, brows and hair (or a peaked cap), two-segment arms with
// hands, legs with trouser hems and shoes. The gait is driven by two-bone IK: during stance each ankle target
// moves backward at exactly ground speed, so feet stay planted (no sliding). Standing still,
// the hips shift weight side to side over the planted feet while the chest breathes.
import * as THREE from '../../vendor/three.min.js';
import { GeoBuilder } from '../world/geobuilder.js';

const THIGH = 0.46, SHIN = 0.45, ANKLE = 0.075;
const UPPER = 0.29, FORE = 0.26;
export const HIP_Y = 0.95;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Gait timing for a ground speed v: duty factor s (stance fraction), half stride h, cycle T.
export function gaitParams(v) {
  const s = 0.62 - 0.36 * smooth(1.0, 5.0, v);
  const h = lerp(0.24, 0.42, smooth(0.5, 6.5, v));
  const vRef = Math.max(v, 0.8);
  const T = (2 * lerp(0.24, 0.42, smooth(0.5, 6.5, vRef))) / (vRef * (0.62 - 0.36 * smooth(1.0, 5.0, vRef)));
  // below vRef the cycle time is held and the stride shrinks so stance speed still equals v
  return { s, h: v >= 0.8 ? h : (v * s * T) / 2, T };
}

// Palettes: jacket / pants / shoes split, plus skin and hair.
export const PALETTES = {
  courier: { jacket: '#7a5a3e', lining: '#3a2a20', accent: '#ff6f61', shirt: '#d8d2c6', pants: '#28324a', belt: '#141416',
    skin: '#b07a5c', hair: '#16110e', shoe: '#d9d4ca', sole: '#2a2624', cap: null },
  police: { jacket: '#1b2c44', lining: '#101a29', accent: '#c6a761', shirt: '#24364f', pants: '#14171c', belt: '#0b0b0c',
    skin: '#9c6a52', hair: '#1c1612', shoe: '#0f0f10', sole: '#050505', cap: '#141b26', badge: true },
};

// Each bone segment is one merged, vertex-coloured mesh (13 meshes per body).
function seg(parts, lm, rough = 0.68) {
  const b = new GeoBuilder();
  for (const [geo, m, hex] of parts) b.addGeometry(geo, m, { color: new THREE.Color(hex) });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
  const mesh = new THREE.Mesh(b.build(), lm ? lm.patch(mat, { mode: 'wall', push: 0, fall: 0.12 }) : mat);
  mesh.castShadow = true;
  return mesh;
}
const T = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const caps = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 10);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const sph = (seg = 14, rings = 10) => new THREE.SphereGeometry(1, seg, rings);
const cylG = (rt, rb, seg = 10) => new THREE.CylinderGeometry(rt, rb, 1, seg, 1);

export function buildCharacter(lm, palette = PALETTES.courier) {
  const P = palette;
  const root = new THREE.Group();
  const body = new THREE.Group(); // receives roll lean
  root.add(body);
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP_Y;
  body.add(pelvis);
  pelvis.add(seg([
    [boxG, T(0, 0.02, 0, 0.31, 0.19, 0.2), P.pants],
    [boxG, T(0, 0.115, 0, 0.33, 0.045, 0.215), P.belt],
    [boxG, T(0, 0.115, 0.108, 0.06, 0.035, 0.01), P.accent],          // buckle
    [boxG, T(0.13, -0.02, -0.1, 0.09, 0.1, 0.012), P.pants],           // back pockets
    [boxG, T(-0.13, -0.02, -0.1, 0.09, 0.1, 0.012), P.pants],
  ], lm, 0.8));

  const spine = new THREE.Group();
  spine.position.y = 0.1;
  pelvis.add(spine);
  const torso = [
    [caps(0.16, 0.28), T(0, 0.3, 0, 1.3, 1, 0.8), P.jacket],
    [boxG, T(0, 0.36, 0.122, 0.12, 0.34, 0.02), P.shirt],                 // shirt in the open front
    [boxG, T(0.07, 0.36, 0.124, 0.012, 0.36, 0.022), P.lining],           // jacket edges / zip line
    [boxG, T(-0.07, 0.36, 0.124, 0.012, 0.36, 0.022), P.lining],
    [cylG(0.205, 0.2, 14), T(0, 0.12, 0, 1.04, 0.06, 0.68), P.lining],   // hem band
    [boxG, T(0.12, 0.2, 0.118, 0.09, 0.08, 0.02, 0, 0.25, 0), P.lining],  // pockets
    [boxG, T(-0.12, 0.2, 0.118, 0.09, 0.08, 0.02, 0, -0.25, 0), P.lining],
    // collar: a raised band and two lapel points
    [cylG(0.1, 0.13, 12), T(0, 0.6, -0.01, 1, 0.09, 1), P.jacket],
    [boxG, T(0.07, 0.56, 0.1, 0.07, 0.09, 0.02, 0.3, 0, 0.5), P.jacket],
    [boxG, T(-0.07, 0.56, 0.1, 0.07, 0.09, 0.02, 0.3, 0, -0.5), P.jacket],
  ];
  if (P.badge ?? P.cap) { // police: badge, radio, epaulettes (PASS 11: a civilian cap no longer implies a badge)
    torso.push([boxG, T(0.095, 0.44, 0.128, 0.05, 0.06, 0.012), P.accent], [boxG, T(-0.1, 0.46, 0.126, 0.05, 0.08, 0.03), '#0b0b0c'],
      [boxG, T(0.2, 0.55, 0, 0.09, 0.02, 0.1), P.lining], [boxG, T(-0.2, 0.55, 0, 0.09, 0.02, 0.1), P.lining]);
  } else {
    torso.push([boxG, T(0.0, 0.44, -0.125, 0.22, 0.06, 0.012), P.accent]); // courier stripe on the back
  }
  spine.add(seg(torso, lm, 0.62));

  const neck = new THREE.Group();
  neck.position.y = 0.62;
  spine.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.1;
  neck.add(head);
  const headParts = [
    [cylG(0.05, 0.056), T(0, -0.06, 0, 1, 0.12, 1), P.skin],                       // neck
    [sph(), T(0, 0.1, 0.005, 0.098, 0.12, 0.11), P.skin],                           // cranium
    [sph(10, 8), T(0, 0.04, 0.03, 0.08, 0.07, 0.085), P.skin],                      // jaw / chin
    [boxG, T(0, 0.085, 0.113, 0.026, 0.045, 0.035, -0.2), P.skin],                  // nose
    [sph(8, 6), T(0.1, 0.09, -0.005, 0.018, 0.03, 0.022), P.skin],                  // ears
    [sph(8, 6), T(-0.1, 0.09, -0.005, 0.018, 0.03, 0.022), P.skin],
    [boxG, T(0.04, 0.12, 0.104, 0.022, 0.009, 0.01), '#101012'],                     // eyes
    [boxG, T(-0.04, 0.12, 0.104, 0.022, 0.009, 0.01), '#101012'],
    [boxG, T(0.04, 0.145, 0.104, 0.034, 0.007, 0.01, 0, 0, -0.1), P.hair],            // brows
    [boxG, T(-0.04, 0.145, 0.104, 0.034, 0.007, 0.01, 0, 0, 0.1), P.hair],
    [boxG, T(0, 0.045, 0.108, 0.04, 0.008, 0.01), '#6e4436'],                        // mouth
  ];
  if (P.cap) {
    headParts.push([cylG(0.118, 0.112, 14), T(0, 0.17, 0, 1, 0.07, 1.05), P.cap],
      [cylG(0.13, 0.118, 14), T(0, 0.215, 0.005, 1.0, 0.03, 1.08), P.cap],
      [boxG, T(0, 0.15, 0.12, 0.17, 0.012, 0.08, 0.25), '#07090c'],                // peak
      [boxG, T(0, 0.185, 0.118, 0.035, 0.03, 0.01), P.accent],                     // cap badge
      [sph(12, 6), T(0, 0.1, -0.03, 0.1, 0.07, 0.09), P.hair]);                    // short back hair
  } else {
    headParts.push([new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), T(0, 0.115, -0.005, 0.106, 0.125, 0.12, -0.18), P.hair],
      [boxG, T(0, 0.19, 0.075, 0.17, 0.05, 0.07, 0.5), P.hair],                    // fringe swept up
      [sph(10, 6), T(0, 0.08, -0.06, 0.1, 0.09, 0.07), P.hair]);                   // back of the head
  }
  head.add(seg(headParts, lm, 0.7));

  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.52, 0);
    spine.add(shoulder);
    shoulder.add(seg([
      [sph(10, 8), T(0, 0, 0, 0.075, 0.07, 0.08), P.jacket],                     // shoulder cap
      [caps(0.058, UPPER - 0.08), T(0, -UPPER / 2, 0), P.jacket],
    ], lm, 0.62));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER;
    shoulder.add(elbow);
    elbow.add(seg([
      [caps(0.051, FORE - 0.08), T(0, -FORE / 2, 0), P.jacket],
      [cylG(0.054, 0.054), T(0, -FORE + 0.035, 0, 1, 0.035, 1), P.lining],        // cuff
      [boxG, T(0, -FORE - 0.035, 0.005, 0.045, 0.085, 0.075), P.skin],            // palm
      [boxG, T(0, -FORE - 0.09, 0.012, 0.04, 0.04, 0.065, 0.3), P.skin],          // fingers, curled
      [boxG, T(-side * 0.025, -FORE - 0.03, 0.035, 0.02, 0.05, 0.022, 0.4), P.skin], // thumb
    ], lm, 0.62));
    arms.push({ side, shoulder, elbow });

    const hip = new THREE.Group();
    hip.position.set(side * 0.095, 0, 0);
    pelvis.add(hip);
    hip.add(seg([[caps(0.08, THIGH - 0.1), T(0, -THIGH / 2, 0), P.pants]], lm, 0.82));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    knee.add(seg([
      [caps(0.064, SHIN - 0.08), T(0, -SHIN / 2, 0), P.pants],
      [cylG(0.07, 0.074), T(0, -SHIN + 0.05, 0, 1, 0.05, 1), P.pants],            // trouser hem
    ], lm, 0.82));
    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);
    ankle.add(seg([
      [boxG, T(0, -ANKLE + 0.05, 0.035, 0.1, 0.08, 0.2), P.shoe],
      [sph(10, 6), T(0, -ANKLE + 0.04, 0.14, 0.05, 0.04, 0.06), P.shoe],          // rounded toe
      [boxG, T(0, -ANKLE + 0.012, 0.05, 0.108, 0.024, 0.28), P.sole],
      [boxG, T(0, -ANKLE + 0.072, 0.07, 0.06, 0.012, 0.1), P.cap ? P.sole : P.accent], // laces / tongue
    ], lm, 0.6));
    legs.push({ side, hip, knee, ankle });
  }

  // Two-bone IK in the sagittal plane: ankle target (z forward, y up) relative to the hip joint.
  function solveLeg(leg, tz, ty, toePitch) {
    const d = Math.min(THIGH + SHIN - 1e-3, Math.max(0.15, Math.hypot(tz, ty)));
    const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK)));
    const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
    const thigh = Math.atan2(tz, -ty) + Math.acos(Math.max(-1, Math.min(1, cosA)));
    leg.hip.rotation.x = -thigh;
    leg.knee.rotation.x = knee;
    leg.ankle.rotation.x = thigh - knee + toePitch;
  }

  const state = { lastFoot: [0, 0] };

  // phase in [0,1), v = ground speed (m/s), opts: lean, roll, air (0..1), t (seconds)
  function pose(phase, v, { lean = 0, roll = 0, air = 0, t = 0 } = {}) {
    const { s, h } = gaitParams(v);
    const run = smooth(2.0, 4.2, v);
    const moving = smooth(0.02, 0.5, v);
    const amp = lerp(0.016, -0.026, run) * moving;
    const bob = amp * Math.cos(4 * Math.PI * (phase - s / 2));
    const hipY = HIP_Y - 0.03 * run * moving + bob - air * 0.05;
    pelvis.position.y = hipY;
    // standing: slow weight shift from foot to foot; the hips slide sideways over the planted feet
    const sway = (1 - moving) * (1 - air) * 0.022 * Math.sin(t * 0.85);
    pelvis.position.x = sway;
    const lift = (0.09 + 0.2 * run) * moving;
    const zs = [];
    legs.forEach((leg, i) => {
      const p = (phase + i * 0.5) % 1;
      let z, y, pitch = 0;
      if (p < s) {
        const u = p / s;
        z = h * (1 - 2 * u); y = 0;
      } else {
        const u = (p - s) / (1 - s);
        const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
        z = -h + 2 * h * e;
        y = lift * Math.sin(Math.PI * u);
        pitch = (0.55 * run + 0.2) * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u) - 0.2 * u * u * moving;
      }
      if (air > 0) { z = lerp(z, i ? -0.12 : 0.18, air); y = lerp(y, i ? 0.3 : 0.18, air); }
      // idle stance: feet slightly apart front/back
      if (moving < 1) z = lerp(i ? -0.04 : 0.05, z, moving);
      zs.push(z);
      solveLeg(leg, z, -(hipY - ANKLE - y), pitch);
      // keep the foot under its own hip socket while the pelvis sways (hip abduction, ankle counter-roll)
      const rz = -Math.asin(Math.max(-0.5, Math.min(0.5, sway / Math.max(0.3, hipY - ANKLE - y))));
      leg.hip.rotation.z = rz;
      leg.ankle.rotation.z = -rz;
    });
    const hh = Math.max(h, 0.05);
    const breathe = Math.sin(t * 1.7) * 0.012 * (1 - moving);
    arms.forEach((arm, i) => {
      const opp = zs[1 - i] / hh;
      const swing = lerp(0.32, 0.85, run) * moving;
      arm.shoulder.rotation.x = -opp * swing - 0.05 * run;
      arm.shoulder.rotation.z = arm.side * (0.07 + 0.06 * run + breathe * 2);
      arm.elbow.rotation.x = -(0.18 + 1.15 * run * moving + Math.max(0, -opp) * 0.25 * moving);
    });
    spine.rotation.x = 0.03 + 0.15 * run * moving + lean + breathe;
    spine.rotation.y = -0.12 * run * Math.sin(2 * Math.PI * phase) * moving;
    pelvis.rotation.y = 0.07 * Math.sin(2 * Math.PI * phase) * moving;
    neck.rotation.x = -(0.15 * run * moving + lean) * 0.7;
    neck.rotation.y = -spine.rotation.y * 0.8;
    spine.rotation.z = -sway * 2.2;                 // shoulders stay over the feet
    neck.rotation.z = sway * 1.4;
    body.rotation.z = roll;
    return zs;
  }

  pose(0, 0);
  return { root, pose, parts: { pelvis, spine, head, arms, legs } };
}
