// Street furniture, instanced: lamps (with glowing heads and baked light pools),
// traffic signals that cycle, trees, bins, benches, hydrants, planters, bollards,
// plaza fountains and the promenade railing. Every prop registers a collider and
// a baked contact shadow.
import * as THREE from '../../vendor/three.min.js';
import { CITY } from '../config.js';
import { GeoBuilder, instance, mat4 } from './geobuilder.js';
import { JETTY_IN } from './layout.js';
import { nearRoadEnd } from './roadEnds.js';

const K = CITY.kerbH;
const R = CITY.roadHalf;
const C = (h, k = 1) => new THREE.Color(h).multiplyScalar(k);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);

// ---------------------------------------------------------------- prototypes
function lampProto() {
  const b = new GeoBuilder();
  const dark = C('#2a2d32');
  b.box(0, 0.25, 0, 0.36, 0.5, 0.36, { color: dark });
  b.addGeometry(cyl(0.065, 0.1, 7, 7), mat4(0, 3.5, 0), { color: dark });
  b.box(0, 6.95, 0.85, 0.08, 0.08, 1.8, { color: dark });
  b.box(0, 6.88, 1.78, 0.46, 0.16, 0.72, { color: dark });
  return b.build();
}
function lampFarProto() {
  const b = new GeoBuilder();
  const dark = C('#2a2d32');
  b.box(0, 3.5, 0, 0.14, 7, 0.14, { color: dark });
  b.box(0, 6.92, 0.95, 0.4, 0.14, 1.9, { color: dark });
  return b.build();
}
function lampGlowProto() {
  const b = new GeoBuilder();
  b.addGeometry(new THREE.PlaneGeometry(0.36, 0.6).rotateX(Math.PI / 2), mat4(0, 6.79, 1.78), {});
  return b.build();
}
function signalProto() {
  const b = new GeoBuilder();
  const dark = C('#26282c'), yel = C('#3a3a2a');
  b.box(0, 0.2, 0, 0.4, 0.4, 0.4, { color: dark });
  b.addGeometry(cyl(0.09, 0.13, 5.7), mat4(0, 2.85, 0), { color: dark });
  b.box(0, 5.45, 2.1, 0.12, 0.14, 4.3, { color: dark });
  b.box(0, 4.9, 3.8, 0.3, 1.0, 0.36, { color: yel });
  b.box(0.02, 4.9, 3.8, 0.04, 1.25, 0.6, { color: dark });
  for (const y of [5.2, 4.9, 4.6]) b.box(0.2, y + 0.1, 3.8, 0.12, 0.03, 0.26, { color: dark }); // visors
  b.box(0.22, 1.2, 0, 0.12, 0.2, 0.16, { color: C('#c9a227') }); // push button box
  return b.build();
}
function treeTrunkProto() {
  const b = new GeoBuilder();
  b.addGeometry(cyl(0.1, 0.16, 3.4, 8), mat4(0, 1.7, 0), { color: C('#3b2d24') });
  b.addGeometry(cyl(0.05, 0.07, 1.4, 6).rotateZ(0.5), mat4(0.3, 3.2, 0), { color: C('#3b2d24') });
  b.box(0, 0.005, 0, 1.3, 0.01, 1.3, { color: C('#202022') }); // grate
  return b.build();
}
function foliageProto(rng) {
  const b = new GeoBuilder();
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const blobs = [[0, 4.2, 0, 1.3], [0.5, 5.0, 0.2, 1.05], [-0.45, 5.1, -0.2, 0.95]];
  for (const [x, y, z, r] of blobs) {
    const g = blob.clone();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + rng.float(-0.12, 0.12);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    b.addGeometry(g, mat4(x, y, z, 0, r, r, r), { color: C(rng.pick(['#2f4a2a', '#36502c', '#2a4430'])) });
  }
  return b.build();
}
function binProto() {
  const b = new GeoBuilder();
  b.addGeometry(cyl(0.27, 0.24, 0.9, 8), mat4(0, 0.45, 0), { color: C('#1f3b33'), ao: 0.3 });
  b.addGeometry(cyl(0.3, 0.3, 0.08, 8), mat4(0, 0.94, 0), { color: C('#1a1d1f') });
  return b.build();
}
function benchProto() {
  const b = new GeoBuilder();
  const wood = C('#6b4a32'), iron = C('#1e1f22');
  for (const z of [-0.12, 0.02, 0.16]) b.box(0, 0.45, z, 1.8, 0.04, 0.11, { color: wood });
  for (const y of [0.62, 0.76]) b.box(0, y, -0.24, 1.8, 0.1, 0.03, { color: wood });
  for (const x of [-0.75, 0.75]) {
    b.box(x, 0.22, 0.02, 0.06, 0.44, 0.42, { color: iron });
    b.box(x, 0.6, -0.26, 0.06, 0.4, 0.04, { color: iron });
  }
  return b.build();
}
function hydrantProto() {
  const b = new GeoBuilder();
  const red = C('#a8261d');
  b.addGeometry(cyl(0.12, 0.14, 0.62, 8), mat4(0, 0.31, 0), { color: red });
  b.addGeometry(new THREE.SphereGeometry(0.13, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat4(0, 0.62, 0), { color: red });
  b.addGeometry(cyl(0.05, 0.05, 0.36, 6).rotateZ(Math.PI / 2), mat4(0, 0.42, 0), { color: C('#c8c2b8') });
  return b.build();
}
function planterProto() {
  const b = new GeoBuilder();
  b.box(0, 0.32, 0, 1.6, 0.64, 0.8, { color: C('#7c7872'), ao: 0.3 });
  b.box(0, 0.62, 0, 1.44, 0.04, 0.64, { color: C('#2a2420') });
  return b.build();
}
function shrubProto() {
  const b = new GeoBuilder();
  const g = new THREE.IcosahedronGeometry(1, 1);
  b.addGeometry(g, mat4(-0.35, 0.85, 0, 0, 0.45, 0.38, 0.38), { color: C('#2f4a2a') });
  b.addGeometry(g, mat4(0.35, 0.85, 0, 0, 0.45, 0.4, 0.38), { color: C('#3a5530') });
  return b.build();
}
function bollardProto() {
  const b = new GeoBuilder();
  b.addGeometry(cyl(0.11, 0.13, 0.9, 10), mat4(0, 0.45, 0), { color: C('#24262a') });
  b.box(0, 0.78, 0, 0.27, 0.05, 0.27, { color: C('#b8b4a8') });
  return b.build();
}
function shelterProto() {
  const b = new GeoBuilder();
  const frame = C('#34373b'), glass = C('#56727a', 0.62), roof = C('#25292e');
  for (const x of [-1.2, 1.2]) {
    b.box(x, 1.05, -0.3, 0.08, 2.1, 0.08, { color: frame });
    b.box(x, 1.05, 0.3, 0.08, 2.1, 0.08, { color: frame });
  }
  b.box(0, 2.12, 0, 2.55, 0.16, 0.9, { color: roof });
  b.box(0, 1.08, -0.3, 2.35, 1.8, 0.035, { color: glass });
  b.box(0, 0.5, 0.28, 1.75, 0.08, 0.52, { color: C('#4c4135') });
  return b.build();
}
function vendingProto() {
  const b = new GeoBuilder();
  b.box(0, 0.84, 0, 0.68, 1.68, 0.55, { color: C('#344b52') });
  b.box(0, 1.12, 0.286, 0.48, 0.75, 0.025, { color: C('#91bdad') });
  b.box(0, 0.28, 0.286, 0.48, 0.18, 0.025, { color: C('#b54938') });
  b.box(0, 1.57, 0.286, 0.5, 0.12, 0.025, { color: C('#e3c66e') });
  return b.build();
}
function signProto() {
  const b = new GeoBuilder();
  b.box(0, 1.2, 0, 0.06, 2.4, 0.06, { color: C('#767d7a') });
  b.box(0, 2.15, 0, 0.85, 0.45, 0.06, { color: C('#28534f') });
  b.box(0, 2.15, 0.04, 0.55, 0.045, 0.02, { color: C('#e4e0cc') });
  b.box(0.22, 2.19, 0.04, 0.05, 0.15, 0.02, { color: C('#e4e0cc') });
  return b.build();
}

// ---------------------------------------------------------------- placement
// Signal timing shared by the lamps and the traffic AI. 20 s cycle per junction:
// axis 0 (traffic along x) green 0-8, amber 8-10; axis 1 green 10-18, amber 18-20.
// Returns 2 green, 1 amber, 0 red.
export const signalOffset = (idx) => (idx * 7.3) % 20;
export function signalCycle(t, axis) {
  const ph = ((t % 20) + 20) % 20;
  const local = axis === 0 ? ph : (ph + 10) % 20;
  return local < 8 ? 2 : local < 10 ? 1 : 0;
}

// PASS 17c: a round footprint as a stack of 0.4 m slices (each spans the chord at its middle), so the
// collider follows the drawn circle to ~0.2 m instead of filling its bounding square.
function circleColliders(colliders, cx, cz, r, h, tag) {
  const n = Math.max(4, Math.ceil((2 * r) / 0.4));
  for (let i = 0; i < n; i++) {
    const za = -r + (2 * r * i) / n, zb = -r + (2 * r * (i + 1)) / n, zm = (za + zb) / 2;
    const hw = Math.sqrt(Math.max(0, r * r - zm * zm));
    colliders.add(cx - hw, 0, cz + za, cx + hw, h, cz + zb, tag);
  }
}
// PASS 17c: bus shelter colliders from the drawn parts (shelterProto): four posts, the back glass and the
// bench seat. The front and the sides between the posts are open, as drawn; the old 2.56 x 0.92 x 2.2 box
// stopped people (and cars) at thin air on three sides.
function shelterColliders(colliders, x, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  // local (lx, lz) -> world for a rotation about +y (three.js: x' = x cos + z sin, z' = -x sin + z cos)
  const box = (lx0, lz0, lx1, lz1, h) => {
    const pts = [[lx0, lz0], [lx1, lz0], [lx1, lz1], [lx0, lz1]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
    colliders.add(Math.min(...pts.map((p) => p[0])), 0, Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])), h, Math.max(...pts.map((p) => p[1])), 'shelter');
  };
  for (const px of [-1.2, 1.2]) for (const pz of [-0.3, 0.3]) box(px - 0.06, pz - 0.06, px + 0.06, pz + 0.06, 2.2);
  box(-1.18, -0.33, 1.18, -0.27, 2.2);      // back glass
  box(-0.875, 0.02, 0.875, 0.54, 0.7);      // seat (drawn at K + 0.46..0.54, no legs: a low box up to it)
}

export function buildProps(layout, rng, mats, colliders, lm, clearance) {
  const P = {
    lamp: [], signal: [], tree: [], bin: [], bench: [], hydrant: [], planter: [], bollard: [], shelter: [], vending: [], sign: [],
  };
  const glowHeads = [];
  const blocked = (x, z, r) => clearance.some((c) => x + r > c[0] && x - r < c[2] && z + r > c[1] && z - r < c[3]);
  const farLamps = [];
  const addLamp = (x, z, dx, dz, far = false) => {
    (far ? farLamps : P.lamp).push({ x, y: K, z, rot: Math.atan2(dx, dz) });
    const hx = x + dx * 1.78, hz = z + dz * 1.78;
    // glow halo round the head (far lamps: a smaller glint)
    lm.glow(hx, K + 6.74, hz, far ? [5, 3.1, 1.3] : [3.0, 1.85, 0.8], far ? 0.9 : 1.15, { pull: 0.5 });
    if (far) return;
    lm.shaft(hx, K + 6.72, hz, 0, -1, 0, 6.6, 2.9, [0.045, 0.028, 0.012]);
    lm.source(hx, K + 6.74, hz, [10, 6.2, 2.6], 1);
    glowHeads.push([hx, hz]);
    lm.pool(hx, hz, 10, [255, 168, 88], 0.62);
    lm.pool(hx, hz, 3.2, [255, 205, 140], 0.35);
    lm.shadow(x, z, 0.7, 0.5);
    colliders.addCircle(x, z, 0.18, 7.2, 'pole');
  };

  const segAll = layout.segments.map((s) => ({ ...s, main: true }))
    .concat(layout.outerSegments.map((s) => ({ ...s, main: false })));
  for (const seg of segAll) {
    const r = rng.fork(`seg-${seg.axis}-${seg.c}-${seg.from}`);
    const P2 = (a, c) => (seg.axis === 'x' ? [a, seg.c + c] : [seg.c + c, a]);
    const dirTo = (c) => (seg.axis === 'x' ? [0, -Math.sign(c)] : [-Math.sign(c), 0]);
    const waterfrontSouth = (side) => seg.axis === 'x' && seg.c === CITY.streets[CITY.streets.length - 1] && side > 0;
    for (const side of [-1, 1]) {
      const stagger = side > 0 ? 0 : 11;
      // lamps every 22 m, kerb side
      for (let a = seg.from + 18 + stagger; a < seg.to - 12; a += 22) {
        const [x, z] = P2(a, side * 6.75);
        const [dx, dz] = dirTo(side);
        addLamp(x, z, dx, dz, !seg.main && (Math.abs(x) > 290 || z < -290));
      if (seg.main && r.chance(0.55)) {
          const [bx, bz] = P2(a + 1.3, side * 6.85);
          P.bin.push({ x: bx, y: K, z: bz, rot: r.float(0, 6) });
          colliders.addCircle(bx, bz, 0.3, 1, 'bin');
          lm.shadow(bx, bz, 0.6, 0.45);
        }
      }
      if (seg.main) {
        for (const a of [seg.from + 11.5, seg.to - 11.5]) {
          const [bx, bz] = P2(a, side * 6.55);
          P.bollard.push({ x: bx, y: layout.groundHeight(bx, bz), z: bz });
          colliders.addCircle(bx, bz, 0.13, 0.9, 'bollard');
        }
        const [signX, signZ] = P2(seg.from + 14, side * 8.6);
        P.sign.push({ x: signX, y: layout.groundHeight(signX, signZ), z: signZ, rot: seg.axis === 'x' ? 0 : Math.PI / 2 });
        colliders.addCircle(signX, signZ, 0.08, 2.5, 'sign');
        const alongMid = seg.from + (seg.to - seg.from) * (side > 0 ? 0.69 : 0.38);
        const [vx, vz] = P2(alongMid, side * 9.05);
        const rot = seg.axis === 'x' ? 0 : Math.PI / 2;
        P.vending.push({ x: vx, y: K, z: vz, rot });
        colliders.add(vx - (seg.axis === 'x' ? 0.42 : 0.3), 0, vz - (seg.axis === 'x' ? 0.3 : 0.42),
          vx + (seg.axis === 'x' ? 0.42 : 0.3), 1.68, vz + (seg.axis === 'x' ? 0.3 : 0.42), 'vending');
        lm.shadow(vx, vz, 0.55, 0.4);
        if (r.chance(0.32)) {
          const [sx, sz] = P2(seg.from + (seg.to - seg.from) * 0.51, side * 8.75);
          P.shelter.push({ x: sx, y: K, z: sz, rot });
          shelterColliders(colliders, sx, sz, rot);
          lm.shadow(sx, sz, 1.5, 0.36);
        }
      }
      if (!seg.main) continue;
      if (waterfrontSouth(side)) continue; // promenade side handled separately
      // trees between lamps, where no awning or blade sign overhangs
      for (let a = seg.from + 29 + stagger; a < seg.to - 14; a += 22) {
        if (!r.chance(0.8)) continue;
        const [x, z] = P2(a, side * 7.1);
        if (blocked(x, z, 1.9)) continue;
        const s = r.float(0.85, 1.12);
        P.tree.push({ x, y: K, z, rot: r.float(0, 6.28), s });
        colliders.addCircle(x, z, 0.22, 4, 'tree');
        lm.shadow(x, z, 2.4 * s, 0.38);
        lm.shadow(x, z, 0.6, 0.4);
        // bench facing the street, under the tree canopy line
        if (r.chance(0.35)) {
          const [bx, bz] = P2(a + r.float(-1.5, 1.5), side * 9.25);
          const [dx, dz] = dirTo(side);
          P.bench.push({ x: bx, y: K, z: bz, rot: Math.atan2(dx, dz) });
          const ax = seg.axis === 'x';
          colliders.add(bx - (ax ? 0.95 : 0.3), 0, bz - (ax ? 0.3 : 0.95), bx + (ax ? 0.95 : 0.3), 0.9, bz + (ax ? 0.3 : 0.95), 'bench');
          lm.shadow(bx - (ax ? 0.6 : 0), bz - (ax ? 0 : 0.6), 0.8, 0.45);
          lm.shadow(bx + (ax ? 0.6 : 0), bz + (ax ? 0 : 0.6), 0.8, 0.45);
        }
      }
      // one hydrant per side near the corner
      if (r.chance(0.7)) {
        const [x, z] = P2(seg.from + 12.5 + (side > 0 ? 0 : seg.to - seg.from - 25), side * 6.6);
        P.hydrant.push({ x, y: K, z, rot: r.float(0, 6) });
        colliders.addCircle(x, z, 0.16, 0.8, 'hydrant');
        lm.shadow(x, z, 0.45, 0.45);
      }
      // planters near the building line
      if (r.chance(0.3)) {
        const [x, z] = P2(seg.from + (side > 0 ? 34 : 45), side * 9.3);
        if (!blocked(x, z, 1)) {
          P.planter.push({ x, y: K, z, rot: seg.axis === 'x' ? 0 : Math.PI / 2 });
          const ax = seg.axis === 'x';
          colliders.add(x - (ax ? 0.8 : 0.4), 0, z - (ax ? 0.4 : 0.8), x + (ax ? 0.8 : 0.4), 0.64, z + (ax ? 0.4 : 0.8), 'planter');
          lm.shadow(x, z, 1.4, 0.4);
        }
      }
    }
  }

  // traffic signals: one pole per approach at the far-right corner, arm over the lanes
  const signalHeads = [];
  layout.intersections.forEach((it, idx) => {
    const approaches = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [fx, fz] of approaches) {
      const rx = -fz, rz = fx; // right of travel, three.js handedness: f x up
      const px = it.x + rx * 6.7 + fx * 6.7, pz = it.z + rz * 6.7 + fz * 6.7;
      if (!layout.walkable(px, pz) && Math.abs(px) > 230) continue;
      const rot = Math.atan2(-rx, -rz);
      P.signal.push({ x: px, y: K, z: pz, rot });
      colliders.addCircle(px, pz, 0.2, 5.8, 'pole');
      lm.shadow(px, pz, 0.6, 0.45);
      signalHeads.push({ x: px, z: pz, rot, axis: fx !== 0 ? 0 : 1, offset: signalOffset(idx) });
    }
  });

  // promenade: railing at the quay edge, lamps, benches facing the water, trees, bollards
  const prom = layout.promenade;
  const railZ = CITY.quayZ - 0.25;
  const posts = [];
  for (let x = -330; x <= prom.x1 - 1; x += 2.5) {
    if (x > layout.pier.x0 - 1 && x < layout.pier.x1 + 1) continue;
    posts.push({ x, y: K, z: railZ });
  }
  for (let x = -320; x < prom.x1 - 6; x += 24) {
    addLamp(x, railZ - 1.0, 0, -1);
    if (rng.chance(0.8) && !nearRoadEnd(x + 12, railZ - 1.6, 1.0)) {   // PASS 17c: not inside a road-closure barrier
      P.bench.push({ x: x + 12, y: K, z: railZ - 1.6, rot: Math.PI });
      colliders.add(x + 11.05, 0, railZ - 1.9, x + 12.95, 0.9, railZ - 1.3, 'bench');
      lm.shadow(x + 12, railZ - 1.6, 1.1, 0.4);
    }
  }
  for (let x = -316; x < prom.x1 - 6; x += 16) {
    P.tree.push({ x, y: K, z: prom.z0 + 4.2, rot: rng.float(0, 6), s: rng.float(0.9, 1.15) });
    colliders.addCircle(x, prom.z0 + 4.2, 0.22, 4, 'tree');
    lm.shadow(x, prom.z0 + 4.2, 2.6, 0.38);
  }
  // PASS 17c: the quay rail collider stops where the drawn rail stops at the jetty mouth
  // (top of the collider = top of the drawn rail, K + 1.12)
  colliders.add(-700, 0, CITY.quayZ - 0.4, layout.pier.x0 + JETTY_IN, 1.3, CITY.quayZ + 2, 'rail');
  colliders.add(layout.pier.x1 - JETTY_IN, 0, CITY.quayZ - 0.4, 700, 1.3, CITY.quayZ + 2, 'rail');
  // the jetty: bollards along both edges
  for (let z = layout.pier.z0 + 4; z < layout.pier.z1 - 1; z += 6) {
    for (const x of [layout.pier.x0 + 0.5, layout.pier.x1 - 0.5]) {
      P.bollard.push({ x, y: K, z });
      colliders.addCircle(x, z, 0.13, 0.9, 'bollard');   // PASS 17c: drawn, so solid (the deck now reaches the rail)
      lm.shadow(x, z, 0.4, 0.4);
    }
  }
  for (let z = layout.pier.z0 + 10; z < layout.pier.z1; z += 20) {
    addLamp(layout.pier.x0 + 0.6, z, 1, 0);
  }

  // ---- meshes
  const out = new THREE.Group();
  out.name = 'props';
  const batches = [];
  const add = (geo, mat, list, opts) => {
    if (!list.length) return;
    const mesh = instance(geo, mat, list, opts);
    out.add(mesh);
    if (list !== farLamps && list !== posts) batches.push({ mesh, list });
  };
  add(lampProto(), mats.prop, P.lamp);
  add(lampFarProto(), mats.prop, farLamps, { castShadow: false });
  out.add(instance(lampGlowProto(), mats.lampGlow, P.lamp.concat(farLamps), { castShadow: false, receiveShadow: false }));
  add(signalProto(), mats.prop, P.signal);
  add(treeTrunkProto(), mats.prop, P.tree);
  add(foliageProto(rng.fork('foliage')), mats.foliage, P.tree);
  add(binProto(), mats.prop, P.bin);
  add(benchProto(), mats.prop, P.bench);
  add(hydrantProto(), mats.prop, P.hydrant);
  add(planterProto(), mats.prop, P.planter);
  add(shrubProto(), mats.foliage, P.planter);
  add(bollardProto(), mats.prop, P.bollard);
  add(shelterProto(), mats.prop, P.shelter);
  add(vendingProto(), mats.prop, P.vending);
  add(signProto(), mats.prop, P.sign);
  // railing posts + rails
  const railB = new GeoBuilder();
  const rc = C('#2b2e33');
  railB.box(0, 0.55, 0, 0.07, 1.1, 0.07, { color: rc });
  add(railB.build(), mats.prop, posts, { castShadow: true });
  const rails = new GeoBuilder();
  // PASS 17c: the quay rail runs on to meet the jetty side rails, which now start at the quay rail
  for (const [x0, x1] of [[-330, layout.pier.x0 + 0.06], [layout.pier.x1 - 0.06, prom.x1]]) {
    rails.boxMinMax(x0, K + 1.05, railZ - 0.05, x1, K + 1.12, railZ + 0.05, { color: rc });
    rails.boxMinMax(x0, K + 0.55, railZ - 0.025, x1, K + 0.6, railZ + 0.025, { color: rc });
  }
  // jetty railings
  for (const x of [layout.pier.x0 + 0.1, layout.pier.x1 - 0.1]) {
    rails.boxMinMax(x - 0.04, K + 1.05, railZ - 0.05, x + 0.04, K + 1.12, layout.pier.z1, { color: rc });
  }
  rails.boxMinMax(layout.pier.x0, K + 1.05, layout.pier.z1 - 0.12, layout.pier.x1, K + 1.12, layout.pier.z1 - 0.04, { color: rc });
  const railMesh = new THREE.Mesh(rails.build(), mats.prop);
  railMesh.castShadow = true;
  out.add(railMesh);
  // PASS 17c: faces on the drawn jetty railings (rails at x0 + 0.1, x1 - 0.1 and z1 - 0.08), not 0.5 m inboard
  colliders.add(layout.pier.x0 - 1, 0, CITY.quayZ - 0.4, layout.pier.x0 + JETTY_IN, 1.3, layout.pier.z1, 'rail');
  colliders.add(layout.pier.x1 - JETTY_IN, 0, CITY.quayZ - 0.4, layout.pier.x1 + 1, 1.3, layout.pier.z1, 'rail');
  colliders.add(layout.pier.x0, 0, layout.pier.z1 - JETTY_IN, layout.pier.x1, 1.3, layout.pier.z1 + 1, 'rail');

  // signal lamps: three per head, recoloured every frame from the cycle
  const lampGeo = new THREE.CircleGeometry(0.1, 12).rotateY(Math.PI / 2);
  const sig = new THREE.InstancedMesh(lampGeo, mats.signalLamp, signalHeads.length * 3);
  const m = new THREE.Matrix4();
  signalHeads.forEach((h, i) => {
    const base = mat4(h.x, K, h.z, h.rot);
    [5.2, 4.9, 4.6].forEach((y, k) => {
      m.makeTranslation(0.17, y, 3.8);
      sig.setMatrixAt(i * 3 + k, base.clone().multiply(m));
      sig.setColorAt(i * 3 + k, new THREE.Color(0, 0, 0));
    });
  });
  sig.computeBoundingSphere();
  out.add(sig);
  // glow sprites (one per lens, only the lit one gets colour) and a wet-road source per head
  const _hp = new THREE.Vector3();
  signalHeads.forEach((h) => {
    const base = mat4(h.x, K, h.z, h.rot);
    h.sprites = [5.2, 4.9, 4.6].map((y) => {
      _hp.set(0.3, y, 3.8).applyMatrix4(base);
      return lm.glow(_hp.x, _hp.y, _hp.z, [0, 0, 0], 0.75, { pull: 0.25 });
    });
    _hp.set(0.3, 4.9, 3.8).applyMatrix4(base);
    h.source = lm.source(_hp.x, _hp.y, _hp.z, [0, 0, 0], 0.6);
  });

  const RED = new THREE.Color(9, 0.5, 0.3), AMB = new THREE.Color(9, 4.2, 0.4), GRN = new THREE.Color(0.4, 9, 3.5);
  const OFF = [new THREE.Color(0.09, 0.01, 0.01), new THREE.Color(0.09, 0.05, 0.01), new THREE.Color(0.01, 0.07, 0.03)];
  let lastKey = '';
  let fxSeen = null;
  const LIT = [[2.6, 0.12, 0.06], [2.6, 1.15, 0.08], [0.1, 2.4, 0.95]];
  function updateSignals(t) {
    const key = Math.floor(t * 4);
    const fx = lm.lights.fx;
    if (key === lastKey && fx === fxSeen) return;
    lastKey = key; fxSeen = fx;
    signalHeads.forEach((h, i) => {
      const state = signalCycle(t + h.offset, h.axis);
      sig.setColorAt(i * 3, state === 0 ? RED : OFF[0]);
      sig.setColorAt(i * 3 + 1, state === 1 ? AMB : OFF[1]);
      sig.setColorAt(i * 3 + 2, state === 2 ? GRN : OFF[2]);
      // lens order top..bottom is red, amber, green
      const lit = state === 0 ? 0 : state === 1 ? 1 : 2;
      const c = LIT[lit];
      if (fx) for (let k = 0; k < 3; k++) fx.setStaticColor(h.sprites[k], k === lit ? c[0] : 0, k === lit ? c[1] : 0, k === lit ? c[2] : 0);
      h.source.r = c[0] * 3.2; h.source.g = c[1] * 3.2; h.source.b = c[2] * 3.2;
      h.source.y = K + [5.2, 4.9, 4.6][lit];
    });
    sig.instanceColor.needsUpdate = true;
  }
  updateSignals(0);

  let lastX = Infinity, lastZ = Infinity;
  function update(t, camera) {
    updateSignals(t);
    if (!camera || Math.hypot(camera.position.x - lastX, camera.position.z - lastZ) < 6) return;
    lastX = camera.position.x; lastZ = camera.position.z;
    for (const { mesh, list } of batches) {
      let n = 0;
      for (const p of list) {
        if (Math.hypot(p.x - lastX, p.z - lastZ) > 145) continue;
        mesh.setMatrixAt(n++, mat4(p.x, p.y || 0, p.z, p.rot || 0, p.s || 1, p.sy || p.s || 1, p.s || 1));
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  const locations = Object.entries(P).flatMap(([kind, list]) => list.map((p) => ({ kind, x: p.x, y: p.y, z: p.z })));
  return { group: out, update, locations,
    counts: { ...Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length])), farLamp: farLamps.length } };
}

// Plaza cells: paved squares with a fountain, trees in a grid and benches.
export function buildPlazas(plazas, rng, B, mats, colliders, lm) {
  const trees = [], benches = [];
  for (const p of plazas) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    // fountain
    const fr = Math.min(w, d) * 0.22;
    const stone = C('#9a958c');
    B.trim.addGeometry(new THREE.CylinderGeometry(fr, fr + 0.1, 0.55, 28, 1, true), mat4(cx, K + 0.275, cz), { color: stone });
    B.trim.addGeometry(new THREE.CylinderGeometry(fr - 0.3, fr - 0.3, 0.55, 28, 1, true).scale(-1, 1, 1), mat4(cx, K + 0.275, cz), { color: stone });
    B.trim.addGeometry(new THREE.RingGeometry(fr - 0.3, fr, 28).rotateX(-Math.PI / 2), mat4(cx, K + 0.55, cz), { color: stone });
    B.pool.addGeometry(new THREE.CircleGeometry(fr - 0.3, 28).rotateX(-Math.PI / 2), mat4(cx, K + 0.42, cz), {});
    B.trim.addGeometry(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 12), mat4(cx, K + 1.1, cz), { color: stone });
    B.trim.addGeometry(new THREE.CylinderGeometry(1.0, 0.3, 0.25, 16), mat4(cx, K + 2.3, cz), { color: stone });
    // PASS 17c: the basin is round; its bounding square stuck 0.4 fr out at the corners as an invisible wall
    circleColliders(colliders, cx, cz, fr + 0.05, 0.6, 'fountain');
    lm.shadow(cx, cz, fr + 1, 0.35);
    lm.pool(cx, cz, fr + 4, [120, 220, 255], 0.18);
    // trees in the four quadrants, benches facing the fountain
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const tx = cx + sx * (w / 2 - 3.5), tz = cz + sz * (d / 2 - 3.5);
      const s = rng.float(0.9, 1.15);
      trees.push({ x: tx, y: K, z: tz, rot: rng.float(0, 6), s });
      colliders.addCircle(tx, tz, 0.22, 4, 'tree');
      lm.shadow(tx, tz, 2.6 * s, 0.4);
    }
    for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const bx = cx + sx * (fr + 2.4), bz = cz + sz * (fr + 2.4);
      benches.push({ x: bx, y: K, z: bz, rot: Math.atan2(-sx, -sz) });
      colliders.add(bx - (sz ? 0.95 : 0.3), 0, bz - (sz ? 0.3 : 0.95), bx + (sz ? 0.95 : 0.3), 0.9, bz + (sz ? 0.3 : 0.95), 'bench');
      lm.shadow(bx, bz, 1.1, 0.4);
    }
    // a pair of park lamps
    for (const [sx, sz] of [[-1, 1], [1, -1]]) {
      const lx = cx + sx * (w / 2 - 2), lz = cz + sz * (d / 2 - 6);
      B.trim.addGeometry(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 8), mat4(lx, K + 1.8, lz), { color: C('#2a2d32') });
      B.glow.addGeometry(new THREE.SphereGeometry(0.22, 10, 8), mat4(lx, K + 3.75, lz), { color: C('#ffd59a', 6) });
      lm.glow(lx, K + 3.75, lz, [3.4, 2.4, 1.2], 1.3, { pull: 0.4 });
      lm.source(lx, K + 3.75, lz, [6, 4.2, 2.2], 1);
      colliders.addCircle(lx, lz, 0.12, 3.6, 'pole');
      lm.pool(lx, lz, 6, [255, 190, 120], 0.5);
    }
  }
  const g = new THREE.Group();
  if (trees.length) {
    g.add(instance(treeTrunkProto(), mats.prop, trees));
    g.add(instance(foliageProto(rng.fork('plaza-foliage')), mats.foliage, trees));
  }
  if (benches.length) g.add(instance(benchProto(), mats.prop, benches));
  return g;
}
