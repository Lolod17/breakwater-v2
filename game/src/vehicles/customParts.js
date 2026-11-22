// PASS 10c: what a customised car looks like. A garage record (econ/garage.js:
// colour + custom option ids) resolves to a "look": shader numbers carried per
// instance (paint finish, window tint, headlight colour, livery kind + colour),
// the wheel style to draw, a body drop for ride height, and the bolt-on parts
// (spoiler, splitter, skirts, diffuser, underglow). Bolt-ons are a few small shared
// geometries in car space, drawn by VehicleRenderer as one instanced mesh per
// part (only when a car wearing that part is near), so a customised car costs no
// per-frame allocation and at most a handful of extra draws.
import * as THREE from '../../vendor/three.min.js';
import { OPTIONS } from '../econ/customs.js';

const idx = (key, id) => Math.max(0, OPTIONS[key].findIndex((o) => o.id === id));

// shader codes: iCustom = (finish, tint, headlight, livery), iLivery = (rgb, unused)
export const HEAD_TINT = [[1, 1, 1], [0.72, 0.9, 1.35], [1.2, 0.72, 0.18], [0.92, 0.98, 1.12], [0.78, 0.42, 1.4]];
export const GLOW_RGB = { cyan: [0.1, 0.85, 1.0], magenta: [1.0, 0.12, 0.75], lime: [0.5, 1.0, 0.12], amber: [1.0, 0.55, 0.08], white: [0.9, 0.92, 1.0] };
const LIVERY_RGB = { white: '#f2f2ee', black: '#0d0e10', gold: '#c9a227', red: '#c8102e', cyan: '#18c6d8', orange: '#ff6a13' };
const RIDE = { stock: 0, raised: 0.05, lowered: -0.04, slammed: -0.08 };
const KITS = { stock: [], splitter: ['splitter'], sport: ['splitter', 'skirts', 'diffuser'], track: ['splitterTrack', 'skirts', 'diffuserFins'] };
const SPOILERS = { none: [], lip: ['spoilerLip'], wing: ['spoilerWing'], gt: ['spoilerGT'] };

const _c = new THREE.Color();
// record: { colour, custom } from garage.js. Returns null for an all-factory car.
export function lookOf(record) {
  const c = record?.custom;
  if (!c) return null;
  _c.set(LIVERY_RGB[c.liveryColour] ?? '#ffffff');
  const look = {
    finish: idx('finish', c.finish), tint: idx('tint', c.tint), head: idx('head', c.head), livery: idx('livery', c.livery),
    liveryRGB: [_c.r, _c.g, _c.b],
    wheel: c.wheels === 'stock' ? null : c.wheels,
    ride: RIDE[c.ride] ?? 0,
    glow: GLOW_RGB[c.glow] ?? null,
    parts: [...(SPOILERS[c.spoiler] ?? []), ...(KITS[c.aero] ?? [])],
  };
  const plain = !look.finish && !look.tint && !look.head && !look.livery && !look.wheel && !look.ride && !look.glow && !look.parts.length;
  return plain ? null : look;
}

// Dress a street vehicle as its garage record says (paint and look).
export function applyRecord(v, record) {
  v.garageId = record.id;
  v.paint.set(record.colour);
  v.look = lookOf(record);
}

// ---- bolt-on geometry ---------------------------------------------------------
// Built for a nominal 2.0 m wide car; the renderer scales x by width / 2. Origin
// at the part's anchor (see bodyAnchors): deck for spoilers, nose bottom for
// splitters, rear bottom for diffusers, sill bottom (z scaled to the span between
// the arches) for skirts. Surface codes as vehicleModels.js: [rough, metal, paint, lamp].
const KIND = {
  paint: { m: [0.34, 0.3, 1, 0], c: '#ffffff' },
  carbon: { m: [0.28, 0.25, 0, 0], c: '#141518' },
  black: { m: [0.62, 0, 0, 0], c: '#151618' },
};
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function partBuilder() {
  const pos = [], nor = [], col = [], mat = [];
  const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const box = (x, y, z, w, h, d, kind, rx = 0, rz = 0) => {
    const g = unit.clone();
    _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, 0, rz)), _s.set(w, h, d));
    g.applyMatrix4(_m4);
    const k = KIND[kind], cc = new THREE.Color(k.c);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) {
      pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]);
      col.push(cc.r, cc.g, cc.b); mat.push(...k.m);
    }
  };
  const build = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 4));
    g.computeBoundingSphere();
    return g;
  };
  return { box, build };
}

const PARTS = {
  // a kicked-up duck-tail lip along the boot edge
  spoilerLip: { anchor: 'deck', build: (b) => {
    b.box(0, 0.025, -0.16, 1.5, 0.03, 0.14, 'paint', -0.42);
    for (const s of [1, -1]) b.box(s * 0.74, 0.02, -0.16, 0.06, 0.03, 0.12, 'paint', -0.42);
  } },
  // a body-colour blade on two short pedestals
  spoilerWing: { anchor: 'deck', build: (b) => {
    for (const s of [1, -1]) b.box(s * 0.52, 0.09, -0.12, 0.05, 0.18, 0.14, 'paint', 0.2);
    b.box(0, 0.19, -0.16, 1.62, 0.035, 0.26, 'paint', -0.12);
    for (const s of [1, -1]) b.box(s * 0.82, 0.19, -0.16, 0.02, 0.09, 0.3, 'paint');
  } },
  // a tall carbon GT wing: swan-neck uprights, big endplates, gurney flap
  spoilerGT: { anchor: 'deck', build: (b) => {
    for (const s of [1, -1]) {
      b.box(s * 0.4, 0.17, -0.06, 0.035, 0.34, 0.1, 'black', -0.35);
      b.box(s * 0.4, 0.36, -0.15, 0.035, 0.05, 0.16, 'black');
      b.box(s * 0.93, 0.36, -0.2, 0.022, 0.22, 0.42, 'paint');
    }
    b.box(0, 0.39, -0.2, 1.86, 0.03, 0.34, 'carbon', -0.18);
    b.box(0, 0.42, -0.35, 1.86, 0.045, 0.012, 'carbon');
    b.box(0, 0.45, -0.16, 1.8, 0.018, 0.12, 'carbon', -0.32);
  } },
  splitter: { anchor: 'front', build: (b) => {
    b.box(0, -0.01, -0.06, 1.78, 0.025, 0.2, 'carbon');
    b.box(0, 0.015, 0.035, 1.7, 0.03, 0.02, 'carbon');
  } },
  splitterTrack: { anchor: 'front', build: (b) => {
    b.box(0, -0.015, -0.04, 1.9, 0.03, 0.3, 'carbon');
    for (const s of [1, -1]) {
      b.box(s * 0.94, 0.03, -0.06, 0.02, 0.1, 0.28, 'carbon');
      b.box(s * 0.9, 0.14, -0.2, 0.16, 0.012, 0.16, 'carbon', 0, s * 0.25);
      b.box(s * 0.88, 0.22, -0.24, 0.12, 0.012, 0.12, 'carbon', 0, s * 0.3);
    }
  } },
  skirts: { anchor: 'sill', build: (b) => {
    for (const s of [1, -1]) {
      b.box(s * 1.005, 0.0, 0, 0.07, 0.075, 1.0, 'carbon');
      b.box(s * 1.04, -0.03, 0, 0.03, 0.018, 1.0, 'carbon');
    }
  } },
  diffuser: { anchor: 'rear', build: (b) => {
    b.box(0, 0.0, 0.1, 1.36, 0.03, 0.3, 'carbon', -0.18);
    for (let i = 0; i < 4; i++) b.box(-0.45 + i * 0.3, 0.035, 0.08, 0.016, 0.08, 0.26, 'carbon');
  } },
  diffuserFins: { anchor: 'rear', build: (b) => {
    b.box(0, 0.0, 0.12, 1.6, 0.03, 0.36, 'carbon', -0.22);
    for (let i = 0; i < 7; i++) b.box(-0.66 + i * 0.22, 0.06, 0.06, 0.018, 0.14, 0.34, 'carbon');
  } },
};
export const PART_NAMES = Object.keys(PARTS);
export const partAnchor = (name) => PARTS[name].anchor;

export function buildPartGeometry(name) {
  const b = partBuilder();
  PARTS[name].build(b);
  return b.build();
}

// Highest / lowest body surface on a vertical line through (qx, qz), car space.
function column(geo, qx, qz, mode, below = Infinity) {
  const p = geo.attributes.position.array, ix = geo.index?.array;
  let best = mode === 'max' ? -Infinity : Infinity;
  const n = ix ? ix.length : p.length / 3;
  for (let i = 0; i < n; i += 3) {
    const a = (ix ? ix[i] : i) * 3, b = (ix ? ix[i + 1] : i + 1) * 3, c = (ix ? ix[i + 2] : i + 2) * 3;
    const x0 = p[a], z0 = p[a + 2], x1 = p[b], z1 = p[b + 2], x2 = p[c], z2 = p[c + 2];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-9) continue;
    const l0 = ((z1 - z2) * (qx - x2) + (x2 - x1) * (qz - z2)) / d, l1 = ((z2 - z0) * (qx - x2) + (x0 - x2) * (qz - z2)) / d;
    if (l0 < 0 || l1 < 0 || l0 + l1 > 1) continue;
    const y = l0 * p[a + 1] + l1 * p[b + 1] + (1 - l0 - l1) * p[c + 1];
    if (y > below) continue;
    best = mode === 'max' ? Math.max(best, y) : Math.min(best, y);
  }
  return best;
}

// Per-type mounting points, measured once from the type's near body geometry.
export function bodyAnchors(geo, t) {
  const p = geo.attributes.position.array;
  let zF = -Infinity, zR = Infinity;
  for (let i = 2; i < p.length; i += 3) { zF = Math.max(zF, p[i]); zR = Math.min(zR, p[i]); }
  const ride = geo.userData.shade?.ride ?? 0.25;
  const ok = (y, d) => (Number.isFinite(y) ? y : d);
  // low cars: ignore a factory wing or fin above the deck line
  const cap = t.height < 1.36 ? t.height * 0.84 : Infinity;
  const deckZ = zR + 0.3;
  const sill0 = t.rearAxle + t.wheelR + 0.12, sill1 = t.frontAxle - t.wheelR - 0.12;
  return {
    W: t.width, zF, zR,
    deck: [0, ok(column(geo, 0, deckZ, 'max', cap), t.height * 0.7), deckZ],
    front: [0, ok(column(geo, 0, zF - 0.06, 'min'), ride), zF - 0.04],
    rear: [0, ok(column(geo, 0, zR + 0.06, 'min'), ride), zR + 0.04],
    sill: [0, ok(column(geo, t.width / 2 - 0.08, 0, 'min'), ride), (sill0 + sill1) / 2],
    sillLen: Math.max(0.4, sill1 - sill0),
  };
}

// Car-space matrix of a bolt-on on a type (cached by the renderer).
export function partMatrix(name, a) {
  const at = a[PARTS[name].anchor];
  const sx = a.W / 2;
  const sz = PARTS[name].anchor === 'sill' ? a.sillLen : 1;
  return new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]), new THREE.Quaternion(), new THREE.Vector3(sx, 1, sz));
}

// Soft rounded rectangle for the underglow pool (white; tinted per instance).
export function glowTexture() {
  const N = 64, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = Math.abs((x + 0.5) / N * 2 - 1), v = Math.abs((y + 0.5) / N * 2 - 1);
    const d = Math.pow(Math.pow(u, 3) + Math.pow(v, 3), 1 / 3);
    const a = Math.max(0, Math.min(1, (1 - d) / 0.55));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * a * a);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
