// The harbour: animated teal water, quay wall, timber jetty, container terminal
// with gantry cranes, the breakwater arm with its lighthouse and sweeping beam,
// and the far shore glittering across the bay.
import * as THREE from '../../vendor/three.min.js';
import { CITY, MOOD } from '../config.js';
import { GeoBuilder, instance, mat4 } from './geobuilder.js';

const K = CITY.kerbH;
const C = (h, k = 1) => new THREE.Color(h).multiplyScalar(k);

export function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: MOOD.sunDir },
      uSunCol: { value: MOOD.sunColor.clone().multiplyScalar(1.4) },
      uDeep: { value: MOOD.waterDeep },
      uShallow: { value: MOOD.water },
      uSkyZen: { value: MOOD.skyMid },
      uSkyHor: { value: MOOD.skyHorizon },
      uGlow: { value: MOOD.skyGlow },
      uFogCol: { value: MOOD.fogColor },
      uFogDensity: { value: MOOD.fogDensity * 0.55 },
      uQuayZ: { value: CITY.quayZ },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFogDensity, uQuayZ;
      uniform vec3 uSunDir, uSunCol, uDeep, uShallow, uSkyZen, uSkyHor, uGlow, uFogCol;
      varying vec3 vWorld;
      vec2 waves(vec2 p, float t) {
        vec2 g = vec2(0.0);
        float a = 0.11, f = 0.16;
        vec2 d = vec2(0.8, 0.6);
        for (int i = 0; i < 9; i++) {
          float ph = dot(d, p) * f + t * (0.6 + f * 2.2);
          g += d * f * a * cos(ph);
          d = mat2(0.7374, -0.6755, 0.6755, 0.7374) * d;
          f *= 1.47; a *= 0.72;
        }
        return g;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec2 g = waves(vWorld.xz, uTime);
        float calm = clamp(dist / 900.0, 0.0, 1.0);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y) * vec3(1.0 - calm * 0.7, 1.0, 1.0 - calm * 0.7));
        float ndv = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        float sunAz = pow(max(dot(normalize(r.xz + 1e-4), normalize(uSunDir.xz)), 0.0), 4.0);
        vec3 sky = mix(uSkyHor, uSkyZen, pow(clamp(r.y, 0.0, 1.0), 0.45));
        sky += uGlow * sunAz * exp(-r.y * 6.0) * 0.9;
        float sd = max(dot(r, uSunDir), 0.0);
        vec3 sun = uSunCol * (pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 1.6);
        vec3 body = mix(uShallow, uDeep, clamp(ndv * 1.2, 0.0, 1.0));
        // reflections of the quay: trace the reflected ray back to the quay plane and
        // light it where it passes a lamp head (every 24 m, 7 m up) or the lit city above
        vec3 city = vec3(0.0);
        vec3 rr = reflect(-v, n);
        if (rr.z < -0.02) {
          float t = (uQuayZ - 1.0 - vWorld.z) / rr.z;
          vec3 hp = vWorld + rr * t;
          float lx = mod(hp.x + 320.0, 24.0) - 12.0;
          float lamp = exp(-lx * lx * 1.4) * exp(-pow(hp.y - 7.2, 2.0) * 0.35);
          float town = smoothstep(2.0, 8.0, hp.y) * (1.0 - smoothstep(25.0, 70.0, hp.y)) * step(abs(hp.x), 330.0);
          float fade = exp(-t / 260.0);
          city = (vec3(1.0, 0.62, 0.3) * lamp * 5.0 + vec3(0.9, 0.55, 0.35) * town * 0.22) * fade;
        }
        vec3 col = mix(body, sky, fres) + sun + max(city, 0.0);
        float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        col = mix(col, uFogCol, fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function buildHarbour(layout, rng, B, mats, colliders, lm) {
  const group = new THREE.Group();
  group.name = 'harbour';
  const qz = CITY.quayZ, wy = CITY.waterY;

  // water: one big plane from the quay to the horizon
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), mats.water);
  water.position.set(0, wy, qz + 4500 - 1);
  group.add(water);

  // quay wall with stone coping
  const stone = C('#6f6c66');
  B.kerb.boxMinMax(-1200, -5, qz - 0.5, layout.pier.x0, K + 0.1, qz, { color: stone, worldUV: 1.5 });
  B.kerb.boxMinMax(layout.pier.x1, -5, qz - 0.5, 236, K + 0.1, qz, { color: stone, worldUV: 1.5 });
  B.kerb.boxMinMax(layout.pier.x0, -5, qz - 0.5, layout.pier.x1, K - 0.26, qz, { color: stone, worldUV: 1.5 });
  // tide-stained band at the waterline
  B.trim.boxMinMax(-1200, wy - 0.3, qz, 236, wy + 0.7, qz + 0.04, { color: C('#1d2522') });

  // timber jetty: planks over pilings
  const pier = layout.pier;
  for (let z = pier.z0; z < pier.z1; z += 0.32) {
    B.trim.boxMinMax(pier.x0, K - 0.08, z, pier.x1, K, z + 0.29, { color: C(rng.pick(['#5a4334', '#4f3a2d', '#634a38', '#574032'])) });
  }
  B.trim.boxMinMax(pier.x0, K - 0.45, pier.z0, pier.x0 + 0.25, K - 0.08, pier.z1, { color: C('#3a2b22') });
  B.trim.boxMinMax(pier.x1 - 0.25, K - 0.45, pier.z0, pier.x1, K - 0.08, pier.z1, { color: C('#3a2b22') });
  const piles = [];
  for (let z = pier.z0 + 2; z <= pier.z1; z += 4) for (const x of [pier.x0 + 0.3, (pier.x0 + pier.x1) / 2, pier.x1 - 0.3]) piles.push({ x, y: 0, z });
  const pileB = new GeoBuilder();
  pileB.addGeometry(new THREE.CylinderGeometry(0.2, 0.22, 6, 8), mat4(0, K - 0.3 - 3, 0), { color: C('#2e241d') });
  group.add(instance(pileB.build(), mats.prop, piles));

  // container terminal east of downtown
  const T = { x0: 236, x1: 820, z0: 206, z1: 340 };
  B.kerb.boxMinMax(T.x0, -5, T.z0, T.x1, K, T.z1, { color: C('#5a5853'), worldUV: 4 });
  const boxes = [];
  const palette = ['#9c3b2e', '#2f5d7a', '#c8a23a', '#3f6b4a', '#7a7d80', '#b5552d', '#334a6b', '#8a2f3f'];
  for (let bx = 0; bx < 6; bx++) {
    for (let row = 0; row < 7; row++) {
      for (let k = 0; k < 9; k++) {
        const h = rng.weighted([[0, 0.12], [1, 0.25], [2, 0.3], [3, 0.23], [4, 0.1]]);
        for (let lvl = 0; lvl < h; lvl++) {
          boxes.push({ x: 300 + bx * 78 + k * 6.6, y: K + 1.3 + lvl * 2.6, z: 232 + row * 10.5 + (row > 3 ? 8 : 0), c: rng.pick(palette) });
        }
      }
    }
  }
  // ---- PASS 6: ships, yard gantries, a water tower (own stream: the yard above is unchanged)
  const hr = rng.fork('harbour-dressing');
  const dk = C('#2a2c30');
  // container ship moored along the terminal's water edge, bow to the east
  const ship = { x0: 360, x1: 590, z: T.z1 + 19, w: 32 };
  const hullC = C('#2a2d33'), boot = C('#7c2a22'), white = C('#e4e2dc');
  const hz0 = ship.z - ship.w / 2, hz1 = ship.z + ship.w / 2;
  B.trim.boxMinMax(ship.x0 + 14, wy - 3, hz0, ship.x1 - 22, wy + 9, hz1, { color: hullC });
  B.trim.boxMinMax(ship.x0 + 14, wy - 3, hz0 - 0.05, ship.x1 - 22, wy + 0.8, hz1 + 0.05, { color: boot });
  // bow and stern as tapered wedges
  const wedge = (xa, xb, tipW) => {
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getX(i) > 0) p.setZ(i, p.getZ(i) * tipW);
    g.computeVertexNormals();
    const len = Math.abs(xb - xa);
    B.trim.addGeometry(g, new THREE.Matrix4().compose(new THREE.Vector3((xa + xb) / 2, wy + 3, ship.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), xb > xa ? 0 : Math.PI), new THREE.Vector3(len, 12, ship.w)), { color: hullC });
  };
  wedge(ship.x1 - 22, ship.x1, 0.12);
  wedge(ship.x0 + 14, ship.x0, 0.7);
  // accommodation block aft with lit window bands, bridge wings, funnel, mast
  const ax = ship.x0 + 26;
  B.trim.boxMinMax(ax - 9, wy + 9, ship.z - 12, ax + 9, wy + 27, ship.z + 12, { color: white });
  B.trim.boxMinMax(ax - 10, wy + 27, ship.z - 16, ax + 10, wy + 30, ship.z + 16, { color: white });
  for (let y = wy + 11.5; y < wy + 27; y += 2.8) {
    B.glow.boxMinMax(ax + 9.02, y, ship.z - 10.5, ax + 9.08, y + 0.9, ship.z + 10.5, { color: C('#ffd9a0', 1.6) });
    B.glow.boxMinMax(ax - 8, y, ship.z + 12.02, ax + 8, y + 0.9, ship.z + 12.08, { color: C('#ffd9a0', 1.3) });
  }
  B.glow.boxMinMax(ax + 10.02, wy + 27.8, ship.z - 14, ax + 10.08, wy + 29.2, ship.z + 14, { color: C('#bfe0ff', 1.4) });
  B.trim.boxMinMax(ax - 7, wy + 30, ship.z - 3, ax - 1, wy + 38, ship.z + 3, { color: C('#b23a2c') });
  B.trim.boxMinMax(ax - 7.1, wy + 37, ship.z - 3.1, ax - 0.9, wy + 38.2, ship.z + 3.1, { color: C('#141416') });
  B.trim.addGeometry(new THREE.CylinderGeometry(0.25, 0.3, 14, 6), mat4(ax + 3, wy + 37, ship.z), { color: dk });
  lm.glow(ax + 3, wy + 44.2, ship.z, [10, 0.6, 0.35], 3, { blink: 0.5, phase: 0.2, pull: 1 });
  lm.glow(ax + 10.5, wy + 30, ship.z - 16, [0.3, 6, 1.4], 1.6, { pull: 0.6 });
  lm.glow(ax + 10.5, wy + 30, ship.z + 16, [7, 0.3, 0.2], 1.6, { pull: 0.6 });
  lm.glow(ship.x1 - 4, wy + 14, ship.z, [4, 3.6, 2.8], 2.4, { pull: 0.8 });
  // deck cargo: container stacks between the hatch rows
  const shipBoxes = [];
  for (let x = ax + 14; x < ship.x1 - 28; x += 6.4) {
    for (let row = -5; row <= 5; row++) {
      const h = 2 + hr.int(0, 3);
      for (let lvl = 0; lvl < h; lvl++) shipBoxes.push({ x, y: wy + 9 + 1.3 + lvl * 2.6, z: ship.z + row * 2.5, c: hr.pick(palette) });
    }
  }
  // gantry spotlights over the ship
  for (let x = ax + 30; x < ship.x1 - 30; x += 46) lm.glow(x, wy + 9.4, hz0 - 0.5, [3, 2.6, 2], 2.2, { pull: 0.8 });

  // ships out in the bay, beyond where scene fog would erase them: pre-fogged
  // silhouettes (like the far shore) with deck and window lights as glow sprites
  const bay = new GeoBuilder();
  const tk = { x0: 120, x1: 360, z: 820 };                  // tanker riding at anchor
  bay.boxMinMax(tk.x0, wy - 2, tk.z - 18, tk.x1, wy + 8, tk.z + 18, { color: C('#000000') });
  bay.boxMinMax(tk.x1 - 26, wy + 8, tk.z - 9, tk.x1 - 6, wy + 26, tk.z + 9, { color: C('#000000') });
  bay.boxMinMax(tk.x1 - 20, wy + 26, tk.z - 2, tk.x1 - 15, wy + 34, tk.z + 2, { color: C('#000000') });
  for (let x = tk.x0 + 12; x < tk.x1 - 30; x += 24) lm.glow(x, wy + 10, tk.z - 18, [8, 6, 3.4], 4, { pull: 3 });
  for (let y = wy + 12; y < wy + 26; y += 3.5) lm.glow(tk.x1 - 16, y, tk.z - 9.5, [7, 5.4, 3.4], 3.5, { pull: 3, stretch: 3 });
  lm.glow(tk.x0 + 2, wy + 16, tk.z, [10, 0.6, 0.35], 4.5, { blink: 0.4, phase: 0.6, pull: 3 });
  lm.glow(tk.x1 - 17, wy + 35, tk.z, [5, 4.5, 3.5], 4.5, { pull: 3 });
  const fy = { x: -10, z: 610 };                            // a lit ferry crossing toward the far shore
  bay.boxMinMax(fy.x - 40, wy - 1.5, fy.z - 9, fy.x + 40, wy + 5, fy.z + 9, { color: C('#000000') });
  bay.boxMinMax(fy.x - 30, wy + 5, fy.z - 7, fy.x + 26, wy + 13, fy.z + 7, { color: C('#000000') });
  bay.boxMinMax(fy.x - 14, wy + 13, fy.z - 5, fy.x + 10, wy + 17, fy.z + 5, { color: C('#000000') });
  for (const [y, k] of [[wy + 7.2, 1], [wy + 10.6, 0.8], [wy + 14.6, 0.6]]) {
    for (let x = fy.x - 28; x < fy.x + 25; x += 6.5) lm.glow(x, y, fy.z - 7.5, [7 * k, 5.4 * k, 3.3 * k], 3.2, { pull: 2, stretch: 1.8 });
  }
  lm.glow(fy.x + 41, wy + 6, fy.z, [0.3, 7, 1.6], 3, { pull: 2 });
  lm.glow(fy.x - 41, wy + 6, fy.z, [7, 7, 6], 3, { pull: 2 });
  const bayMesh = new THREE.Mesh(bay.build(), new THREE.MeshBasicMaterial({ color: MOOD.fogColor.clone().multiplyScalar(0.55), fog: false }));
  bayMesh.name = 'bay-ships';
  group.add(bayMesh);

  // rubber-tyred gantries straddling the container rows
  for (const gx of [338, 494, 650]) {
    for (const gz of [[226, 266], [266, 306]]) {
      const [za, zb] = gz;
      for (const ox of [-3.5, 3.5]) {
        B.trim.box(gx + ox, K + 9, za, 0.7, 18, 0.9, { color: C('#d8a52b') });
        B.trim.box(gx + ox, K + 9, zb, 0.7, 18, 0.9, { color: C('#d8a52b') });
        B.trim.box(gx + ox, K + 0.6, (za + zb) / 2, 0.8, 1.2, zb - za + 1, { color: dk });
      }
      B.trim.box(gx, K + 18.3, za, 8, 1.1, 1.2, { color: C('#d8a52b') });
      B.trim.box(gx, K + 18.3, zb, 8, 1.1, 1.2, { color: C('#d8a52b') });
      for (const ox of [-3.5, 3.5]) B.trim.box(gx + ox, K + 18.9, (za + zb) / 2, 0.9, 0.9, zb - za, { color: C('#d8a52b') });
      B.trim.box(gx, K + 17.4, (za + zb) / 2 + 3, 3.2, 1.6, 3.2, { color: dk });
      lm.glow(gx, K + 18, (za + zb) / 2, [3.2, 2.8, 2.1], 3, { pull: 1 });
    }
  }

  // municipal water tower on the terminal's landward corner
  const wt = { x: 790, z: 222 };
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, lx = wt.x + Math.cos(a) * 6, lz = wt.z + Math.sin(a) * 6;
    B.trim.addGeometry(new THREE.CylinderGeometry(0.35, 0.45, 32, 6), mat4(lx, K + 16, lz), { color: C('#8c9096') });
  }
  for (const y of [10, 21]) B.trim.addGeometry(new THREE.TorusGeometry(6, 0.18, 4, 12).rotateX(Math.PI / 2), mat4(wt.x, K + y, wt.z), { color: C('#8c9096') });
  B.trim.addGeometry(new THREE.CylinderGeometry(1.1, 1.1, 32, 8), mat4(wt.x, K + 16, wt.z), { color: C('#7c8086') });
  B.trim.addGeometry(new THREE.SphereGeometry(9, 16, 10), mat4(wt.x, K + 38, wt.z, 0, 1, 0.78, 1), { color: C('#cfd3d6') });
  B.trim.addGeometry(new THREE.CylinderGeometry(9.15, 9.15, 1.4, 16, 1, true), mat4(wt.x, K + 38, wt.z), { color: C('#2f5d7a') });
  lm.glow(wt.x, K + 45.6, wt.z, [10, 0.55, 0.32], 3, { blink: 0.5, phase: 0.75, pull: 1 });
  colliders.add(wt.x - 7, 0, wt.z - 7, wt.x + 7, 50, wt.z + 7, 'tower');

  const cB = new GeoBuilder();
  cB.box(0, 0, 0, 6.1, 2.59, 2.44, { color: C('#ffffff') });
  boxes.push(...shipBoxes);
  const containers = instance(cB.build(), mats.prop, boxes, { castShadow: false });
  boxes.forEach((b, i) => containers.setColorAt(i, C(b.c)));
  containers.instanceColor.needsUpdate = true;
  group.add(containers);

  // gantry cranes along the terminal edge
  const steel = C('#b9442f'), dark = C('#2a2c30');
  for (const cx of [330, 430, 530, 640]) {
    const z = T.z1 - 6;
    for (const [ox, oz] of [[-9, -8], [9, -8], [-9, 8], [9, 8]]) B.trim.box(cx + ox, K + 21, z + oz, 1.4, 42, 1.4, { color: steel });
    B.trim.box(cx, K + 42, z, 20, 2.5, 18, { color: steel });
    const raised = cx === 430 || cx === 640;
    if (raised) {
      // boom raised for a passing ship: hinged at the waterside legs, pointing up and out
      const len = 62, ang = 1.05;
      B.trim.addGeometry(new THREE.BoxGeometry(4, 2.2, len), new THREE.Matrix4().compose(
        new THREE.Vector3(cx, K + 44 + Math.sin(ang) * len / 2, z + 9 + Math.cos(ang) * len / 2),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang), new THREE.Vector3(1, 1, 1)), { color: steel });
      lm.glow(cx, K + 44 + Math.sin(ang) * len, z + 9 + Math.cos(ang) * len, [10, 0.6, 0.35], 3.2, { blink: 0.55, phase: cx * 0.007, pull: 1 });
    } else {
      B.trim.box(cx, K + 46, z + 18, 4, 2.2, 80, { color: steel });          // boom over the water (and the ship)
      B.trim.box(cx, K + 44.4, z + 34, 5, 2.4, 6, { color: dark });          // trolley
      for (let dz = -14; dz <= 54; dz += 17) lm.glow(cx, K + 44.7, z + dz, [3.4, 2.9, 2.2], 2.4, { pull: 1 });
      // cable stays from the apex to the boom
      for (const dz of [24, 46]) {
        const ax2 = cx, ay = K + 57, az = z - 4, by = K + 47, bz = z + dz;
        const len = Math.hypot(by - ay, bz - az);
        B.trim.addGeometry(new THREE.BoxGeometry(0.15, 0.15, len), new THREE.Matrix4().compose(new THREE.Vector3(ax2, (ay + by) / 2, (az + bz) / 2),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, by - ay, bz - az).normalize()), new THREE.Vector3(1, 1, 1)), { color: dark });
      }
    }
    B.trim.box(cx, K + 46, z - 22, 4, 2.2, 22, { color: steel });            // back-reach
    for (const ox of [-9, 9]) for (const oz of [-8, 8]) B.trim.box(cx + ox, K + 21, z, 0.5, 0.5, 16, { color: steel }); // leg ties
    for (const ox of [-9, 9]) B.trim.addGeometry(new THREE.BoxGeometry(0.5, 0.5, Math.hypot(16, 34)), new THREE.Matrix4().compose(new THREE.Vector3(cx + ox, K + 21, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(34, 16)), new THREE.Vector3(1, 1, 1)), { color: steel });
    B.trim.box(cx, K + 52, z - 4, 2, 12, 2, { color: steel });               // apex
    B.trim.box(cx, K + 44.5, z - 10, 8, 4, 8, { color: dark });              // machinery house
    B.glow.box(cx, K + 58.3, z - 4, 0.6, 0.6, 0.6, { color: C('#ff2a1f', 2) });
    B.glow.box(cx, K + 47.4, z + 58, 0.5, 0.5, 0.5, { color: C('#ff2a1f', 2) });
    lm.glow(cx, K + 58.3, z - 4, [10, 0.6, 0.35], 4, { blink: 0.55, phase: cx * 0.013, pull: 1 });
    lm.glow(cx, K + 47.4, z + 58, [10, 0.6, 0.35], 3.5, { blink: 0.55, phase: cx * 0.013 + 0.5, pull: 1 });
    for (const ox of [-9, 9]) {
      B.glow.box(cx + ox, K + 40.5, z + 9, 1.2, 0.3, 0.6, { color: C('#fff0d0', 5) });
      lm.glow(cx + ox, K + 40.3, z + 9, [3.2, 2.9, 2.3], 5, { pull: 1.5 });
      lm.shaft(cx + ox, K + 40.2, z + 9, 0, -1, 0.12, 40, 9, [0.012, 0.011, 0.009]);
    }
  }
  // floodlight masts on the terminal
  for (let x = 300; x < 800; x += 70) {
    B.trim.box(x, K + 14, 270, 0.6, 28, 0.6, { color: dark });
    B.glow.box(x, K + 28.4, 270, 3, 0.6, 1.2, { color: C('#ffe2b0', 7) });
    lm.glow(x, K + 28.2, 270, [3.4, 2.8, 1.9], 7, { pull: 2, stretch: 1.6 });
    lm.shaft(x, K + 28, 270, 0, -1, -0.15, 28, 13, [0.014, 0.012, 0.008]);
  }
  colliders.add(236, 0, 226, 820, 3, 340, 'terminal');

  // breakwater arm with a lighthouse at its tip
  const rocks = [];
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 1 / 140) {
    const x = THREE.MathUtils.lerp(820, -140, t);
    const z = 470 - Math.sin(t * Math.PI * 0.9) * 40 + t * 10;
    pts.push([x, z]);
    for (let k = 0; k < 3; k++) {
      rocks.push({ x: x + rng.float(-3, 3), y: wy + rng.float(-0.4, 1.0), z: z + (k - 1) * 3.4 + rng.float(-1, 1), rot: rng.float(0, 6), s: rng.float(1.4, 2.6), sy: rng.float(0.9, 1.8) });
    }
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockB = new GeoBuilder();
  rockB.addGeometry(rockGeo, new THREE.Matrix4(), { color: C('#4e4c48') });
  group.add(instance(rockB.build(), mats.prop, rocks, { castShadow: false }));
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    B.kerb.addGeometry(new THREE.BoxGeometry(len + 0.3, 1.2, 4), mat4((x0 + x1) / 2, wy + 1.9, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0)), { color: C('#77746d') });
  }
  const [lx, lz] = pts[pts.length - 1];
  const ly = wy + 2.5;
  B.kerb.addGeometry(new THREE.CylinderGeometry(5, 5.5, 2, 20), mat4(lx, ly - 0.2, lz), { color: C('#77746d') });
  for (let i = 0; i < 6; i++) {
    const y0 = ly + i * 2.6;
    B.trim.addGeometry(new THREE.CylinderGeometry(1.7 - (i + 1) * 0.08, 1.7 - i * 0.08, 2.6, 16), mat4(lx, y0 + 1.3, lz), { color: C(i % 2 ? '#a8302a' : '#e8e2d6') });
  }
  const top = ly + 15.6;
  B.trim.addGeometry(new THREE.CylinderGeometry(1.7, 1.7, 0.25, 18), mat4(lx, top + 0.1, lz), { color: dark });
  B.glow.addGeometry(new THREE.CylinderGeometry(0.85, 0.85, 1.6, 12), mat4(lx, top + 1.05, lz), { color: C('#ffe6b0', 9) });
  lm.glow(lx, top + 1.05, lz, [6, 5, 3.4], 9, { pull: 2 });
  B.trim.addGeometry(new THREE.ConeGeometry(1.15, 1.2, 12), mat4(lx, top + 2.45, lz), { color: dark });
  // sweeping beam: two additive cones that fade with distance
  const beamGeo = new THREE.ConeGeometry(7, 150, 24, 1, true).translate(0, -75, 0).rotateZ(Math.PI / 2);
  const cols = [];
  const bp = beamGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const k = Math.max(0, 1 - bp.getX(i) / 150); cols.push(k * 0.5, k * 0.42, k * 0.3); }
  beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const beam = new THREE.Group();
  beam.position.set(lx, top + 1.05, lz);
  const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  group.add(beam);

  // far shore: hill silhouette and town lights, pre-fogged so they read through the haze
  const shore = farShore(rng);
  group.add(shore);

  return {
    group,
    update(t) {
      mats.water.uniforms.uTime.value = t;
      beam.rotation.y = t * 0.55;
    },
  };
}

function farShore(rng) {
  const g = new THREE.Group();
  const zBase = 1500;
  const n = 160;
  const pos = [];
  let h = 40;
  const tops = [];
  for (let i = 0; i <= n; i++) {
    const x = -4200 + (8400 * i) / n;
    h = Math.max(12, Math.min(150, h + rng.float(-18, 18)));
    tops.push([x, h + 30 * Math.sin(i * 0.11)]);
  }
  for (let i = 0; i < n; i++) {
    const [x0, h0] = tops[i], [x1, h1] = tops[i + 1];
    pos.push(x0, -2, zBase, x1, -2, zBase, x1, h1, zBase, x0, -2, zBase, x1, h1, zBase, x0, h0, zBase);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const hill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: MOOD.fogColor.clone().multiplyScalar(0.62), fog: false, side: THREE.DoubleSide }));
  g.add(hill);
  const lp = [], lc = [];
  for (let i = 0; i < 1400; i++) {
    const x = rng.float(-2600, 2600);
    const cluster = Math.sin(x * 0.004) * 0.5 + 0.5;
    if (!rng.chance(0.25 + cluster * 0.75)) continue;
    lp.push(x, rng.float(0, 18 + cluster * 30), zBase - 5 - rng.float(0, 30));
    const c = rng.chance(0.8) ? [1.6, 0.9, 0.45] : [1.2, 1.3, 1.5];
    const k = rng.float(0.4, 1.0);
    lc.push(c[0] * k, c[1] * k, c[2] * k);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(pts);
  return g;
}
