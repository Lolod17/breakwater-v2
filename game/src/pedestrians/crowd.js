// Bounded, instanced pedestrian crowd. Agents follow the sidewalk graph between
// blocks and use its crossing links at junctions. Every body is a jointed rig:
// pelvis, torso, head with neck and face, upper arms, forearms, hands, thighs,
// shins and shoes, each one bone segment in a shared InstancedMesh (vertex
// colours shade details, the instance colour dresses the segment). Clothing
// variants (jacket, skirt, hair styles, cap, backpack, shoulder bag) are extra
// batches that only the agents wearing them fill, so the whole crowd costs a
// fixed ~19 draw calls regardless of how many people are on screen.
import * as THREE from '../../vendor/three.min.js';
import { CITY } from '../config.js';
import { GeoBuilder } from '../world/geobuilder.js';
import { reactionFor, playerState as lifeState } from '../world/life.js';

const CAP = 18;
const RADIUS = 0.24;
const PALETTE = ['#b84c42', '#315a78', '#8b6937', '#486c50', '#775477', '#c07843', '#3e666c', '#a34f68', '#555b68'];
const PANTS = ['#26364b', '#3d3940', '#4a4439', '#283b36', '#4d5260'];
const SKIN = ['#c68a68', '#e0ad83', '#a96f52', '#8b5946', '#d49b72'];
const HAIR = ['#16110e', '#2b1d14', '#4a3020', '#7a5530', '#b89a64', '#6d2f1c', '#8d8a86'];
const SHOES = ['#24252a', '#e6e2da', '#5a3a26', '#2f3a4a', '#8a2a2a', '#d0c7b4'];
const JACKETS = ['#23262c', '#4a5a3a', '#6a4b32', '#2a3a55', '#7c7466', '#5b2a30', '#b49a6a'];
const BAGS = ['#1c1c1f', '#5a3b22', '#2c4a5e', '#7a2e2e', '#3c4a30', '#c9b48a'];
const CAPS = ['#c0392b', '#1d3557', '#e9c46a', '#1c1c1c', '#2a9d8f', '#f1faee'];

// Body proportions for a 1.72 m adult (scaled by height / 1.72).
const THIGH = 0.42, SHIN = 0.42, ANK = 0.075, UPPER = 0.29, FORE = 0.25;
const HIP_W = 0.095, SHOULDER_W = 0.185, WAIST = 0.09, SHOULDER_Y = 0.41, NECK_Y = 0.47;

// Looks: build, top, bottom, hair and bag options. Every look appears in the pool.
const LOOKS = [
  { name: 'commuter', w: [0.98, 1.08], top: 'jacket', bottom: 'pants', hair: ['short', 'short', 'long'], bag: ['shoulder', null] },
  { name: 'student', w: [0.88, 0.96], top: 'tee', bottom: 'pants', hair: ['long', 'bun', 'short'], bag: ['backpack'] },
  { name: 'worker', w: [1.08, 1.18], top: 'long', bottom: 'pants', hair: ['cap'], bag: [null] },
  { name: 'shopper', w: [0.86, 0.95], top: 'long', bottom: 'skirt', hair: ['long', 'bun'], bag: ['shoulder'] },
  { name: 'runner', w: [0.88, 0.98], top: 'tee', bottom: 'shorts', hair: ['cap', 'short', 'bun'], bag: [null] },
  { name: 'elder', w: [1.04, 1.14], top: 'jacket', bottom: 'pants', hair: ['bald', 'short'], bag: [null, 'shoulder'], grey: true, short: true },
  { name: 'suit', w: [0.98, 1.06], top: 'jacket', bottom: 'pants', hair: ['short'], bag: [null], suit: true },
  { name: 'hoodie', w: [0.96, 1.06], top: 'long', bottom: 'pants', hair: ['short', 'bun', 'bald'], bag: ['backpack', null] },
];

const _matrix = new THREE.Matrix4(), _root = new THREE.Matrix4(), _fall = new THREE.Matrix4();
const _pelvis = new THREE.Matrix4(), _torso = new THREE.Matrix4(), _head = new THREE.Matrix4(), _local = new THREE.Matrix4();
const _position = new THREE.Vector3(), _scale = new THREE.Vector3(), _v = new THREE.Vector3();
const _quaternion = new THREE.Quaternion(), _euler = new THREE.Euler();
const _knee = new THREE.Vector3(), _sh = new THREE.Vector3(), _el = new THREE.Vector3(), _wr = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _hint = new THREE.Vector3(1, 0, 0);
const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Gait cycles per metre walked (shorter, quicker cycles while fleeing). The
// stance foot sweeps back D / stride metres in D of a cycle, the distance the
// body covers in that time, so the planted foot does not move.
const strideOf = (p) => lerp(0.85, 0.6, p.run || 0) * 1.72 / p.height;
const dutyOf = (p) => lerp(0.6, 0.36, p.run || 0);

// Merge primitive parts into one vertex-coloured geometry. `shade` is a grey
// multiplier on the instance colour (eyes ~0.05, soles 0.3) so one batch can
// carry dark detail without its own material.
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
function merged(parts) {
  const b = new GeoBuilder();
  for (const [geo, m, shade = 1] of parts) b.addGeometry(geo, m, { color: new THREE.Color(shade, shade, shade) });
  return b.build();
}
const box = new THREE.BoxGeometry(1, 1, 1);
const ball = (w = 12, h = 8) => new THREE.SphereGeometry(1, w, h);
const caps = (r, len, radial = 10) => new THREE.CapsuleGeometry(r, len, 3, radial);
const cyl = (rt, rb, radial = 12, open = false, t0 = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, 1, radial, 1, open, t0, tl);
const dome = (w = 14) => new THREE.SphereGeometry(1, w, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);

// Each geometry's origin is its parent joint; limbs extend along -Y.
function bodyGeometries() {
  const shortHair = [
    [dome(), M(0, 0.18, -0.005, 0.103, 0.122, 0.114, -0.15)],
    [ball(10, 6), M(0, 0.15, -0.04, 0.096, 0.092, 0.082)],
  ];
  return {
    pelvis: merged([
      [caps(0.1, 0.14), M(0, 0.02, 0, 1, 1, 1.12, 0, 0, Math.PI / 2)],
      [cyl(0.165, 0.165, 16), M(0, 0.1, 0, 1, 0.04, 0.74), 0.35],              // belt
      [box, M(0, 0.1, 0.123, 0.045, 0.03, 0.01), 0.9],                           // buckle
    ]),
    torso: merged([
      [caps(0.15, 0.24, 14), M(0, 0.24, 0, 1.2, 1, 0.72)],
      [caps(0.075, 0.24, 10), M(0, SHOULDER_Y - 0.01, -0.005, 1, 1, 1.15, 0, 0, Math.PI / 2)], // shoulder line
      [cyl(0.181, 0.18, 16), M(0, 0.0, 0, 1, 0.04, 0.73), 0.78],                 // hem band
      [cyl(0.062, 0.078, 12), M(0, NECK_Y - 0.01, 0, 1, 0.04, 1), 0.8],          // collar ring
    ]),
    // open jacket: longer hem below the waist, collar and lapels (jacket colour)
    jacket: merged([
      [cyl(0.188, 0.2, 16, true, 0.42, Math.PI * 2 - 0.84), M(0, -0.06, 0, 1, 0.16, 0.76)],
      [cyl(0.1, 0.125, 12, true, 0.6, Math.PI * 2 - 1.2), M(0, NECK_Y - 0.02, -0.005, 1, 0.08, 1)],
      [box, M(0.062, 0.36, 0.1, 0.06, 0.12, 0.02, 0.25, 0, 0.45)],
      [box, M(-0.062, 0.36, 0.1, 0.06, 0.12, 0.02, 0.25, 0, -0.45)],
      [box, M(0.11, 0.1, 0.112, 0.08, 0.07, 0.02, 0, 0.3, 0), 0.75],             // pockets
      [box, M(-0.11, 0.1, 0.112, 0.08, 0.07, 0.02, 0, -0.3, 0), 0.75],
    ]),
    // shirt showing in the open jacket front (shirt colour)
    shirtfront: merged([[box, M(0, 0.25, 0.108, 0.085, 0.3, 0.018, -0.06)], [box, M(0, 0.36, 0.118, 0.022, 0.14, 0.01), 0.55]]),
    head: merged([
      [cyl(0.048, 0.054, 10), M(0, 0.04, 0, 1, 0.1, 1)],                         // neck
      [ball(14, 10), M(0, 0.17, 0.005, 0.095, 0.115, 0.105)],                    // cranium
      [ball(10, 8), M(0, 0.11, 0.03, 0.075, 0.065, 0.08)],                       // jaw
      [box, M(0, 0.152, 0.11, 0.024, 0.04, 0.03, -0.2), 0.95],                   // nose
      [ball(8, 6), M(0.095, 0.16, -0.005, 0.016, 0.028, 0.02), 0.92],            // ears
      [ball(8, 6), M(-0.095, 0.16, -0.005, 0.016, 0.028, 0.02), 0.92],
      [box, M(0.036, 0.185, 0.107, 0.022, 0.011, 0.012), 0.05],                  // eyes
      [box, M(-0.036, 0.185, 0.107, 0.022, 0.011, 0.012), 0.05],
      [box, M(0.036, 0.207, 0.104, 0.032, 0.008, 0.012, 0, 0, -0.1), 0.22],      // brows
      [box, M(-0.036, 0.207, 0.104, 0.032, 0.008, 0.012, 0, 0, 0.1), 0.22],
      [box, M(0, 0.118, 0.107, 0.034, 0.007, 0.012), 0.5],                       // mouth
    ]),
    hairShort: merged(shortHair),
    hairLong: merged([...shortHair,
      [caps(0.085, 0.12, 10), M(0, 0.09, -0.05, 1.2, 1, 0.65)],                  // falls to the shoulders
      [box, M(0.088, 0.12, 0.01, 0.026, 0.15, 0.08)],
      [box, M(-0.088, 0.12, 0.01, 0.026, 0.15, 0.08)],
    ]),
    hairBun: merged([...shortHair, [ball(10, 8), M(0, 0.275, -0.07, 0.052, 0.05, 0.052)]]),
    cap: merged([
      [dome(), M(0, 0.19, -0.005, 0.112, 0.125, 0.121, -0.1)],
      [box, M(0, 0.215, 0.135, 0.15, 0.012, 0.1, 0.18), 0.85],                   // peak
      [ball(10, 6), M(0, 0.145, -0.045, 0.095, 0.085, 0.078), 0.35],             // hair under the cap
    ]),
    upperArm: merged([
      [ball(10, 8), M(0, -0.01, 0, 0.058, 0.056, 0.064)],
      [caps(0.052, UPPER - 0.1, 8), M(0, -UPPER / 2, 0)],
    ]),
    forearm: merged([[caps(0.045, FORE - 0.09, 8), M(0, -FORE / 2, 0)]]),
    hand: merged([
      [box, M(0, -0.042, 0.004, 0.038, 0.08, 0.072)],                            // palm
      [box, M(0, -0.095, 0.012, 0.033, 0.045, 0.064, 0.28)],                     // fingers, curled
      [box, M(0, -0.034, 0.044, 0.02, 0.048, 0.02, 0.4), 0.94],                  // thumb, forward
    ]),
    thigh: merged([[caps(0.077, THIGH - 0.12, 10), M(0, -THIGH / 2, 0)]]),
    shin: merged([
      [caps(0.058, SHIN - 0.1, 8), M(0, -SHIN / 2, 0)],
      [cyl(0.066, 0.07, 10), M(0, -SHIN + 0.05, 0, 1, 0.06, 1), 0.88],          // hem / sock
    ]),
    shoe: merged([
      [box, M(0, -0.036, 0.035, 0.095, 0.07, 0.2)],
      [ball(10, 6), M(0, -0.046, 0.13, 0.047, 0.036, 0.06)],                     // rounded toe
      [box, M(0, -0.064, 0.05, 0.102, 0.022, 0.27), 0.3],                        // sole
      [box, M(0, -0.002, 0.06, 0.055, 0.016, 0.085, 0.2), 0.82],                 // tongue / laces
    ]),
    skirt: merged([[cyl(0.165, 0.25, 16, true), M(0, -0.12, 0, 1, 0.38, 0.8)], [cyl(0.17, 0.17, 16), M(0, 0.07, 0, 1, 0.03, 0.78), 0.7]]),
    backpack: merged([
      [caps(0.1, 0.16, 10), M(0, 0.27, -0.17, 1.3, 1, 0.6)],
      [box, M(0, 0.2, -0.23, 0.18, 0.13, 0.04), 0.8],                            // front pocket
      [box, M(0.1, 0.46, -0.02, 0.04, 0.02, 0.26), 0.5],                         // straps over the shoulders
      [box, M(-0.1, 0.46, -0.02, 0.04, 0.02, 0.26), 0.5],
      [box, M(0.1, 0.3, 0.108, 0.035, 0.3, 0.012, -0.08), 0.5],
      [box, M(-0.1, 0.3, 0.108, 0.035, 0.3, 0.012, -0.08), 0.5],
    ]),
    shoulderBag: merged([
      [box, M(0.215, -0.03, 0.01, 0.065, 0.18, 0.25)],
      [box, M(0.25, -0.0, 0.01, 0.01, 0.1, 0.2), 0.75],                         // flap
      [box, M(0.02, 0.24, 0.112, 0.03, 0.56, 0.01, -0.05, 0, 0.62), 0.45],     // strap across the chest
      [box, M(0.02, 0.24, -0.115, 0.03, 0.56, 0.01, 0.05, 0, 0.62), 0.45],
    ]),
  };
}

// Place a bone segment between joint A (origin) and B: local -Y runs A -> B,
// local X stays as close to the body's side axis as possible.
function boneMatrix(out, ax, ay, az, bx, by, bz, len, s) {
  _y.set(ax - bx, ay - by, az - bz);
  const d = _y.length() || 1e-6;
  _y.multiplyScalar(1 / d);
  return basis(out, ax, ay, az, _y, s, d / len, s);
}
function basis(out, px, py, pz, Y, sx, sy, sz) {
  _x.copy(_hint).addScaledVector(Y, -_hint.dot(Y)).normalize();
  _z.crossVectors(_x, Y);
  return out.set(
    _x.x * sx, Y.x * sy, _z.x * sz, px,
    _x.y * sx, Y.y * sy, _z.y * sz, py,
    _x.z * sx, Y.z * sy, _z.z * sz, pz,
    0, 0, 0, 1);
}
// Two-bone IK with the knee bending forward (+Z): knee position into `out`.
function solveKnee(out, hx, hy, hz, ax, ay, az, T, S) {
  let dx = ax - hx, dy = ay - hy, dz = az - hz;
  const d = clamp(Math.hypot(dx, dy, dz), 0.05, T + S - 1e-4);
  const n = Math.hypot(dx, dy, dz) || 1;
  dx /= n; dy /= n; dz /= n;
  const a = (T * T - S * S + d * d) / (2 * d), h = Math.sqrt(Math.max(0, T * T - a * a));
  let px = -dz * dx, py = -dz * dy, pz = 1 - dz * dz;                       // forward pole, orthogonalised
  const pl = Math.hypot(px, py, pz) || 1;
  return out.set(hx + dx * a + px / pl * h, hy + dy * a + py / pl * h, hz + dz * a + pz / pl * h);
}

function makeGraph(world) {
  const streets = CITY.streets;
  const edges = [];
  const add = (a, b, crossing = false) => {
    const edge = { a, b, crossing, length: Math.hypot(b.x - a.x, b.z - a.z) };
    edges.push(edge);
    return edge;
  };
  for (let j = 0; j < streets.length; j++) {
    for (let i = 0; i < streets.length - 1; i++) for (const side of [-1, 1]) {
      add({ x: streets[i] + 7.5, z: streets[j] + side * 7.5 },
        { x: streets[i + 1] - 7.5, z: streets[j] + side * 7.5 });
    }
  }
  for (let i = 0; i < streets.length; i++) {
    for (let j = 0; j < streets.length - 1; j++) for (const side of [-1, 1]) {
      add({ x: streets[i] + side * 7.5, z: streets[j] + 7.5 },
        { x: streets[i] + side * 7.5, z: streets[j + 1] - 7.5 });
    }
  }
  // Zebra links at every junction. Their short 15 m legs connect opposite
  // corners, allowing walkers to turn or cross instead of cutting blocks.
    for (const x of streets) for (const z of streets) {
    for (const side of [-1, 1]) {
      add({ x: x - 7.5, z: z + side * 7.5 }, { x: x + 7.5, z: z + side * 7.5 }, true);
      add({ x: x + side * 7.5, z: z - 7.5 }, { x: x + side * 7.5, z: z + 7.5 }, true);
    }
  }
  // Continue the pavement to the jetty; no roof or water spawn candidates.
  add({ x: -60, z: 207.5 }, { x: -60, z: 224 });
  add({ x: -60, z: 224 }, { x: -60, z: 290 });
  for (const x of [-62.5, -57.5]) {
    add({ x, z: 224 }, { x, z: 290 });
    add({ x: -60, z: 224 }, { x, z: 224 });
    add({ x: -60, z: 290 }, { x, z: 290 });
  }
  // The waterfront pavement is a continuous promenade sidewalk.
  for (let x = streets[0]; x < streets[streets.length - 1]; x += 16) {
    add({ x, z: streets[streets.length - 1] + 7.5 },
      { x: Math.min(x + 16, streets[streets.length - 1]), z: streets[streets.length - 1] + 7.5 });
  }

  const nodes = new Map();
  const connect = (point, edge) => {
    const k = key(point.x, point.z);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { x: point.x, z: point.z, links: [] }));
    n.links.push(edge);
  };
  for (const edge of edges) { connect(edge.a, edge); connect(edge.b, edge); }

  const walkableSpot = (x, z) => {
    if (!world.layout.walkable(x, z)) return false;
    const p = { x, z };
    if (world.colliders.resolveCircle(p, RADIUS, 0.16, 1.78)) return false;
    return Math.hypot(p.x - x, p.z - z) < 0.005;
  };
  const spots = [];
  const used = new Set();
  for (const edge of edges) {
    const n = Math.max(1, Math.ceil(edge.length / 4.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = edge.a.x + (edge.b.x - edge.a.x) * t;
      const z = edge.a.z + (edge.b.z - edge.a.z) * t;
      const k = key(x, z);
       if (edge.crossing || used.has(k) || !walkableSpot(x, z)) continue;
      used.add(k);
      spots.push({ x, z, y: world.groundHeight(x, z), edge, t });
    }
  }
  return { edges, nodes, spots, walkableSpot };
}

export class Crowd {
  constructor(scene, world, rng) {
    this.world = world;
    this.initialRng = rng;
    this.rng = rng;
    this.lookRng = rng.fork('looks');
    this.graph = makeGraph(world);
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    const G = bodyGeometries();
    const white = new THREE.Color(1, 1, 1);
    this.batches = [];
    const inst = (geo, per, name, { rough = 0.78, side = THREE.FrontSide, shadow = true } = {}) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: rough, metalness: 0, side });
      const m = new THREE.InstancedMesh(geo, mat, CAP * per);
      for (let i = 0; i < CAP * per; i++) m.setColorAt(i, white);
      m.name = name; m.count = 0; m.frustumCulled = false;
      m.castShadow = shadow; m.receiveShadow = true;
      m.n = 0;
      this.group.add(m);
      this.batches.push(m);
      return m;
    };
    this.b = {
      pelvis: inst(G.pelvis, 1, 'pedestrian-pelvis', { rough: 0.85 }),
      torso: inst(G.torso, 1, 'pedestrian-torsos', { rough: 0.8 }),
      jacket: inst(G.jacket, 1, 'pedestrian-jackets', { rough: 0.7, side: THREE.DoubleSide }),
      shirtfront: inst(G.shirtfront, 1, 'pedestrian-shirtfronts', { shadow: false }),
      head: inst(G.head, 1, 'pedestrian-heads', { rough: 0.65 }),
      hairShort: inst(G.hairShort, 1, 'pedestrian-hair-short', { rough: 0.9 }),
      hairLong: inst(G.hairLong, 1, 'pedestrian-hair-long', { rough: 0.9 }),
      hairBun: inst(G.hairBun, 1, 'pedestrian-hair-bun', { rough: 0.9 }),
      cap: inst(G.cap, 1, 'pedestrian-caps', { rough: 0.75 }),
      upperArm: inst(G.upperArm, 2, 'pedestrian-upper-arms'),
      forearm: inst(G.forearm, 2, 'pedestrian-forearms'),
      hand: inst(G.hand, 2, 'pedestrian-hands', { rough: 0.65 }),
      thigh: inst(G.thigh, 2, 'pedestrian-thighs', { rough: 0.85 }),
      shin: inst(G.shin, 2, 'pedestrian-shins', { rough: 0.85 }),
      shoe: inst(G.shoe, 2, 'pedestrian-shoes', { rough: 0.55 }),
      skirt: inst(G.skirt, 1, 'pedestrian-skirts', { rough: 0.85, side: THREE.DoubleSide }),
      backpack: inst(G.backpack, 1, 'pedestrian-backpacks', { rough: 0.7 }),
      shoulderBag: inst(G.shoulderBag, 1, 'pedestrian-shoulder-bags', { rough: 0.6 }),
    };
    scene.add(this.group);
    this.peds = Array.from({ length: CAP }, (_, i) => ({
      id: i, x: 0, z: 0, y: 0, yaw: 0, phase: 0, speed: 1, height: 1.72,
      shirt: '#315a78', pants: '#26364b', skin: '#c68a68', edge: null, dir: 1,
      target: null, previousNode: null, stuck: 0, turn: 0, flee: 0, run: 0,
    }));
    this.peds.forEach((p) => this._dress(p));
    this.threats = [];
    this.chase = false;
    this.elapsed = 0;
    this.recenter({ x: 32.2, z: 150 });
  }

  // Pick a look and pre-parse every colour the rig needs (once per agent, not per frame).
  _dress(p) {
    const r = this.lookRng;
    const look = LOOKS[(p.id + (this._lookOffset || 0)) % LOOKS.length];
    const C = (hex) => new THREE.Color(hex);
    p.look = look.name;
    p.width = r.float(look.w[0], look.w[1]);
    if (look.short) p.height = Math.min(p.height, r.float(1.55, 1.68));
    p.hairStyle = r.pick(look.hair);
    p.bag = r.pick(look.bag);
    const skin = C(p.skin), shirt = C(look.suit ? r.pick(['#e8e6e0', '#c9d6e3', '#efe7d6']) : p.shirt);
    const jacket = C(look.suit ? r.pick(['#1e2229', '#2b2f38', '#3a3430']) : r.pick(JACKETS));
    const pants = C(look.suit ? '#1c1f26' : p.pants);
    const top = look.top === 'jacket' ? jacket : shirt;
    p.col = {
      skin, shirt, top, pants,
      upperArm: top,
      forearm: look.top === 'tee' ? skin : top,
      thigh: look.bottom === 'skirt' ? skin : pants,
      shin: look.bottom === 'pants' ? pants : skin,
      skirt: pants,
      hair: C(look.grey ? r.pick(['#8d8a86', '#b5b1aa', '#d4d0c8']) : r.pick(HAIR)),
      shoe: C(look.suit ? '#141414' : r.pick(SHOES)),
      bag: C(r.pick(BAGS)),
      cap: C(r.pick(CAPS)),
    };
    p.jacket = look.top === 'jacket';
    p.skirt = look.bottom === 'skirt';
  }


  _setPose(p, spot, edge = spot.edge, t = spot.t) {
    p.x = spot.x; p.z = spot.z; p.y = spot.y;
    p.edge = edge; p.dir = this.rng.sign();
    const end = p.dir > 0 ? edge.b : edge.a;
    p.target = { x: end.x, z: end.z };
    p.phase = this.rng.float(); p.yaw = Math.atan2(p.target.x - p.x, p.target.z - p.z);
    p.stuck = 0; p.turn = 0; p.flee = 0; p.actualSpeed = 0;
    p.hp = 60; p.hit = 0; p.down = 0;
  }

  _spotNear(x, z, minDistance = 0) {
    let best = null, bd = Infinity;
    for (const spot of this.graph.spots) {
      const d = Math.hypot(spot.x - x, spot.z - z);
      if (d < minDistance || d > 49 || d >= bd || (this.focus && Math.hypot(spot.x - this.focus.x, spot.z - this.focus.z) > 43)) continue;
      if (this.world.vehiclesManager && this.world.vehiclesManager.pushWalker({ x: spot.x, z: spot.z }, RADIUS + 0.2)) continue;
      let occupied = false;
      for (const p of this.peds) if (p !== this._placing && Math.hypot(p.x - spot.x, p.z - spot.z) < 2.1) { occupied = true; break; }
      if (!occupied) { best = spot; bd = d; }
    }
    return best;
  }

  recenter(pos) {
    this.focus = pos;
    for (const p of this.peds) { p.x = 1e6 + p.id * 10; p.z = 1e6; }
    this.threats.length = 0;
    this.elapsed = 0;
    const n = this.peds.length;
    this._lookOffset = Math.floor(this.lookRng.float(0, LOOKS.length));
    for (let i = 0; i < n; i++) {
      const p = this.peds[i];
      const angle = i * Math.PI * (3 - Math.sqrt(5)) + this.rng.float(-0.18, 0.18);
      const radius = 12 + (i % 6) * 5.5 + this.rng.float(-1.5, 1.5);
      const target = { x: pos.x + Math.cos(angle) * radius, z: pos.z + Math.sin(angle) * radius };
      this._placing = p;
      const spot = this._spotNear(target.x, target.z, 2.0) || this._spotNear(pos.x, pos.z);
      if (!spot) continue;
      this._setPose(p, spot);
      p.height = this.rng.float(1.53, 1.91);
      p.speed = p.walkSpeed = this.rng.float(0.82, 1.58);
      p.shirt = this.rng.pick(PALETTE); p.pants = this.rng.pick(PANTS); p.skin = this.rng.pick(SKIN);
      this._dress(p);
    }
    this._placing = null;
    this._writeInstances();
  }

  reset(pos) { this.rng = this.initialRng.fork('reset'); this.chase = false; this.recenter(pos); }

  gunfire(x, z, radius = 38, duration = 4) {
    if (this.threats.length >= 8) this.threats.shift();
    this.threats.push({ x, z, radius, left: duration });
  }

  setChase(active) { this.chase = !!active; }

  damage(p, amount) {
    const damage = Math.min(p.hp, amount);
    if (!damage) return 0;
    p.hp -= damage;
    p.hit = 0.22;
    if (!p.hp) p.down = 8;
    return damage;
  }

  _nextEdge(p) {
    const node = this.graph.nodes.get(key(p.target.x, p.target.z));
    if (!node || !node.links.length) return false;
    let options = node.links.filter((e) => e !== p.edge);
    if (!options.length) options = node.links;
    const edge = this.rng.pick(options);
    p.previousNode = node;
    p.edge = edge;
    p.dir = key(edge.a.x, edge.a.z) === key(node.x, node.z) ? 1 : -1;
    const end = p.dir > 0 ? edge.b : edge.a;
    p.target = { x: end.x, z: end.z };
    return true;
  }


  // Pose every agent into the batches. Per agent: a root frame (position, yaw,
  // and a hit stagger or fall pivoting at the feet), then a pelvis, torso and
  // head frame, and limbs placed joint to joint. Feet: during stance the ankle
  // target moves back at exactly the walking speed (the cycle advances
  // strideOf cycles per metre); late in stance the heel peels up around the
  // planted toe; in swing the foot arcs forward toe-up for heel strike. The
  // hips sit as high as the stance legs can reach (inverted pendulum bob) and
  // two-bone IK bends the knees forward. Arms counter-swing to the legs with a
  // flexing elbow. Standing agents shift weight side to side over planted
  // feet, breathe, sway their arms and look around.
  _writeInstances() {
    const B = this.b;
    for (const m of this.batches) m.n = 0;
    const emit = (m, local, color) => {
      _matrix.multiplyMatrices(_root, local);
      m.setMatrixAt(m.n, _matrix);
      m.setColorAt(m.n, color);
      m.n++;
    };
    const t = this.elapsed;
    const fz = [0, 0], fy = [0, 0], fp = [0, 0];
    for (const p of this.peds) {
      if (!p.col) this._dress(p);
      const c = p.col;
      const s = p.height / 1.72, w = p.width || 1;
      const amp = p.amp || 0, idle = 1 - amp, run = (p.run || 0) * amp;
      const D = dutyOf(p);
      const half = D / (2 * strideOf(p)) * amp;          // half the stance sweep, metres
      const lift = (0.085 + 0.15 * run) * s * amp;
      const L = (THIGH + SHIN) * s;

      // root frame; hits stagger back, the dead fall forward, both pivoting at the feet
      _root.makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
      if (p.down) _root.multiply(_fall.makeRotationX(1.5).setPosition(0, 0.12, 0.15));
      else if (p.hit) _root.multiply(_fall.makeRotationX(-p.hit * 1.6));

      // feet (agent-local: x side, y up, z forward)
      for (let side = 0; side < 2; side++) {
        const u = (p.phase + side * 0.5) % 1;
        let z, y = 0, pitch = 0;
        // the heel peels up around the ball of the foot (0.13 m ahead of the ankle), which stays put
        const peelY = (q) => 0.13 * s * Math.sin(q) - ANK * s * (1 - Math.cos(q));
        const peelZ = (q) => 0.13 * s * (1 - Math.cos(q)) + ANK * s * Math.sin(q);
        const qEnd = 0.55 * amp;
        if (u < D) {
          const k = u / D;
          const q = qEnd * smooth(0.62, 1, k);
          // heel strike: toe up, rocking onto the flat foot about the heel
          const up = 0.22 * amp * (1 - smooth(0, 0.14, k));
          z = half * (1 - 2 * k) + peelZ(q);
          y = peelY(q) + 0.085 * s * Math.sin(up) - ANK * s * (1 - Math.cos(up));
          pitch = up - q;
        } else {
          const k = (u - D) / (1 - D), e = 0.5 - 0.5 * Math.cos(Math.PI * k), off = 1 - smooth(0, 0.4, k);
          const up = 0.22 * amp * smooth(0.6, 1, k);
          z = -half + 2 * half * e + peelZ(qEnd) * off;
          y = lift * Math.sin(Math.PI * Math.min(1, k * 1.15)) + peelY(qEnd) * off + 0.085 * s * Math.sin(up) - ANK * s * (1 - Math.cos(up));
          pitch = up - qEnd * off;
        }
        const rest = side ? -0.045 * s : 0.055 * s;      // idle stance, one foot slightly ahead
        fz[side] = z + rest * idle; fy[side] = y; fp[side] = pitch;
      }
      // hips: lateral weight shift when idle, bob from the reachable height
      const sway = idle * 0.022 * s * Math.sin(t * 0.85 + p.id * 1.9);
      let hy = (L * 0.985 + ANK * s) - 0.05 * run * s + idle * 0.004 * s * Math.sin(t * 1.7 + p.id);
      for (let side = 0; side < 2; side++) {
        const fx = (side ? 1 : -1) * HIP_W * w * s - sway;
        const r2 = (L * 0.995) ** 2 - fz[side] ** 2 - fx * fx;
        hy = Math.min(hy, ANK * s + fy[side] + Math.sqrt(Math.max(0, r2)));
      }
      const swing = Math.sin(2 * Math.PI * p.phase) * amp;
      const lean = p.flee > 0 ? 0.16 : 0.035 * amp + 0.12 * run;
      _euler.set(0, 0.07 * swing, -sway * 1.2, 'YXZ');
      _pelvis.compose(_position.set(sway, hy, 0), _quaternion.setFromEuler(_euler), _scale.set(s * w, s, s));
      emit(B.pelvis, _pelvis, c.pants);
      if (p.skirt) emit(B.skirt, _pelvis, c.skirt);

      const breathe = 1 + idle * 0.018 * Math.sin(t * 1.7 + p.id * 1.3);
      _euler.set(lean, -0.1 * swing, sway * 2.0, 'YXZ');
      _torso.compose(_position.set(sway, hy + WAIST * s, 0), _quaternion.setFromEuler(_euler), _scale.set(s * w, s * breathe, s));
      emit(B.torso, _torso, c.top);
      if (p.jacket) { emit(B.jacket, _torso, c.top); emit(B.shirtfront, _torso, c.shirt); }
      if (p.bag === 'backpack') emit(B.backpack, _torso, c.bag);
      else if (p.bag === 'shoulder') emit(B.shoulderBag, _torso, c.bag);

      const look = idle * 0.42 * Math.sin(t * 0.37 + p.id * 1.7) + 0.1 * swing;
      _v.set(0, NECK_Y, 0).applyMatrix4(_torso);
      _euler.set(-lean * 0.7 + idle * 0.05 * Math.sin(t * 0.23 + p.id), look, -sway * 1.5, 'YXZ');
      _head.compose(_v, _quaternion.setFromEuler(_euler), _scale.set(s, s, s));
      emit(B.head, _head, c.skin);
      const hair = p.hairStyle === 'short' ? B.hairShort : p.hairStyle === 'long' ? B.hairLong : p.hairStyle === 'bun' ? B.hairBun : null;
      if (hair) emit(hair, _head, c.hair);
      else if (p.hairStyle === 'cap') emit(B.cap, _head, c.cap);

      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        // leg
        _v.set(sign * HIP_W, 0, 0).applyMatrix4(_pelvis);
        const hx = _v.x, hY = _v.y, hz = _v.z;
        const ax = sign * HIP_W * w * s, ay = ANK * s + fy[side], az = fz[side];
        solveKnee(_knee, hx, hY, hz, ax, ay, az, THIGH * s, SHIN * s);
        emit(B.thigh, boneMatrix(_local, hx, hY, hz, _knee.x, _knee.y, _knee.z, THIGH, s), c.thigh);
        emit(B.shin, boneMatrix(_local, _knee.x, _knee.y, _knee.z, ax, ay, az, SHIN, s), c.shin);
        _v.set(0, Math.cos(fp[side]), -Math.sin(fp[side]));
        emit(B.shoe, basis(_local, ax, ay, az, _v, s, s, s), c.shoe);

        // arm: forward while the opposite leg is forward
        const opp = half > 1e-4 ? fz[1 - side] / Math.max(1e-3, D / (2 * strideOf(p))) : 0;
        const sw = opp * lerp(0.38, 0.85, run) * amp + idle * 0.035 * Math.sin(t * 0.9 + p.id + side * 2.1) - 0.04;
        const abd = 0.09 + 0.04 * w + idle * 0.015 * Math.sin(t * 1.7 + p.id * 1.3) + (p.bag === 'shoulder' && side ? 0.12 : 0);
        _sh.set(sign * SHOULDER_W, SHOULDER_Y, 0).applyMatrix4(_torso);
        _el.set(sign * Math.sin(abd), -Math.cos(abd) * Math.cos(sw), Math.cos(abd) * Math.sin(sw)).multiplyScalar(UPPER * s).add(_sh);
        const flex = sw + 0.2 + 0.35 * Math.max(0, opp) * amp + 1.15 * run;
        _wr.set(sign * Math.sin(abd * 0.5), -Math.cos(flex), Math.sin(flex)).normalize().multiplyScalar(FORE * s).add(_el);
        emit(B.upperArm, boneMatrix(_local, _sh.x, _sh.y, _sh.z, _el.x, _el.y, _el.z, UPPER, s), c.upperArm);
        emit(B.forearm, boneMatrix(_local, _el.x, _el.y, _el.z, _wr.x, _wr.y, _wr.z, FORE, s), c.forearm);
        // hand continues the forearm, unstretched
        _v.set(_el.x - _wr.x, _el.y - _wr.y, _el.z - _wr.z).normalize();
        emit(B.hand, basis(_local, _wr.x, _wr.y, _wr.z, _v, s, s, s), c.skin);
      }
    }
    for (const m of this.batches) {
      m.count = m.n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }


  update(dt, player, vehicles, carDriving = false) {
    this.focus = player.pos;
    this.elapsed += dt;
    for (let i = this.threats.length - 1; i >= 0; i--) {
      this.threats[i].left -= dt;
      if (this.threats[i].left <= 0) this.threats.splice(i, 1);
    }
    const life = lifeState();
    for (const p of this.peds) {
      p.hit = Math.max(0, p.hit - dt);
      if (p.down > 0) p.down = Math.max(0, p.down - dt);
      if ((!p.hp && !p.down) || Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > 46) {
        this._placing = p;
        const angle = (p.id * 2.3999632297 + this.elapsed * 0.11) % (Math.PI * 2);
        const spot = this._spotNear(player.pos.x + Math.cos(angle) * 30, player.pos.z + Math.sin(angle) * 30, 2.2);
        if (spot) this._setPose(p, spot);
        this._placing = null;
      }
      // A moving car can reach a standing walker between crowd steps. Resolve
      // that contact first, then validate against the static world and neighbours.
      const contact = { x: p.x, z: p.z };
      if (this.world.vehiclesManager?.pushWalker(contact, RADIUS + 0.03, v => this.onContact?.(p, v))) {
        const ground = this.world.groundHeight(contact.x, contact.z);
        if (this.graph.walkableSpot(contact.x, contact.z) && this.peds.every((o) => o === p || Math.hypot(o.x - contact.x, o.z - contact.z) >= 0.61)) {
          p.x = contact.x; p.z = contact.z; p.y = ground;
        } else {
          this._placing = p;
          const spot = this._spotNear(p.x, p.z, 1);
          if (spot) this._setPose(p, spot);
          this._placing = null;
        }
      }
      if (!p.hp || p.hit > 0.08) { p.actualSpeed = 0; continue; }
      const dPlayer = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      let fleeX = 0, fleeZ = 0, fleeing = false, avoidPace = 0;
      for (const t of this.threats) {
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
        if (d < t.radius) { fleeX += dx / Math.max(0.01, d); fleeZ += dz / Math.max(0.01, d); fleeing = true; }
      }
      if (this.chase && dPlayer < 32) {
        fleeX += (p.x - player.pos.x) / Math.max(0.01, dPlayer);
        fleeZ += (p.z - player.pos.z) / Math.max(0.01, dPlayer);
        fleeing = true;
      }
      if (!carDriving && player.speed > 4.1 && dPlayer < 11) {
        fleeX += (p.x - player.pos.x) / Math.max(0.01, dPlayer);
        fleeZ += (p.z - player.pos.z) / Math.max(0.01, dPlayer);
        fleeing = true;
      }
      let carNear = false;
      for (const v of vehicles) {
        const dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz);
        if (d > 4.8 || (v.speed < 2 && d > 2.5)) continue;
        carNear = true;
        fleeX += dx / Math.max(0.01, d); fleeZ += dz / Math.max(0.01, d);
        fleeing = true;
      }
      // PASS 13b: living-world reactions (data from world/life.js), behaviour only.
      const react = reactionFor(p, life);
      if (react.kind === 'flee' || react.kind === 'avoid') {
        fleeX += react.x; fleeZ += react.z; fleeing = true;
        if (react.kind === 'avoid') avoidPace = react.pace;
      } else if (react.kind === 'greet' && !fleeing) {
        p.turn = 0.5; p.yaw = Math.atan2(life.x - p.x, life.z - p.z);
      }

      let tx = p.target.x, tz = p.target.z;
      let pace = p.walkSpeed;
      if (fleeing && (Math.abs(fleeX) + Math.abs(fleeZ) > 0.01)) {
        const l = Math.hypot(fleeX, fleeZ) || 1;
        tx = p.x + fleeX / l * 10; tz = p.z + fleeZ / l * 10; pace = avoidPace || 3.25;
        p.flee = 1.2;
      } else if (p.flee > 0) p.flee = Math.max(0, p.flee - dt);

      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (!fleeing && d < pace * dt + 0.015) {
        this._nextEdge(p);
        continue;
      }
      p.actualSpeed = 0;
      if (p.turn > 0) { p.turn -= dt; continue; }
      if (d > 0.01 && p.speed >= 0) {
        let vx = dx / d * pace * dt, vz = dz / d * pace * dt;
        let next = { x: p.x + vx, z: p.z + vz };
        const oldX = p.x, oldZ = p.z;
        let blocked = false;
        if (this.world.colliders.resolveCircle(next, RADIUS, 0.16, 1.78)) blocked = true;
        if (this.world.vehiclesManager) this.world.vehiclesManager.pushWalker(next, RADIUS);
        // Yield, pause and reverse instead of allowing two bodies to overlap.
        for (const other of this.peds) {
          if (other === p) continue;
          let sx = next.x - other.x, sz = next.z - other.z;
          const sd = Math.hypot(sx, sz);
          if (sd < 0.62) blocked = true;
        }
        if (!this.world.layout.walkable(next.x, next.z)) blocked = true;
        const ground = this.world.groundHeight(next.x, next.z);
        if (this.world.colliders.resolveCircle({ ...next }, RADIUS, ground + 0.02, ground + p.height)) blocked = true;
        if (this.world.vehiclesManager && this.world.vehiclesManager.pushWalker({ ...next }, RADIUS - 0.001)) blocked = true;
        if (!blocked && ground <= 0.16 && Math.hypot(next.x - oldX, next.z - oldZ) < pace * dt * 1.2 + 0.02) {
          p.x = next.x; p.z = next.z; p.y = ground;
          p.actualSpeed = Math.hypot(p.x - oldX, p.z - oldZ) / dt;
          p.yaw = Math.atan2(vx, vz); p.phase = (p.phase + p.actualSpeed * dt * strideOf(p)) % 1;
          p.stuck = Math.max(0, p.stuck - dt * 2);
        } else {
          p.stuck += dt; p.speed = 0;
          if (p.stuck > 0.28) {
            p.turn = 0.45; p.stuck = 0;
            if (!fleeing) {
              const end = Math.hypot(p.target.x - p.edge.a.x, p.target.z - p.edge.a.z) < 0.1 ? p.edge.b : p.edge.a;
              p.target = { ...end };
            }
            p.yaw += this.rng.sign() * 0.65;
          }
        }
      }
      if (carNear && !fleeing) p.speed = Math.min(p.speed, 0.2);
    }
    for (const p of this.peds) p.amp = clamp((p.amp || 0) + clamp((p.actualSpeed > 0.15 ? 1 : 0) - (p.amp || 0), -dt * 5, dt * 5), 0, 1);
    for (const p of this.peds) p.run = clamp((p.run || 0) + clamp((p.actualSpeed > 2.2 ? 1 : 0) - (p.run || 0), -dt * 3, dt * 3), 0, 1);
    this._writeInstances();
  }

  counts() { return { active: this.peds.length, cap: CAP }; }
}
