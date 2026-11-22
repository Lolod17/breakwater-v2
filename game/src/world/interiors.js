// PASS 11: enterable interiors. Five street doors from the door registry
// (world/doors.js) open into small furnished rooms: the SAFEHOUSE (bed + wardrobe),
// TIDELINE CLOTHING and HARBOUR HARDWARE (the two econ/shop.js shops), BREAKWATER
// CUSTOMS' workshop behind the roller door (econ/garage.js) and THE SALT LANTERN bar.
//
// A room is built only when the player walks in: its own THREE.Scene (one vertex-
// coloured shell mesh, one emissive mesh, one sign, a few lights), drawn under a
// fixed corner camera, and disposed on the way out. While inside, main.js skips the
// street simulation and the street render entirely. The player keeps its controller;
// its `world` is swapped for a tiny room shim (box colliders, flat floor).
//
// On the street the five doors get one merged mesh: a lit doorway and a sign each.
import * as THREE from '../../vendor/three.min.js';
import * as Doors from './doors.js';
import * as Time from '../env/time.js';
import * as Shop from '../econ/shop.js';
import * as Garage from '../econ/garage.js';
import * as Inventory from '../econ/inventory.js';
import { registerSection } from '../save.js';
import { emit } from '../core/events.js';
import { VEHICLE_TYPES } from '../vehicles/vehicleTypes.js';
import { PALETTES } from '../player/character.js';

const USE_R = 1.35;              // interact radius inside a room (m)
const CAM_FOV = 62;
const WAKE_HOUR = 7;
const STILL = { x: 0, z: 0 };

// at: the street spot the door is picked nearest to (the registry has one door per block)
export const KINDS = {
  safehouse: { label: 'SAFEHOUSE', sign: 'NO. 9', kicker: 'HOME', at: [-18, 129], w: 9, d: 8, h: 3.0,
    wall: '#8a7a68', floor: '#6a4a33', trim: '#2b2420', neon: '#ffb46b', lux: 3.0, ambient: 1.2 },
  clothing: { label: 'TIDELINE', sign: 'TIDELINE', kicker: 'CLOTHING', shop: 'clothing', at: [-18, 49], w: 11, d: 9, h: 3.4,
    wall: '#d9d2c5', floor: '#8a8178', trim: '#2a2c31', neon: '#ff5fa2' },
  hardware: { label: 'HARBOUR HARDWARE', sign: 'HARDWARE', kicker: 'TOOLS · PAINT · KEYS', shop: 'hardware', at: [65, 49], w: 11, d: 9, h: 3.4,
    wall: '#8c9a8a', floor: '#6b6a66', trim: '#24302a', neon: '#ffd23f' },
  garage: { label: 'BREAKWATER CUSTOMS', sign: null, kicker: 'WORKSHOP', at: [63.1, 130], w: 14, d: 11, h: 4.4,
    wall: '#7a8088', floor: '#55585d', trim: '#1a1b1e', neon: '#3fe0d0', lux: 3.2, ambient: 1.3 },
  bar: { label: 'THE SALT LANTERN', sign: 'SALT LANTERN', kicker: 'BAR · KITCHEN', at: [144, 129], w: 12, d: 9, h: 3.3,
    wall: '#5a3a34', floor: '#4a3222', trim: '#1a1210', neon: '#ff3b3b', lux: 2.6 },
};
export const KIND_IDS = Object.keys(KINDS);

// ---- wardrobe: owned clothing (econ/shop.js clothing bought into the inventory) ----
const OUTFIT = {
  top: { courier: null, windbreaker: 'windbreaker', jacket: 'jacket' },
  head: { bare: null, cap: 'cap' },
  feet: { trainers: null, boots: 'boots' },
};
const WEAR = [
  { slot: 'top', id: 'courier', name: 'Courier Jacket', note: 'your own' },
  { slot: 'top', id: 'windbreaker', name: 'Windbreaker' },
  { slot: 'top', id: 'jacket', name: 'Denim Jacket' },
  { slot: 'head', id: 'bare', name: 'No Hat', note: 'your own' },
  { slot: 'head', id: 'cap', name: 'Dock Cap' },
  { slot: 'feet', id: 'trainers', name: 'Trainers', note: 'your own' },
  { slot: 'feet', id: 'boots', name: 'Work Boots' },
];
const DEFAULT_OUTFIT = () => ({ top: 'courier', head: 'bare', feet: 'trainers' });
let outfit = DEFAULT_OUTFIT();
let onOutfit = null;
const owns = (slot, id) => { const item = OUTFIT[slot][id]; return item === null || Inventory.has(item); };
const validOutfit = (v) => !!v && typeof v === 'object' && Object.keys(OUTFIT).every((k) => Object.hasOwn(OUTFIT[k], v[k]));
registerSection('wardrobe', {
  defaults: () => DEFAULT_OUTFIT(),
  validate: (v) => (validOutfit(v) ? null : 'outfit'),
  clean: (v) => ({ top: v.top, head: v.head, feet: v.feet }),
  serialize: () => ({ ...outfit }),
  restore: (v) => { outfit = { top: v.top, head: v.head, feet: v.feet }; onOutfit?.(); },
});

// The courier palette with the worn pieces laid over it (pieces no longer owned fall back).
export function outfitPalette(o = outfit) {
  const P = { ...PALETTES.courier };
  const top = owns('top', o.top) ? o.top : 'courier';
  if (top === 'windbreaker') Object.assign(P, { jacket: '#1f6f8b', lining: '#0e3442', accent: '#ffd23f', shirt: '#22262b' });
  if (top === 'jacket') Object.assign(P, { jacket: '#3f5f86', lining: '#24364f', accent: '#d9d4ca', shirt: '#f1ede4' });
  if (o.head === 'cap' && owns('head', 'cap')) Object.assign(P, { cap: '#22344a', accent: top === 'courier' ? '#ff6f61' : P.accent });
  if (o.feet === 'boots' && owns('feet', 'boots')) Object.assign(P, { shoe: '#6b4423', sole: '#1c140d', pants: '#3a3b37' });
  return P;
}
export function wearing() { return { ...outfit }; }
export function resetWardrobe() { outfit = DEFAULT_OUTFIT(); onOutfit?.(); }

// ---- geometry ------------------------------------------------------------------
// Merges unit boxes / cylinders into one vertex-coloured BufferGeometry; boxes
// flagged solid also become room colliders (axis-aligned, below head height).
class Kit {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.solids = []; this._m = new THREE.Matrix4(); this._c = new THREE.Color(); }
  add(g, hex, k = 1) {
    const c = this._c.set(hex).multiplyScalar(k);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) { this.pos.push(P[i], P[i + 1], P[i + 2]); this.nor.push(N[i], N[i + 1], N[i + 2]); this.col.push(c.r, c.g, c.b); }
  }
  // box centred on x/z, sitting on y (bottom), size w × h × d, optional yaw
  box(x, y, z, w, h, d, hex, solid = false, ry = 0) {
    const g = UNIT_BOX.clone().applyMatrix4(this._m.makeRotationY(ry).scale(new THREE.Vector3(w, h, d)).setPosition(x, y + h / 2, z));
    this.add(g, hex);
    if (solid) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      this.solids.push({ x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd });
    }
  }
  cyl(x, y, z, r, h, hex, seg = 14, solid = false, rTop = r) {
    const g = new THREE.CylinderGeometry(rTop, r, h, seg).toNonIndexed().applyMatrix4(this._m.makeTranslation(x, y + h / 2, z));
    this.add(g, hex);
    if (solid) this.solids.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });
  }
  solid(x0, z0, x1, z1) { this.solids.push({ x0, x1, z0, z1 }); }
  // a wheel / drum: cylinder lying along x
  wheel(x, y, z, r, w, hex, seg = 16) {
    const g = new THREE.CylinderGeometry(r, r, w, seg).toNonIndexed().applyMatrix4(this._m.makeRotationZ(Math.PI / 2).setPosition(x, y, z));
    this.add(g, hex);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function signCanvas(text, sub, neon, w = 512, h = 128) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#07080b'; g.fillRect(0, 0, w, h);
  g.strokeStyle = neon; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(h * 0.42)}px Futura, "Arial Black", Arial, sans-serif`;
  g.shadowColor = neon; g.shadowBlur = 16; g.fillStyle = '#fff4e8';
  g.fillText(text, w / 2, sub ? h * 0.42 : h / 2, w - 40);
  if (sub) { g.shadowBlur = 0; g.font = `700 ${Math.round(h * 0.15)}px Futura, Arial, sans-serif`; g.fillStyle = neon; g.fillText(sub, w / 2, h * 0.8, w - 40); }
  return cv;
}

// One room: shell (floor, walls, ceiling, trim, exit door) + the kind's furniture.
function buildRoom(kind, env) {
  const K = KINDS[kind];
  const { w, d, h } = K;
  const hw = w / 2, hd = d / 2;
  const kit = new Kit(), glow = new Kit();
  const doorX = hw / 2;
  // floor: boards / tiles in two alternating tones
  const tile = kind === 'clothing' || kind === 'hardware' || kind === 'garage';
  const step = tile ? 1 : 0.24;
  if (tile) {
    for (let x = -hw; x < hw - 1e-6; x += step) for (let z = -hd; z < hd - 1e-6; z += step) {
      const odd = (Math.round((x + hw) / step) + Math.round((z + hd) / step)) % 2;
      kit.box(x + step / 2, -0.06, z + step / 2, step - 0.015, 0.06, step - 0.015, odd ? K.floor : new THREE.Color(K.floor).multiplyScalar(0.8).getStyle());
    }
  } else {
    for (let x = -hw, i = 0; x < hw - 1e-6; x += step, i++) kit.box(x + step / 2, -0.06, 0, step - 0.012, 0.06, d, new THREE.Color(K.floor).multiplyScalar(0.82 + hash(i) * 0.3).getStyle());
  }
  kit.box(0, -0.12, 0, w + 0.4, 0.06, d + 0.4, '#141414');                                    // grout under the floor
  // walls (outside the walkable box), skirting, a ceiling with a trim band
  kit.box(0, 0, -hd - 0.1, w + 0.4, h, 0.2, K.wall);
  kit.box(-hw - 0.1, 0, 0, 0.2, h, d, K.wall);
  kit.box(hw + 0.1, 0, 0, 0.2, h, d, K.wall);
  kit.box((-hw + doorX - 0.7) / 2 - 0.0, 0, hd + 0.1, doorX - 0.7 + hw, h, 0.2, K.wall);     // front wall left of the door
  kit.box((doorX + 0.7 + hw) / 2, 0, hd + 0.1, hw - doorX - 0.7 + 0.2, h, 0.2, K.wall);       // right of the door
  kit.box(doorX, 2.3, hd + 0.1, 1.4, h - 2.3, 0.2, K.wall);                                   // over the door
  for (const [x, z, ww, dd] of [[0, -hd + 0.02, w, 0.04], [-hw + 0.02, 0, 0.04, d], [hw - 0.02, 0, 0.04, d]]) kit.box(x, 0, z, ww, 0.12, dd, K.trim);
  kit.box(0, h, 0, w + 0.4, 0.12, d + 0.4, '#1c1b1a');
  kit.box(0, h - 0.12, -hd + 0.03, w, 0.12, 0.06, K.trim);
  kit.box(-hw + 0.03, h - 0.12, 0, 0.06, 0.12, d, K.trim);
  kit.box(hw - 0.03, h - 0.12, 0, 0.06, 0.12, d, K.trim);
  // exit door: frame, panel, push bar, a lit EXIT sign and a mat
  kit.box(doorX, 0, hd + 0.02, 1.36, 2.32, 0.08, K.trim);
  kit.box(doorX, 0.04, hd - 0.03, 1.12, 2.2, 0.06, '#3a3632');
  kit.box(doorX, 1.0, hd - 0.08, 0.9, 0.06, 0.05, '#b8b4ae');
  glow.box(doorX, 2.42, hd - 0.05, 0.46, 0.16, 0.04, '#3cff7a');
  kit.box(doorX, 0, hd - 0.9, 1.3, 0.015, 1.0, '#2a2522');
  const use = [{ id: 'exit', x: doorX, z: hd - 0.75, r: 0.9, label: 'Leave', act: 'exit' }];
  const lights = [];
  const lamp = (x, z, color = '#ffd9a8', I = 6, y = h - 0.1) => {         // ceiling pendant: glow disc + point light
    kit.cyl(x, y - 0.42, z, 0.24, 0.24, K.trim, 14, false, 0.06);
    glow.cyl(x, y - 0.44, z, 0.2, 0.03, color, 14);
    lights.push({ x, y: y - 0.6, z, color, I });
  };
  let sign = null;

  if (kind === 'safehouse') {
    // bed against the back wall, left; nightstand and lamp; wardrobe on the right wall
    kit.box(-2.6, 0, -2.75, 1.7, 0.42, 2.2, '#2a211c', true);
    kit.box(-2.6, 0.42, -2.7, 1.6, 0.18, 2.1, '#d8d2c6');
    kit.box(-2.6, 0.6, -2.35, 1.62, 0.06, 1.4, '#3f5f86');                 // blanket
    kit.box(-2.95, 0.6, -3.5, 0.55, 0.12, 0.38, '#efebe3'); kit.box(-2.25, 0.6, -3.5, 0.55, 0.12, 0.38, '#efebe3');
    kit.box(-2.6, 0, -3.88, 1.8, 1.05, 0.08, '#2a211c');                    // headboard
    kit.box(-1.3, 0, -3.6, 0.5, 0.55, 0.45, '#4a3a2e', true);
    kit.cyl(-1.3, 0.55, -3.6, 0.09, 0.3, '#1a1a1a', 10); glow.cyl(-1.3, 0.85, -3.6, 0.16, 0.2, '#ffcf8a', 12, false, 0.1);
    lights.push({ x: -1.3, y: 1.1, z: -3.5, color: '#ffbf75', I: 2.2 });
    kit.box(4.15, 0, -1.6, 0.6, 2.2, 1.6, '#3b2f27', true);                  // wardrobe
    kit.box(3.83, 0.1, -1.98, 0.04, 2.0, 0.76, '#4d3e33'); kit.box(3.83, 0.1, -1.22, 0.04, 2.0, 0.76, '#4d3e33');
    kit.box(3.8, 1.05, -1.66, 0.04, 0.2, 0.03, '#c9b48a'); kit.box(3.8, 1.05, -1.54, 0.04, 0.2, 0.03, '#c9b48a');
    // sofa, low table with a TV unit, rug, kitchenette
    kit.box(-3.95, 0, 1.0, 0.8, 0.45, 2.2, '#5a2e2a', true); kit.box(-4.25, 0.45, 1.0, 0.22, 0.45, 2.2, '#5a2e2a');
    kit.box(-2.6, 0, 1.0, 0.7, 0.38, 1.1, '#2b2420', true);
    kit.box(-1.6, 0.01, 0.6, 3.2, 0.012, 2.4, '#7a2f2b');
    kit.box(0.5, 0, -3.7, 1.8, 0.5, 0.45, '#1e1b19', true); kit.box(0.5, 0.5, -3.78, 1.3, 0.75, 0.06, '#0b0c0e');
    glow.box(0.5, 0.55, -3.74, 1.18, 0.64, 0.01, '#3a6f9a');               // the TV, on
    kit.box(3.6, 0, 2.6, 1.6, 0.9, 0.6, '#c9c3b7', true); kit.box(3.6, 0.9, 2.6, 1.64, 0.04, 0.64, '#2b2b2b');
    kit.box(4.2, 0.94, 2.6, 0.3, 0.3, 0.3, '#b8b4ae'); kit.box(3.3, 0.94, 2.55, 0.4, 0.06, 0.3, '#808890');
    // window with a city glow behind the blinds
    glow.box(-0.5, 1.0, -hd + 0.01, 1.8, 1.2, 0.01, '#ff9a4a');
    for (let i = 0; i < 9; i++) kit.box(-0.5, 1.0 + i * 0.14, -hd + 0.04, 1.84, 0.03, 0.04, '#2b2420');
    lamp(0.2, 0.4, '#ffd9a8', 5);
    use.push({ id: 'bed', x: -1.55, z: -2.6, r: 1.25, label: 'Sleep', act: 'sleep' },
      { id: 'wardrobe', x: 3.4, z: -1.6, r: 1.1, label: 'Wardrobe', act: 'wardrobe' });
  } else if (kind === 'clothing' || kind === 'hardware') {
    const hard = kind === 'hardware';
    // wall shelving down both sides and the back
    for (const side of [-1, 1]) {
      kit.box(side * (hw - 0.05), 0, -0.6, 0.08, 2.4, 6.0, K.trim);                             // back panel
      for (const ez of [-3.58, 2.38]) kit.box(side * (hw - 0.3), 0, ez, 0.55, 2.4, 0.05, K.trim);  // end uprights
      kit.solid(side < 0 ? -hw : hw - 0.6, -3.6, side < 0 ? -hw + 0.6 : hw, 2.4);
      for (let s = 0; s < 4; s++) kit.box(side * (hw - 0.33), 0.21 + s * 0.55, -0.6, 0.55, 0.04, 5.94, hard ? '#9a9a96' : '#c8b89a');
    }
    if (hard) {
      // stock on the side shelves
      for (const side of [-1, 1]) for (let s = 0; s < 4; s++) for (let i = 0; i < 18; i++) {
        const bh = 0.14 + hash(side * 13 + s * 7 + i) * 0.26, bz = -3.4 + i * 0.32;
        kit.box(side * (hw - 0.38), 0.29 + s * 0.55, bz, 0.34, bh, 0.24, ['#c8102e', '#f2a900', '#1d6fa3', '#7d838b', '#2e8b57', '#ff6f00'][Math.floor(hash(i * 3 + s + side) * 6)]);
      }
      // pegboard with tools on the back wall, paint tins, a ladder, timber
      kit.box(-1.5, 0.9, -hd + 0.05, 4.2, 1.6, 0.05, '#b79a6a');
      for (let i = 0; i < 14; i++) kit.box(-3.3 + i * 0.28, 1.2 + hash(i) * 0.7, -hd + 0.1, 0.05, 0.3 + hash(i * 2) * 0.25, 0.04, i % 3 ? '#2a2c30' : '#c8102e');
      for (let i = 0; i < 12; i++) kit.cyl(1.6 + (i % 4) * 0.34, Math.floor(i / 4) * 0.32, -hd + 0.45, 0.14, 0.3, ['#f2a900', '#1d6fa3', '#e8e4dc', '#2e8b57'][i % 4], 12, i < 4);
      for (let i = 0; i < 5; i++) kit.box(4.0, 0.02 + i * 0.4, -hd + 0.6, 0.05, 0.05, 0.6, '#b8b4ae');
      kit.box(3.8, 0, -hd + 0.6, 0.05, 2.0, 0.05, '#b8b4ae'); kit.box(4.2, 0, -hd + 0.6, 0.05, 2.0, 0.05, '#b8b4ae');
      // centre gondola
      kit.box(-0.5, 0, 0.0, 3.2, 1.3, 0.9, '#3a4640', true);
      for (let i = 0; i < 10; i++) kit.box(-1.9 + i * 0.3, 1.3, 0.0, 0.24, 0.1 + hash(i + 40) * 0.25, 0.6, ['#c8102e', '#f2a900', '#7d838b'][i % 3]);
    } else {
      // garment rails with hanging clothes, a table of folded shirts, mirror, mannequins
      for (const side of [-1, 1]) {
        for (let s = 0; s < 3; s++) for (let i = 0; i < 12; i++) {
          const bz = -3.3 + i * 0.5;
          kit.box(side * (hw - 0.38), 0.27 + s * 0.55, bz, 0.4, 0.06 + hash(i + s * 13 + side) * 0.08, 0.36, ['#e8e4dc', '#22344a', '#7a2f2b', '#3f5f86', '#1f6f8b', '#c8b89a'][Math.floor(hash(i * 5 + s + side * 3) * 6)]);
        }
      }
      for (const rz of [-1.6, 0.6]) {
        kit.box(-1.6, 1.45, rz, 2.6, 0.04, 0.04, '#b8b4ae');
        kit.box(-2.9, 0, rz, 0.05, 1.5, 0.05, '#b8b4ae'); kit.box(-0.3, 0, rz, 0.05, 1.5, 0.05, '#b8b4ae');
        kit.box(-1.6, 0, rz, 2.7, 0.04, 0.5, '#b8b4ae', true);
        for (let i = 0; i < 11; i++) kit.box(-2.75 + i * 0.23, 0.55, rz, 0.05, 0.85, 0.48, ['#1f6f8b', '#3f5f86', '#22344a', '#ffd23f', '#e8e4dc', '#7a2f2b'][Math.floor(hash(i + rz * 10) * 6)]);
      }
      kit.box(1.6, 0, -1.0, 1.6, 0.8, 1.0, '#2a2c31', true);
      for (let i = 0; i < 6; i++) kit.box(1.1 + (i % 3) * 0.5, 0.8, -1.25 + Math.floor(i / 3) * 0.5, 0.4, 0.12, 0.34, ['#e8e4dc', '#3f5f86', '#ff5fa2'][i % 3]);
      for (const mx of [0.6, 2.6]) {
        kit.cyl(mx, 0, 1.6, 0.25, 0.04, '#1a1a1a', 14, true); kit.cyl(mx, 0.04, 1.6, 0.03, 0.9, '#1a1a1a', 8);
        kit.box(mx, 0.95, 1.6, 0.42, 0.62, 0.24, mx < 1 ? '#3f5f86' : '#1f6f8b'); kit.cyl(mx, 1.57, 1.6, 0.1, 0.22, '#d9d2c5', 10);
      }
      kit.box(-hw + 0.03, 0.2, 2.9, 0.04, 2.0, 0.9, '#9fb4c2');              // mirror
    }
    // counter with a till near the back, right; a neon sign over it
    kit.box(2.6, 0, -2.7, 2.6, 1.0, 0.7, hard ? '#4a3a2e' : '#e8e4dc', true);
    kit.box(2.6, 1.0, -2.7, 2.7, 0.05, 0.8, hard ? '#2b2420' : '#2a2c31');
    kit.box(3.2, 1.05, -2.8, 0.42, 0.24, 0.34, '#1a1b1e'); glow.box(3.2, 1.2, -2.62, 0.3, 0.08, 0.01, '#3fe0d0');
    kit.box(2.0, 0, -3.8, 0.5, 0.95, 0.4, '#1a1b1e');                         // a shopkeeper behind the counter (simple figure)
    kit.box(2.0, 0.95, -3.8, 0.56, 0.62, 0.34, hard ? '#a24a2a' : '#22344a'); kit.cyl(2.0, 1.57, -3.8, 0.13, 0.26, '#b07a5c', 12);
    sign = { text: K.sign, sub: K.kicker, x: 2.6, y: 2.2, z: -hd + 0.06, w: 2.6, h: 0.65 };
    for (const lx of [-2.5, 2.5]) for (const lz of [-2, 1.6]) lamp(lx, lz, hard ? '#fff1d6' : '#ffe8d0', 4.2);
    use.push({ id: 'counter', x: 2.6, z: -1.75, r: 1.3, label: hard ? 'Browse hardware' : 'Browse clothing', act: 'shop' });
  } else if (kind === 'garage') {
    // lift with a car-shaped body on it, tool chests, tyre stacks, a desk with the parts terminal
    kit.box(-2.2, 0, -1.2, 0.3, 0.12, 4.4, '#ffb000', true); kit.box(0.6, 0, -1.2, 0.3, 0.12, 4.4, '#ffb000', true);
    for (const px of [-2.2, 0.6]) for (const pz of [-3.2, 0.8]) kit.box(px, 0, pz, 0.24, 2.2, 0.24, '#d4d8dd', true);
    kit.box(-0.8, 0.62, -1.2, 1.86, 0.62, 4.3, '#c8102e');                                    // body on the lift
    kit.box(-0.8, 1.24, -1.45, 1.6, 0.5, 2.1, '#c8102e'); kit.box(-0.8, 1.27, -1.45, 1.64, 0.42, 1.9, '#1b2733');   // cabin + glass
    kit.box(-0.8, 0.7, 0.96, 1.7, 0.18, 0.03, '#ffe9c0'); kit.box(-0.8, 0.7, -3.36, 1.7, 0.14, 0.03, '#7a0d12');  // lamps
    for (const wx of [-1.74, 0.14]) for (const wz of [-2.55, 0.15]) { kit.wheel(wx, 0.66, wz, 0.33, 0.24, '#111'); kit.wheel(wx + Math.sign(wx + 0.8) * 0.02, 0.66, wz, 0.2, 0.22, '#9aa1a9'); }
    for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) kit.cyl(-5.8 + i * 0.75, k * 0.24, 3.4, 0.33, 0.22, '#141414', 16, k === 0);
    for (let i = 0; i < 3; i++) {
      kit.box(-6.3, 0, -3.6 + i * 1.2, 0.7, 1.05, 1.0, '#c8102e', true);
      for (let k = 0; k < 4; k++) kit.box(-5.94, 0.15 + k * 0.22, -3.6 + i * 1.2, 0.02, 0.04, 0.6, '#d4d8dd');
    }
    kit.box(4.6, 0, -3.6, 2.0, 0.9, 0.9, '#3a3d42', true); kit.box(4.6, 0.9, -3.6, 2.1, 0.04, 1.0, '#1a1b1e');
    kit.box(4.4, 0.94, -3.75, 0.6, 0.42, 0.06, '#0b0c0e', false, 0.2); glow.box(4.4, 0.97, -3.71, 0.52, 0.34, 0.01, '#3fe0d0');
    kit.box(4.6, 1.25, -hd + 0.06, 2.4, 1.5, 0.04, '#24262a');
    for (let i = 0; i < 6; i++) kit.box(3.6 + i * 0.4, 1.4 + hash(i) * 0.8, -hd + 0.1, 0.25, 0.25, 0.04, ['#ff6a1a', '#00a6c8', '#e8e4dc'][i % 3]);
    kit.box(4.6, 0, 2.2, 0.8, 1.6, 2.2, '#2a2c30', true);                      // roller door frame: the street side is the front wall
    kit.box(-hw + 1, 0.005, 1.6, 6, 0.01, 0.15, '#ffb000'); kit.box(-hw + 1, 0.005, -4.2, 6, 0.01, 0.15, '#ffb000');
    for (const lx of [-3.5, 0, 3.5]) { kit.box(lx, h - 0.25, -1.2, 0.3, 0.06, 2.4, K.trim); glow.box(lx, h - 0.3, -1.2, 0.22, 0.04, 2.3, '#e8f6ff'); lights.push({ x: lx, y: h - 0.6, z: -1.2, color: '#e8f6ff', I: 7 }); }
    use.push({ id: 'terminal', x: 4.4, z: -2.6, r: 1.3, label: 'Garage terminal', act: 'garage' });
    sign = { text: 'CUSTOMS', sub: 'BREAKWATER · PAINT · WHEELS · AERO', x: -0.8, y: 2.9, z: -hd + 0.06, w: 4.0, h: 1.0 };
  } else if (kind === 'bar') {
    // bar counter along the back with stools, a backbar with bottles, booths, a jukebox
    kit.box(0.5, 0, -2.6, 6.6, 1.05, 0.7, '#4a2a1e', true); kit.box(0.5, 1.05, -2.6, 6.8, 0.06, 0.85, '#1a1210');
    glow.box(0.5, 0.06, -2.22, 6.4, 0.03, 0.02, '#ff6a3a');
    for (let i = 0; i < 6; i++) { kit.cyl(-2.2 + i * 1.05, 0, -1.8, 0.05, 0.72, '#8c8c8c', 8); kit.cyl(-2.2 + i * 1.05, 0.72, -1.8, 0.2, 0.08, '#7a2f2b', 14); }
    kit.box(0.5, 0, -hd + 0.25, 6.8, 0.9, 0.45, '#2b1a14');
    for (let s = 0; s < 3; s++) {
      kit.box(0.5, 1.1 + s * 0.45, -hd + 0.18, 6.6, 0.03, 0.3, '#5a3a2a');
      for (let i = 0; i < 22; i++) {
        const c = ['#2e8b57', '#b5651d', '#e8e4dc', '#6b2d5c', '#c8a24a'][Math.floor(hash(i * 3 + s) * 5)];
        kit.cyl(-2.6 + i * 0.29, 1.13 + s * 0.45, -hd + 0.2, 0.045, 0.24 + hash(i + s * 9) * 0.1, c, 8, false, 0.022);
      }
    }
    glow.box(0.5, 1.08, -hd + 0.06, 6.6, 0.02, 0.02, '#ffb46b'); glow.box(0.5, 2.43, -hd + 0.06, 6.6, 0.02, 0.02, '#ffb46b');
    kit.box(-1.6, 0, -3.3, 0.5, 0.95, 0.4, '#1a1b1e'); kit.box(-1.6, 0.95, -3.3, 0.56, 0.62, 0.34, '#e8e4dc'); kit.cyl(-1.6, 1.57, -3.3, 0.13, 0.26, '#9c6a52', 12);
    for (const bz of [0.4, 2.6]) {                                              // booths on the left wall
      kit.box(-4.9, 0, bz - 0.85, 1.6, 1.15, 0.35, '#7a2f2b', true); kit.box(-4.9, 0, bz + 0.85, 1.6, 1.15, 0.35, '#7a2f2b', true);
      kit.box(-4.9, 0, bz - 0.55, 1.6, 0.45, 0.3, '#6a2622'); kit.box(-4.9, 0, bz + 0.55, 1.6, 0.45, 0.3, '#6a2622');
      kit.box(-4.9, 0, bz, 1.3, 0.75, 0.75, '#2b1a14', true);
      glow.cyl(-4.9, 0.75, bz, 0.06, 0.12, '#ffcf8a', 10);
      lights.push({ x: -4.9, y: 1.6, z: bz, color: '#ff9a50', I: 2.4 });
    }
    for (const [tx, tz] of [[-0.6, 1.4], [1.4, 2.9]]) {                          // round tables
      kit.cyl(tx, 0, tz, 0.08, 0.72, '#1a1210', 8, true); kit.cyl(tx, 0.72, tz, 0.45, 0.04, '#3d2a1e', 18);
      for (const a of [0, 2.1, 4.2]) kit.cyl(tx + Math.sin(a) * 0.75, 0, tz + Math.cos(a) * 0.75, 0.18, 0.46, '#5a2e2a', 12, true);
    }
    kit.box(5.4, 0, -0.6, 0.6, 1.5, 0.9, '#3a2010', true);                      // jukebox
    glow.box(5.09, 0.5, -0.6, 0.02, 0.9, 0.7, '#ff5fa2'); glow.box(5.09, 1.42, -0.6, 0.02, 0.06, 0.8, '#3fe0d0');
    lights.push({ x: 4.6, y: 1.2, z: -0.6, color: '#ff5fa2', I: 1.8, juke: true });
    sign = { text: K.sign, sub: 'OPEN LATE', x: -3.6, y: 2.0, z: -hd + 0.06, w: 2.2, h: 0.55 };
    for (const lx of [-1.8, 0.5, 2.8]) lamp(lx, -2.6, '#ffc890', 3.2, h - 0.25);
    use.push({ id: 'bartender', x: -1.6, z: -1.6, r: 1.25, label: 'Talk to the bartender', act: 'talk' },
      { id: 'jukebox', x: 4.6, z: -0.6, r: 1.1, label: 'Jukebox', act: 'jukebox' });
  }

  // ---- assemble -----------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.name = `interior-${kind}`;
  scene.background = new THREE.Color('#050506');
  if (env) { scene.environment = env; scene.environmentIntensity = 0.28; }
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, fog: false });
  const shell = new THREE.Mesh(kit.geometry(), shellMat); shell.name = 'interior-shell';
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6), fog: false });
  const lit = new THREE.Mesh(glow.geometry(), glowMat); lit.name = 'interior-glow';
  scene.add(shell, lit);
  if (sign) {
    const tex = new THREE.CanvasTexture(signCanvas(sign.text, sign.sub, K.neon)); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sign.w, sign.h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2, 2, 2), fog: false }));
    m.position.set(sign.x, sign.y, sign.z); m.name = 'interior-sign';
    scene.add(m);
  }
  scene.add(new THREE.HemisphereLight('#ffe9d2', '#2a2018', K.ambient ?? 1.0));
  for (const L of lights) {
    const p = new THREE.PointLight(L.color, L.I * (K.lux ?? 2.2), Math.max(w, d) * 1.3, 1.5);
    p.position.set(L.x, L.y, L.z);
    if (L.juke) p.name = 'jukebox-light';
    scene.add(p);
  }
  return { kind, scene, solids: kit.solids, use, w, d, h, doorX, entry: { x: doorX, z: hd - 1.75, yaw: Math.PI },
    camera: { x: -hw * 0.3, y: h - 0.3, z: hd - 0.3 } };
}

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
  });
  scene.clear();
}

// Lit doorways + signs on the street, one merged mesh with a canvas atlas.
function buildStreetDoors(sites) {
  const W = 512, ROW = 128;
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = ROW * 8;
  const g = atlas.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, atlas.height);
  // row 0: the doorway texture (a warm lit gap with a dark door frame)
  const grd = g.createLinearGradient(0, 0, 0, ROW);
  grd.addColorStop(0, '#ffcf8a'); grd.addColorStop(1, '#a65a22');
  g.fillStyle = '#16120e'; g.fillRect(0, 0, W, ROW);
  g.fillStyle = grd; g.fillRect(36, 10, W - 72, ROW - 10);
  g.fillStyle = '#2b1d12'; g.fillRect(W / 2 - 4, 10, 8, ROW - 10);
  let row = 1;
  const pos = [], uv = [], idx = [];
  const quad = (cx, cy, cz, nx, nz, w, h, r) => {
    const tx = nz, tz = -nx;              // tangent along the facade
    const base = pos.length / 3;
    const v0 = 1 - (r + 1) / 8 + 0.004, v1 = 1 - r / 8 - 0.004;
    for (const [sx, sy, u, v] of [[-1, -1, 0, v0], [1, -1, 1, v0], [1, 1, 1, v1], [-1, 1, 0, v1]]) {
      pos.push(cx + tx * sx * w / 2 - nx * 0, cy + sy * h / 2, cz + tz * sx * w / 2);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const s of sites) {
    const K = KINDS[s.kind];
    const nx = Math.sin(s.door.yaw), nz = Math.cos(s.door.yaw);
    // door anchors stand 0.9 m out on the pavement; the facade line is behind them
    const fx = s.door.x - nx * 0.86, fz = s.door.z - nz * 0.86;
    if (K.sign) {
      g.drawImage(signCanvas(K.sign, K.kicker, K.neon, W, ROW), 0, row * ROW);
      quad(fx, 3.15, fz, nx, nz, 3.2, 0.8, row++);
      quad(fx, 1.12, fz, nx, nz, 1.5, 2.24, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const tex = new THREE.CanvasTexture(atlas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.9, 1.9, 1.9), fog: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.name = 'interior-doors';
  return mesh;
}

const $el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const BAR_LINES = [
  '"Rain on the breakwater tonight. Good for business, bad for paint jobs."',
  '"Courier, huh? Then you didn\'t see anybody in here. Neither did I."',
  '"The customs boys on the waterfront owe me a favour. Tell them Mara sent you."',
  '"Cops sweep the market after midnight. Sleep it off somewhere quiet."',
  '"House special is salt and lime. Don\'t ask what\'s in the lime."',
];
const JUKE = ['#ff5fa2', '#3fe0d0', '#ffd23f', '#7b5cff'];

export class Interiors {
  // hooks: { player, world, env, syncWallet(), balance(), afterSpend(), slept({ seenEntering }) -> { cleared, saved },
  //          restyle(palette), customise() -> { ok, message } }
  constructor(streetScene, hooks) {
    this.hooks = hooks;
    this.sites = this.assign(Doors.doors());
    this.street = buildStreetDoors(this.sites);
    streetScene.add(this.street);
    this.room = null;          // the loaded room (null on the street)
    this.site = null;          // the street door we came in through
    this.seenEntering = false;
    this.panel = null; this.sel = 0;
    this.near = null;
    this.camLook = new THREE.Vector3();
    this.camYaw = 0;
    this.lastSleep = null;
    this.barLine = 0; this.juke = 0;
    this.shim = {
      groundHeight: () => 0,
      layout: { walkable: (x, z) => !!this.room && Math.abs(x) < this.room.w / 2 - 0.3 && Math.abs(z) < this.room.d / 2 - 0.3 },
      colliders: { resolveCircle: (p, r) => this.resolve(p, r) },
    };
    onOutfit = () => hooks.restyle(outfitPalette());
    this.buildDom();
  }

  // Each kind takes the registry door nearest its street anchor (no door twice).
  assign(list) {
    const used = new Set(), out = [];
    for (const kind of KIND_IDS) {
      const [ax, az] = KINDS[kind].at;
      let best = null, bd = Infinity;
      for (const d of list) { const dd = Math.hypot(d.x - ax, d.z - az); if (!used.has(d.id) && dd < bd) { best = d; bd = dd; } }
      if (!best) continue;
      used.add(best.id);
      out.push({ kind, label: KINDS[kind].label, door: { ...best } });
    }
    return out;
  }

  get inside() { return this.room ? this.room.kind : null; }
  siteAt(x, z) {
    const d = Doors.nearestDoor(x, z, Doors.doorRadius());
    return d ? this.sites.find((s) => s.door.id === d.id) ?? null : null;
  }

  // ---- enter / leave ------------------------------------------------------------
  enter(site, { seen = false } = {}) {
    if (this.room || !site) return false;
    const p = this.hooks.player;
    this.site = site;
    this.seenEntering = !!seen;
    this.room = buildRoom(site.kind, this.hooks.env);
    this.streetWorld = p.world;
    p.world = this.shim;
    this.room.scene.add(p.object, p.blob);
    p.spawn(this.room.entry.x, this.room.entry.z, this.room.entry.yaw);
    const c = this.room.camera;
    this.camLook.set(this.room.entry.x * 0.55, 0.7, (this.room.entry.z - this.room.d * 0.3) * 0.6);
    this.camYaw = Math.atan2(c.x - p.pos.x, c.z - p.pos.z);
    this.closePanel();
    this.prompt(null);
    this.near = null;
    this.elRoom.textContent = `${KINDS[site.kind].kicker} · ${KINDS[site.kind].label}`;
    this.elRoom.hidden = false;
    emit('interior:entered', { kind: site.kind, door: site.door.id, seen: this.seenEntering });
    return true;
  }

  exit(streetScene) {
    if (!this.room) return false;
    const p = this.hooks.player, d = this.site.door, kind = this.room.kind;
    this.closePanel();
    streetScene.add(p.object, p.blob);
    p.world = this.streetWorld;
    disposeScene(this.room.scene);
    this.room = null;
    this.near = null;
    p.spawn(d.x, d.z, d.yaw);
    this.elRoom.hidden = true;
    this.prompt(null);
    emit('interior:left', { kind, door: d.id });
    return { x: d.x, z: d.z, yaw: d.yaw };
  }

  resolve(p, r) {
    if (!this.room) return false;
    let hit = false;
    for (const b of this.room.solids) {
      const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) { const dd = Math.sqrt(d2); p.x = cx + dx / dd * r; p.z = cz + dz / dd * r; }
      else {
        const m = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z], k = m.indexOf(Math.min(...m));
        if (k === 0) p.x = b.x0 - r; else if (k === 1) p.x = b.x1 + r; else if (k === 2) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
    return hit;
  }

  // ---- fixed step inside a room -------------------------------------------------
  // Returns 'exit' when the player walks out through the exit door.
  step(dt, input) {
    const p = this.hooks.player;
    if (this.panel) {
      if (input.tap('ArrowUp', 'KeyW')) this.move(-1);
      else if (input.tap('ArrowDown', 'KeyS')) this.move(1);
      else if (input.tap('Enter', 'KeyE', 'Space', 'NumpadEnter')) this.activate();
      else if (input.tap('Escape', 'Backspace', 'Tab')) this.closePanel();
      if (!this.room) return null;                  // the garage terminal handed the player to the customs menu
      const keep = p.autoWish;                       // stand still while a menu is up
      p.autoWish = keep ?? STILL; p.update(dt, input, this.camYaw); p.autoWish = keep;
      return null;
    }
    p.update(dt, input, this.camYaw);
    const u = this.useAt(p.pos.x, p.pos.z);
    this.near = u;
    this.prompt(u ? u.label : null);
    if (u && input.tap('KeyE')) return this.use(u);
    return null;
  }
  useAt(x, z) {
    if (!this.room) return null;
    let best = null, bd = Infinity;
    for (const u of this.room.use) { const d = Math.hypot(u.x - x, u.z - z); if (d <= (u.r ?? USE_R) && d < bd) { best = u; bd = d; } }
    return best;
  }
  use(u) {
    if (u.act === 'exit') return 'exit';
    if (u.act === 'sleep') { this.sleep(); return null; }
    if (u.act === 'talk') { this.flash(BAR_LINES[this.barLine++ % BAR_LINES.length], 4.5); return null; }
    if (u.act === 'jukebox') {
      this.juke = (this.juke + 1) % JUKE.length;
      this.room.scene.getObjectByName('jukebox-light')?.color.set(JUKE[this.juke]);
      this.flash('The jukebox clunks onto the next record.');
      return null;
    }
    this.openPanel(u.act);
    return null;
  }

  // Sleep until the next morning (07:00) — or 8 hours if that is not 6–12 h away —
  // then the main loop heals, clears wanted heat (only if no police saw us come in) and saves.
  sleep() {
    const from = { day: Time.dayNumber(), minutes: Time.totalMinutes() };
    let mins = ((WAKE_HOUR * 60 - from.minutes) % 1440 + 1440) % 1440;
    if (mins < 360 || mins > 720) mins = 480;
    Time.advance(mins * 20);                         // env/time: 20 simulated seconds per game minute
    const r = this.hooks.slept({ seenEntering: this.seenEntering }) ?? {};
    const to = { day: Time.dayNumber(), minutes: Time.totalMinutes() };
    this.lastSleep = { from, to, hours: +(mins / 60).toFixed(2), cleared: r.cleared ?? 0, saved: !!r.saved, seenEntering: this.seenEntering };
    const hh = `${String(Math.floor(to.minutes / 60)).padStart(2, '0')}:${String(Math.floor(to.minutes % 60)).padStart(2, '0')}`;
    const heat = r.cleared ? ` · ${r.cleared} wanted star${r.cleared > 1 ? 's' : ''} cleared` : r.stillWanted ? ' · the police saw you come in' : '';
    this.fade(`DAY ${to.day} · ${hh}`, `Slept ${Math.round(mins / 6) / 10} h${heat}${r.saved ? ' · game saved' : ''}`);
    emit('interior:slept', this.lastSleep);
    return this.lastSleep;
  }

  // ---- render --------------------------------------------------------------------
  frame(camera, alpha, dt) {
    const p = this.hooks.player, R = this.room;
    p.render(alpha);
    const o = p.object.position;
    const c = R.camera;
    // look at the player, pulled a little toward the room centre so the room stays framed
    const k = 1 - Math.exp(-6 * dt);
    this.camLook.x += (o.x * 0.55 - this.camLook.x) * k;
    this.camLook.y += (0.7 - this.camLook.y) * k;
    this.camLook.z += ((o.z - R.d * 0.3) * 0.6 - this.camLook.z) * k;
    camera.position.set(c.x + o.x * 0.25, c.y, c.z);
    camera.lookAt(this.camLook);
    if (camera.fov !== CAM_FOV) { camera.fov = CAM_FOV; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    this.camYaw = Math.atan2(camera.position.x - p.pos.x, camera.position.z - p.pos.z);
  }

  // ---- DOM: prompt, panel, fade ---------------------------------------------------
  buildDom() {
    const prompt = $el('div'); prompt.id = 'interior-prompt'; prompt.hidden = true;
    prompt.append($el('kbd', null, 'E'), this.elPromptText = $el('span'));
    const room = $el('div'); room.id = 'interior-room'; room.hidden = true;
    const panel = $el('div'); panel.id = 'interior'; panel.hidden = true;
    const head = $el('div', 'i-head');
    this.elKicker = $el('div', 'i-kicker'); this.elTitle = $el('h2'); this.elCash = $el('div', 'i-cash');
    head.append(this.elKicker, this.elTitle, this.elCash);
    this.elList = $el('div', 'i-list');
    this.elMsg = $el('div', 'i-msg');
    const foot = $el('div', 'i-foot');
    foot.innerHTML = '<kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> select · <kbd>Esc</kbd> close';
    panel.append(head, this.elList, this.elMsg, foot);
    const fade = $el('div'); fade.id = 'interior-fade'; fade.hidden = true;
    fade.append(this.elFadeTitle = $el('strong'), this.elFadeText = $el('p'));
    const note = $el('div'); note.id = 'interior-note'; note.hidden = true;
    this.elPrompt = prompt; this.elRoom = room; this.elPanel = panel; this.elFade = fade; this.elNote = note;
    document.body.append(prompt, room, panel, fade, note);
  }
  prompt(text) {
    const t = text ?? '';
    if (t === this._prompt) return;
    this._prompt = t;
    this.elPrompt.hidden = !t;
    this.elPromptText.textContent = t;
  }
  showStreetPrompt(site) { this.prompt(site ? `Enter ${site.label}` : null); }
  flash(text, seconds = 2.6) {
    this.elNote.textContent = text; this.elNote.hidden = false;
    clearTimeout(this._noteT); this._noteT = setTimeout(() => { this.elNote.hidden = true; }, seconds * 1000);
  }
  fade(title, text) {
    this.elFadeTitle.textContent = title; this.elFadeText.textContent = text;
    const f = this.elFade; f.hidden = false; f.classList.remove('play'); void f.offsetWidth; f.classList.add('play');
    clearTimeout(this._fadeT); this._fadeT = setTimeout(() => { f.hidden = true; }, 3200);
  }

  openPanel(kind) {
    this.panel = kind; this.sel = 0;
    this.elPanel.hidden = false;
    this.prompt(null);
    this.message('');
    this.renderPanel();
  }
  closePanel() { this.panel = null; this.elPanel.hidden = true; }
  message(t, bad = false) { this.elMsg.textContent = t; this.elMsg.classList.toggle('bad', bad); }
  move(dir) { const n = this.rows().length; if (n) { this.sel = (this.sel + dir + n) % n; this.renderPanel(); } }
  activate(i = this.sel) { const r = this.rows()[i]; if (r && !r.disabled && r.act) { this.sel = i; r.act(); this.renderPanel(); } }

  rows() {
    const H = this.hooks;
    if (this.panel === 'shop') {
      const shopId = KINDS[this.room.kind].shop;
      return Shop.items(shopId).map((it) => ({
        label: it.name, detail: it.stock > 0 ? `${it.stock} in stock` : 'sold out', price: it.price === null ? 'REFUSED' : money(it.price),
        disabled: it.stock <= 0 || it.price === null,
        act: () => {
          H.syncWallet();
          const ok = Shop.buy(shopId, it.id);
          H.afterSpend();
          this.message(ok ? `Bought ${it.name} for ${money(it.price)}.${shopId === 'clothing' ? ' Wear it from the safehouse wardrobe.' : ''}`
            : it.price !== null && H.balance() < it.price ? `Not enough cash for the ${it.name}.` : `The ${it.name} is not for sale.`, !ok);
        },
      }));
    }
    if (this.panel === 'wardrobe') {
      return WEAR.map((wi) => {
        const own = owns(wi.slot, wi.id), on = outfit[wi.slot] === wi.id;
        return { label: wi.name, detail: `${wi.slot.toUpperCase()}${wi.note ? ' · ' + wi.note : ''}`, price: on ? 'WEARING' : own ? 'WEAR' : 'NOT OWNED',
          disabled: !own, act: () => this.equip(wi.slot, wi.id) };
      });
    }
    if (this.panel === 'garage') {
      const cars = Garage.list(), act = Garage.active();
      const rows = [{ label: 'Customise your car', detail: 'paint · wheels · aero · lights · livery', price: 'OPEN',
        act: () => { const r = H.customise(); if (!r.ok) this.message(r.message, true); } }];
      if (!cars.length) rows.push({ label: 'No cars on the books', detail: 'customise a car once to register it', price: '', disabled: true });
      for (const c of cars) {
        rows.push({ label: VEHICLE_TYPES[c.typeId]?.label ?? c.typeId, detail: `${c.id} · ${c.stored ? 'stored' : 'on the street'}${c.id === act ? ' · your car' : ''}`,
          price: '', swatch: c.colour, disabled: true });
      }
      return rows;
    }
    return [];
  }

  equip(slot, id) {
    if (!Object.hasOwn(OUTFIT[slot] ?? {}, id) || !owns(slot, id)) return false;
    if (outfit[slot] === id) return true;
    outfit = { ...outfit, [slot]: id };
    this.hooks.restyle(outfitPalette());
    this.message(`Wearing: ${WEAR.find((w) => w.slot === slot && w.id === id).name}.`);
    emit('interior:outfit', { ...outfit });
    return true;
  }

  renderPanel() {
    if (!this.panel || !this.room) return;
    const K = KINDS[this.room.kind];
    const titles = { shop: K.label, wardrobe: 'WARDROBE', garage: 'GARAGE' };
    this.elKicker.textContent = this.panel === 'wardrobe' ? 'SAFEHOUSE' : K.kicker;
    this.elTitle.textContent = titles[this.panel];
    this.elCash.textContent = money(this.hooks.balance());
    const rows = this.rows();
    this.elList.replaceChildren(...rows.map((r, i) => {
      const el = $el('div', 'i-row' + (i === this.sel ? ' sel' : '') + (r.disabled ? ' off' : ''));
      const sw = $el('span', 'i-swatch'); if (r.swatch) sw.style.background = r.swatch; else sw.style.visibility = 'hidden';
      el.append(sw, $el('span', 'i-name', r.label), $el('span', 'i-detail', r.detail), $el('span', 'i-price', r.price));
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', (e) => { e.stopPropagation(); this.sel = i; this.activate(i); this.renderPanel(); });
      return el;
    }));
  }

  // tool view
  state() {
    return { inside: this.inside, door: this.site?.door.id ?? null, panel: this.panel, sel: this.sel, near: this.near?.id ?? null,
      rows: this.panel ? this.rows().map((r) => ({ label: r.label, price: r.price, disabled: !!r.disabled })) : [],
      seenEntering: this.seenEntering, outfit: wearing(), lastSleep: this.lastSleep,
      loaded: this.room ? { objects: this.room.scene.children.length, solids: this.room.solids.length, use: this.room.use.map((u) => ({ id: u.id, x: u.x, z: u.z })) } : null,
      sites: this.sites.map((s) => ({ kind: s.kind, label: s.label, door: s.door })) };
  }
}
