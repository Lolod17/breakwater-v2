// Procedural vehicle models. Each type is one merged geometry built in car space
// (+z forward, +x left, y up, origin at road level under the centre of mass):
// an extruded lower body with real wheel arches, a tapered greenhouse with flush
// glass, chrome window surround, satin-black sills, grille and bumper inserts,
// recessed headlamps under a dark brow, lit tail strips, amber indicators,
// mirrors on stalks, wipers, antennas, plates, handles and exhaust tips. The
// whole shell is then warped (plan-view corner rounding + tumblehome) so it does
// not read as a box. Per-vertex aMat codes pick roughness, metalness, paint and
// lamp kind; geometry.userData.shade carries the per-type numbers the shader
// uses for cavity darkening and panel lines (vehicleMaterial.js).
// Wheels come in a few styles (WHEEL_STYLES), each one shared geometry with the
// detailed face outboard.
// PASS 10a1: eight sports-collection bodies (hyper / super / sports / muscle /
// luxury), wheel styles, and a distance LOD: the same builders run with
// PartBuilder.lod set, which drops small trim, lowers curve and bevel segments
// and skips the panel-detail passes, for cars beyond the renderer's LOD range.
// PASS 10a2: thirteen more collection bodies (21 in all), a third LOD level (lod 2,
// "low": only panels, big parts and the lamps survive) and a hollow cabin for the new
// bodies: frame plates round see-through ('clear') glass over a cockpit (5 flagships)
// or a simple dashboard. Distance levels fall back to the solid greenhouse.
import * as THREE from '../../vendor/three.min.js';
import { LAMP } from './vehicleMaterial.js';
import { VEHICLE_TYPES } from './vehicleTypes.js';

const C = (hex) => new THREE.Color(hex);
// surface codes: [roughness, metalness, paintMask, lampKind]
const S = {
  paint: [0.34, 0.3, 1, 0], glass: [0.05, 0.0, 0, LAMP.glass], tint: [0.05, 0.0, 0, LAMP.glass], trim: [0.55, 0.0, 0, 0],
  black: [0.62, 0.0, 0, 0], housing: [0.18, 0.25, 0, 0], chrome: [0.12, 1.0, 0, 0], brushed: [0.32, 0.9, 0, 0],
  rubber: [0.9, 0.0, 0, 0], dark: [0.5, 0.15, 0, 0], plate: [0.5, 0.1, 0, LAMP.plate], white: [0.36, 0.1, 0, 0],
  head: [0.06, 0.4, 0, LAMP.head], drl: [0.1, 0.2, 0, LAMP.head], tail: [0.18, 0.1, 0, LAMP.tail], brake: [0.18, 0.1, 0, LAMP.brake],
  reverse: [0.12, 0.3, 0, LAMP.reverse], red: [0.15, 0.1, 0, LAMP.sirenRed], blue: [0.15, 0.1, 0, LAMP.sirenBlue],
  amber: [0.18, 0.1, 0, LAMP.amber], rim: [0.26, 1.0, 0, 0], under: [0.9, 0.0, 0, 0],
  clear: [0.05, 0.0, 0, LAMP.clear], leather: [0.7, 0.0, 0, 0], gauge: [0.25, 0.0, 0, LAMP.plate],
  rimDark: [0.3, 0.85, 0, 0], rimGun: [0.28, 0.9, 0, 0], rimBronze: [0.3, 0.9, 0, 0],
};
const COL = {
  paint: C('#ffffff'), glass: C('#0b1016'), tint: C('#05070a'), trim: C('#18191b'), black: C('#151618'), housing: C('#0c0d0f'),
  chrome: C('#d6d9dd'), brushed: C('#9a9ea4'), rubber: C('#0d0d0e'), dark: C('#1c1e21'), plate: C('#e9e6d8'), white: C('#eef0f2'),
  head: C('#e8eef6'), drl: C('#dfe8f4'), tail: C('#4a0709'), brake: C('#4a0709'), reverse: C('#d9dadc'),
  red: C('#70100f'), blue: C('#0d1f78'), amber: C('#8a4a05'), rim: C('#c4c8cd'), under: C('#08090a'),
  rimDark: C('#2c2e33'), rimGun: C('#6a6e74'), rimBronze: C('#9a7440'),
  clear: C('#0b1016'), leather: C('#1d1e21'), gauge: C('#b9cbe6'),
};
// kinds that stay in the LOD even when small (they glow, or are glass)
const LIT = new Set(['head', 'drl', 'tail', 'brake', 'reverse', 'red', 'blue', 'amber', 'glass', 'tint', 'clear']);
let LOD = 0;   // set while a distance-LOD body is being built: 1 simplified, 2 low

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

class PartBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.mat = []; this.lod = LOD; }

  add(geo, matrix, kind, color) {
    if (this.lod && kind === 'clear') kind = 'glass';   // distance levels: no see-through glass
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal;
    _n3.getNormalMatrix(matrix);
    const c = color || COL[kind], m = S[kind];
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(c.r, c.g, c.b);
      this.mat.push(m[0], m[1], m[2], m[3]);
    }
    return this;
  }

  // box by centre/size with optional rotation (radians about x, y, z)
  box(cx, cy, cz, sx, sy, sz, kind, { rx = 0, ry = 0, rz = 0, color } = {}) {
    if (this.lod) {
      const big = Math.max(sx, sy, sz);
      if (kind === 'trim' || big < 0.1 || (big < 0.25 && !LIT.has(kind))) return this;
      if (this.lod >= 2 && (LIT.has(kind) ? big < 0.14 : big < 0.32)) return this;
    }
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_v.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    return this.add(unitBox, _m.clone(), kind, color);
  }

  // the same box on both sides (x and -x)
  pair(cx, cy, cz, sx, sy, sz, kind, opts = {}) {
    this.box(cx, cy, cz, sx, sy, sz, kind, opts);
    return this.box(-cx, cy, cz, sx, sy, sz, kind, { ...opts, ry: -(opts.ry || 0), rz: -(opts.rz || 0) });
  }

  // cylinder along an axis
  cyl(cx, cy, cz, r, len, axis, kind, seg = 12, color) {
    if (this.lod) { if (r < 0.1 && !LIT.has(kind)) return this; seg = Math.max(6, seg >> 1); }
    if (this.lod >= 2) { if (LIT.has(kind) ? r < 0.05 : r < 0.2) return this; seg = Math.max(5, seg >> 1); }
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    _m.makeTranslation(cx, cy, cz);
    return this.add(g, _m.clone(), kind, color);
  }

  // quad from four corners; flipped if needed so its normal points along `out`
  quad(a, b, c, d, out, kind) {
    const g = new THREE.BufferGeometry();
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    const pts = n.dot(out) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.computeVertexNormals();
    return this.add(g, new THREE.Matrix4(), kind);
  }

  // Extrude a side-profile shape (drawn in z,y) across the car between x0..x1.
  // taper: [y0, y1, k] narrows the part linearly to factor k between heights y0..y1.
  side(shape, width, kind, { x = 0, bevel = 0.05, bevelSize = 0.03, taper, curve = 8, crease = 38, segs = 3 } = {}) {
    if (this.lod) { curve = Math.min(curve, this.lod >= 2 ? 2 : 3); segs = 1; }
    const depth = Math.max(0.002, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel > 0 ? bevelSize : 0, bevelSegments: segs, curveSegments: curve,
    });
    g.rotateY(-Math.PI / 2);
    g.translate(depth / 2 + x, 0, 0);
    if (taper) taperX(g, taper, x);
    smoothNormals(g, crease);
    return this.add(g, new THREE.Matrix4(), kind);
  }

  // Plan-view corner rounding and tumblehome for the whole shell: x' = x * k(y, z).
  // Normals follow the warp exactly (inverse-transpose of its Jacobian).
  warp(fn) {
    const P = this.pos, N = this.nor, e = 1e-3;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const k = fn(y, z), ky = (fn(y + e, z) - fn(y - e, z)) / (2 * e), kz = (fn(y, z + e) - fn(y, z - e)) / (2 * e);
      P[i] = x * k;
      const nx = N[i] / k, ny = N[i + 1] - x * ky * N[i] / k, nz = N[i + 2] - x * kz * N[i] / k;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[i] = nx / l; N[i + 1] = ny / l; N[i + 2] = nz / l;
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function taperX(g, [y0, y1, k], cx = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    p.setX(i, cx + (p.getX(i) - cx) * (1 + (k - 1) * t));
  }
}
// Smooth vertex normals across edges flatter than `crease` degrees (non-indexed geometry).
function smoothNormals(g, crease = 38) {
  const P = g.attributes.position;
  const n = P.count, fn = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
    b.sub(a); c.sub(a); b.cross(c);
    const l = b.length() || 1;
    for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = b.x / l; fn[(i + k) * 3 + 1] = b.y / l; fn[(i + k) * 3 + 2] = b.z / l; }
  }
  const key = (i) => `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let gr = groups.get(k); if (!gr) groups.set(k, gr = []); gr.push(i); }
  const cosC = Math.cos(crease * Math.PI / 180), out = new Float32Array(n * 3);
  for (const gr of groups.values()) {
    for (const i of gr) {
      let x = 0, y = 0, z = 0;
      for (const j of gr) {
        const d = fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2];
        if (d >= cosC) { x += fn[j * 3]; y += fn[j * 3 + 1]; z += fn[j * 3 + 2]; }
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}
const taperAt = ([y0, y1, k], y) => 1 + (k - 1) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));

// Lower body silhouette: `top` runs from the front-bottom corner over the bonnet,
// roof line or deck to the rear-bottom corner; the sill runs back to the front
// with a semicircular arch over each axle.
// drop: when the sill sits below the hub, run the opening straight down to the
// sill instead of ramping the sill up to the hub (a real arch, PASS 10a1 bodies).
function bodyShape(top, rideY, arches, wheelR, drop = false) {
  const s = new THREE.Shape();
  s.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) s.lineTo(top[i][0], top[i][1]);
  for (const [az, ar] of [...arches].sort((p, q) => p[0] - q[0])) {
    const th = rideY > wheelR ? Math.asin(Math.min(0.95, (rideY - wheelR) / ar)) : 0;
    if (drop && rideY < wheelR) s.lineTo(az - ar, rideY);
    s.lineTo(az - ar * Math.cos(th), Math.max(rideY, wheelR));
    s.absarc(az, wheelR, ar, Math.PI - th, th, true);
    s.lineTo(az + ar * Math.cos(th), rideY);
  }
  s.closePath();
  return s;
}
const poly = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((p) => s.lineTo(p[0], p[1])); s.closePath(); return s; };

// Inset a convex polygon (z,y points, either winding) by d.
function inset(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n]; area += x0 * y1 - x1 * y0; }
  const sgn = area > 0 ? 1 : -1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    const nx = -dy / l * sgn, ny = dx / l * sgn; // inward normal
    return [p[0] + nx * d, p[1] + ny * d, dx, dy];
  });
  return lines.map((L, i) => {
    const P = lines[(i + n - 1) % n];
    const den = P[2] * L[3] - P[3] * L[2];
    if (Math.abs(den) < 1e-9) return [L[0], L[1]];
    const t = ((L[0] - P[0]) * L[3] - (L[1] - P[1]) * L[2]) / den;
    return [P[0] + P[2] * t, P[1] + P[3] * t];
  });
}
// Clip a convex polygon to z within [zMin, zMax].
function clipZ(pts, zMin, zMax) {
  const clip = (ps, keep, edge) => {
    const out = [];
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i], b = ps[(i + 1) % ps.length];
      const ka = keep(a[0]), kb = keep(b[0]);
      if (ka) out.push(a);
      if (ka !== kb) { const t = (edge - a[0]) / (b[0] - a[0]); out.push([edge, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  let r = clip(pts, (z) => z >= zMin, zMin);
  if (r.length >= 3) r = clip(r, (z) => z <= zMax, zMax);
  return r.length >= 3 ? r : null;
}


// Greenhouse: painted frame, flush side glass split at blacked-out pillars, a
// bright (chrome) or black window-line trim along the bottom and top of the
// glass, windscreen and back glass, and wiper arms lying on the windscreen.
// hollow (PASS 10a2, full LOD only): no solid cabin block; a roof slab and pillar
// frame plates round 'clear' side glass and windscreen, and a dark bulkhead behind
// the back glass, so the cockpit inside can be seen.
function greenhouse(b, { prof, width, taper, splits = [], zMin = -99, zMax = 99, pillar = 0.075, front = true, back = true,
  dlo = 'chrome', wipers = true, rearGlass = 'glass', hollow = false, roofKind = 'paint' }) {
  const open = hollow && !b.lod, sideGlass = open ? 'clear' : 'glass';
  if (!open) {
    b.side(poly(prof), width, 'paint', { bevel: 0.045, bevelSize: 0.0, taper, crease: 50 });
    if (roofKind !== 'paint') {
      const ry = prof[1][1];
      b.box(0, ry + 0.004, (prof[1][0] + prof[2][0]) / 2, width * taperAt(taper, ry) - 0.06, 0.012, prof[1][0] - prof[2][0] - 0.04, roofKind);
    }
  }
  const win = inset(prof, pillar);
  const cuts = [zMin, ...[...splits].sort((p, q) => p - q).flatMap((z) => [z - 0.05, z + 0.05]), zMax];
  const hw = (y) => (width / 2) * taperAt(taper, y);
  const panes = [];
  for (let i = 0; i < cuts.length; i += 2) {
    const part = clipZ(win, cuts[i], cuts[i + 1]);
    if (!part) continue;
    const kind = i >= cuts.length - 2 && splits.length >= 2 ? (open && rearGlass === 'glass' ? 'clear' : rearGlass) : sideGlass;
    panes.push(part);
    for (const sx of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(poly(part), { depth: 0.012, bevelEnabled: false, curveSegments: 1 });
      g.rotateY(-Math.PI / 2);
      g.translate(sx * (width / 2 + 0.004) + 0.006, 0, 0);
      taperX(g, taper, 0);
      b.add(g, new THREE.Matrix4(), kind);
    }
  }
  if (open) {
    // roof slab: the top of the profile above the glass
    const y0 = prof[1][1] - 0.05, at = (p, q) => p[0] + (q[0] - p[0]) * (y0 - p[1]) / (q[1] - p[1]);
    b.side(poly([[at(prof[0], prof[1]), y0], prof[1], prof[2], [at(prof[3], prof[2]), y0]]), width, roofKind, { bevel: 0.03, bevelSize: 0, taper, crease: 50 });
    // side frames: the profile with the window panes cut out, as thin plates on both flanks
    const frame = poly(prof);
    for (const part of panes) frame.holes.push(new THREE.Path(part.map(([z, y]) => new THREE.Vector2(z, y))));
    const d = pillar + 0.012;
    for (const sx of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(frame, { depth: d, bevelEnabled: false, curveSegments: 1 });
      g.rotateY(-Math.PI / 2);
      g.translate(sx > 0 ? width / 2 : -width / 2 + d, 0, 0);
      taperX(g, taper, 0);
      b.add(g, new THREE.Matrix4(), 'paint');
    }
  }
  // B/C pillar blackout between the panes
  const yb = win[0][1], yt = Math.max(...win.map((p) => p[1]));
  for (const z of splits) {
    const ym = (yb + yt) / 2;
    b.pair(hw(ym) + 0.01, ym, z, 0.012, yt - yb, 0.11, 'black', { rz: -Math.atan2(hw(yt) - hw(yb), yt - yb) });
  }
  // window-line trim (the thin bright edge round the glass)
  if (dlo) {
    const zb0 = Math.max(zMin, Math.min(win[0][0], win[win.length - 1][0])), zb1 = Math.min(zMax, Math.max(win[0][0], win[win.length - 1][0]));
    if (zb1 > zb0) b.pair(hw(yb) + 0.016, yb - 0.008, (zb0 + zb1) / 2, 0.02, 0.022, zb1 - zb0, dlo);
    const zt0 = Math.max(zMin, Math.min(win[1][0], win[2][0])), zt1 = Math.min(zMax, Math.max(win[1][0], win[2][0]));
    if (zt1 > zt0) b.pair(hw(yt) + 0.012, yt + 0.006, (zt0 + zt1) / 2, 0.016, 0.016, zt1 - zt0, dlo);
  }
  // windscreen (edge prof[0] -> prof[1]) and back glass (edge prof[2] -> prof[3])
  const slab = (p, q, kind, off = 0.012, flip = 1) => {
    const hw0 = hw(p[1]) - pillar, hw1 = hw(q[1]) - pillar;
    const dz = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dz, dy);
    const tz = dz / l, ty = dy / l;
    let nz = ty, ny = -tz;
    if (ny < 0) { nz = -nz; ny = -ny; }
    const a0 = [p[0] + tz * 0.05 + nz * off, p[1] + ty * 0.05 + ny * off], a1 = [q[0] - tz * 0.05 + nz * off, q[1] - ty * 0.05 + ny * off];
    b.quad(new THREE.Vector3(hw0, a0[1], a0[0]), new THREE.Vector3(-hw0, a0[1], a0[0]), new THREE.Vector3(-hw1, a1[1], a1[0]), new THREE.Vector3(hw1, a1[1], a1[0]),
      new THREE.Vector3(0, ny * flip, nz * flip), kind);
    return { a0, tz, ty, nz, ny, hw0 };
  };
  if (front) {
    const w = slab(prof[0], prof[1], open ? 'clear' : 'glass');
    if (wipers && !b.lod) {
      const ang = Math.atan2(w.nz, w.ny);
      for (const [x, len] of [[0.28, Math.min(0.62, w.hw0 * 0.75)], [-0.3, Math.min(0.55, w.hw0 * 0.68)]]) {
        const cz = w.a0[0] + w.tz * 0.07 + w.nz * 0.012, cy = w.a0[1] + w.ty * 0.07 + w.ny * 0.012;
        b.box(x, cy, cz, len, 0.012, 0.022, 'black', { rx: ang, ry: 0, rz: 0 });
      }
    }
  }
  if (back) {
    slab(prof[prof.length - 1], prof[prof.length - 2], open && rearGlass === 'glass' ? 'clear' : rearGlass);
    if (open && rearGlass !== 'glass') slab(prof[prof.length - 1], prof[prof.length - 2], 'black', -0.03, -1);   // bulkhead, seen from inside
  }
}

// Cabin interior seen through the clear glass (full LOD only). The driver sits on +x
// (the driver-door side). y: cabin floor (the belt), dashZ: windscreen base, seatZ:
// seat-back z, top: roof height (seats are cut to fit), w: dash width.
// simple: dash slab with a binnacle, steering wheel on its column, two plain seats.
// full: lit gauges and centre screen, vents, console and selector, a three-spoke
// wheel with paddles, bolstered seats with an accent stripe (harness straps on
// track cars), a rear-view mirror.
function cockpit(b, { y, dashZ, seatZ, top, w, x = 0.38, sw = 0.46, full = false, accent = '#8a1c1c', harness = false, mirrorZ = null }) {
  if (b.lod) return;
  const hide = C(full ? '#2b2320' : '#17181b'), acc = C(accent), dark = C('#141518');
  const hSeat = Math.max(0.22, Math.min(0.62, (top - y) * 0.8)), lean = -0.2;
  b.box(0, y + 0.006, (dashZ + seatZ) / 2 - 0.05, w, 0.012, dashZ - seatZ + 0.4, 'dark', { color: C('#0f1012') });
  b.box(0, y + 0.06, dashZ - 0.15, w, 0.12, 0.3, 'dark', { color: dark });
  b.box(x, y + 0.13, dashZ - 0.27, 0.36, 0.05, 0.14, 'black');                         // binnacle hood
  const wy = y + Math.min(0.22, hSeat * 0.62), wz = dashZ - 0.46;
  const ring = new THREE.TorusGeometry(0.17, 0.022, 5, 18);
  ring.rotateX(0.4);
  b.add(ring, new THREE.Matrix4().makeTranslation(x, wy, wz), 'black');
  b.box(x, wy + 0.02, wz + 0.14, 0.05, 0.05, 0.26, 'black', { rx: 0.4 });            // column
  const seat = (sx) => {
    const sxp = sx * x;
    b.box(sxp, y + 0.05 + hSeat / 2, seatZ, sw, hSeat, 0.11, 'leather', { rx: lean, color: hide });
    b.box(sxp, y + 0.05, seatZ + 0.26, sw, 0.1, 0.46, 'leather', { color: hide });
    if (full) {
      for (const dx of [sw / 2 - 0.02, 0.02 - sw / 2]) b.box(sxp + dx, y + 0.05 + hSeat * 0.45, seatZ + 0.04, 0.06, hSeat * 0.82, 0.17, 'leather', { rx: lean, color: hide });
      b.box(sxp, y + 0.05 + hSeat * 0.5, seatZ + 0.058, 0.08, hSeat * 0.86, 0.012, 'leather', { rx: lean, color: acc });
      if (harness) for (const dx of [0.1, -0.1]) b.box(sxp + dx, y + 0.08 + hSeat * 0.5, seatZ + 0.068, 0.045, hSeat * 0.9, 0.008, 'leather', { rx: lean, color: acc });
    }
  };
  seat(1); seat(-1);
  if (!full) return;
  for (const dx of [0.075, -0.075]) {
    b.cyl(x + dx, y + 0.11, dashZ - 0.335, 0.055, 0.012, 'z', 'housing', 14);
    b.cyl(x + dx, y + 0.11, dashZ - 0.343, 0.046, 0.006, 'z', 'gauge', 14);
  }
  b.box(0, y + 0.15, dashZ - 0.24, 0.24, 0.13, 0.014, 'gauge', { rx: -0.35, color: C('#5d7fb0') });   // centre screen
  for (const vx of [0.12, -0.12, w / 2 - 0.08, -(w / 2 - 0.08)]) b.cyl(vx, y + 0.09, dashZ - 0.302, 0.035, 0.02, 'z', 'chrome', 10);
  b.box(0, y + 0.1, seatZ + 0.42, 0.2, 0.18, 0.62, 'dark', { color: dark });           // console
  b.box(0, y + 0.191, seatZ + 0.42, 0.04, 0.004, 0.5, 'leather', { color: acc });
  b.cyl(0, y + 0.24, seatZ + 0.52, 0.012, 0.1, 'y', 'chrome', 6);
  b.box(0, y + 0.3, seatZ + 0.52, 0.04, 0.03, 0.05, 'black');
  // three-spoke wheel: hub, spokes, paddles behind the rim
  b.box(x, wy, wz + 0.005, 0.08, 0.08, 0.03, 'black', { rx: 0.4 });
  for (const dx of [0.09, -0.09]) b.box(x + dx, wy, wz, 0.15, 0.03, 0.02, 'brushed', { rx: 0.4 });
  b.box(x, wy - 0.085 * Math.cos(0.4), wz - 0.085 * Math.sin(0.4), 0.03, 0.15, 0.02, 'brushed', { rx: 0.4 });
  for (const dx of [0.2, -0.2]) b.box(x + dx, wy + 0.03, wz + 0.04, 0.05, 0.08, 0.012, 'brushed', { rx: 0.4 });
  if (mirrorZ != null) b.box(0, top - 0.08, mirrorZ, 0.22, 0.06, 0.02, 'black');
}
// The cockpit fitted to a greenhouse profile: floor on the belt, dash just behind
// the windscreen, seats far enough back to clear the wheel, sized to the canopy.
function cabin(b, t, prof, width, opts = {}) {
  const [p0, p1, p2] = prof, y = p0[1];
  const at = (yy) => p0[0] + (p1[0] - p0[0]) * (yy - p0[1]) / (p1[1] - p0[1]);
  const dashZ = at(y + 0.13);
  cockpit(b, { y, dashZ, seatZ: Math.min(p2[0] + 0.22, dashZ - 1.0), top: p1[1] - 0.05, w: width * 0.8,
    x: Math.min(0.38, width * 0.25), sw: Math.min(0.46, width * 0.29), full: t.cabin === 'full', mirrorZ: p1[0] - 0.1, ...opts });
}
// Rear wheel spat: the upper half of the arch closed over with a painted panel.
function spats(b, t, W, extra = 0.05) {
  const [az, ar] = arches(t, extra)[1];
  const s = new THREE.Shape();
  s.moveTo(az + ar, t.wheelR + 0.06);
  s.absarc(az, t.wheelR + 0.06, ar, 0, Math.PI, false);
  s.closePath();
  for (const sx of [1, -1]) b.side(s, 0.03, 'paint', { x: sx * (W / 2 - 0.012), bevel: 0, curve: 10, crease: 50 });
}
// Hexagonal exhaust tip (Moray SV).
function hexPipe(b, x, y, z, r) {
  const g = new THREE.CylinderGeometry(r, r, 0.16, 6); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 6);
  b.add(g, new THREE.Matrix4().makeTranslation(x, y, z), 'chrome');
  b.cyl(x, y, z - 0.081, r * 0.75, 0.004, 'z', 'under', 6);
}

// Shared detail kit -------------------------------------------------------------
// Headlamp: lens set back under a projecting dark brow, lower lip, DRL strip,
// amber indicator at the outer corner and a side repeater on the wing.
function headlamps(b, W, y, z, { w = 0.38, h = 0.12, inset: ins = 0.14, drl = true, repeater = null, proj = 2 } = {}) {
  const x = W / 2 - ins - w / 2;
  b.pair(x, y, z - 0.035, w, h, 0.07, 'head');
  // projector units: a chrome reflector cup round each lit lens, standing out of
  // the lamp face so the lamp has depth and reads as lamps at any light level
  const r = Math.min(h * 0.4, w / (proj * 2.3));
  for (let i = 0; i < proj; i++) {
    const px = x + (proj === 1 ? 0 : (i / (proj - 1) - 0.5) * (w - 2.4 * r));
    for (const sx of [1, -1]) {
      b.cyl(sx * px, y + 0.005, z + 0.004, r, 0.018, 'z', 'chrome', 10);
      b.cyl(sx * px, y + 0.005, z + 0.012, r * 0.68, 0.012, 'z', 'head', 10);
    }
  }
  b.pair(x, y + h / 2 + 0.014, z - 0.01, w + 0.04, 0.032, 0.09, 'housing');
  b.pair(x, y - h / 2 - 0.009, z - 0.02, w + 0.03, 0.018, 0.07, 'housing');
  b.pair(x - w / 2 - 0.012, y, z - 0.02, 0.024, h + 0.02, 0.07, 'housing');
  if (drl) b.pair(x, y - h / 2 + 0.014, z + 0.003, w * 0.86, 0.016, 0.012, 'drl');
  b.pair(x + w / 2 + 0.04, y - 0.01, z - 0.05, 0.07, h * 0.65, 0.07, 'amber');
  if (repeater) b.pair(W / 2 + 0.006, repeater[0], repeater[1], 0.012, 0.028, 0.075, 'amber');
}
// Tail cluster: lit outer lens, a brake segment proud of it, reverse and indicator
// below, in a gloss-black housing; optional full-width light bar and third brake.
function tailLamps(b, W, y, z, { w = 0.4, h = 0.13, ins = 0.06, bar = false, third = null, wrap = 0 } = {}) {
  const x = W / 2 - ins - w / 2;
  if (wrap) {
    // the lens wraps round the rear corner onto the flank, in its own black surround
    b.pair(W / 2 - 0.006, y + h * 0.1, z + wrap / 2 + 0.01, 0.026, h + 0.02, wrap + 0.02, 'housing');
    b.pair(W / 2 + 0.002, y + h * 0.18, z + wrap / 2 + 0.01, 0.024, h * 0.62, wrap - 0.01, 'tail');
    b.pair(W / 2 - 0.012 - ins / 2, y + h * 0.1, z + 0.01, ins + 0.02, h + 0.02, 0.05, 'housing');
  }
  b.pair(x, y, z + 0.02, w + 0.03, h + 0.03, 0.05, 'housing');
  b.pair(x, y + h * 0.18, z - 0.006, w, h * 0.62, 0.05, 'tail');
  b.pair(x + w * 0.12, y + h * 0.18, z - 0.014, w * 0.55, h * 0.4, 0.04, 'brake');
  b.pair(x - w * 0.27, y - h * 0.3, z - 0.004, w * 0.42, h * 0.32, 0.05, 'reverse');
  b.pair(x + w * 0.24, y - h * 0.3, z - 0.004, w * 0.46, h * 0.32, 0.05, 'amber');
  if (bar) b.box(0, y + h * 0.18, z - 0.004, W - 2 * (ins + w) - 0.02, h * 0.22, 0.04, 'tail');
  if (third) b.box(0, third[0], third[1], 0.36, 0.035, 0.04, 'brake');
}
function plates(b, yF, zF, yR, zR, front = true) {
  if (front) { b.box(0, yF, zF + 0.012, 0.52, 0.12, 0.016, 'plate'); b.box(0, yF, zF, 0.56, 0.15, 0.012, 'black'); }
  b.box(0, yR, zR - 0.012, 0.52, 0.12, 0.016, 'plate');
  b.box(0, yR + 0.075, zR - 0.02, 0.2, 0.02, 0.03, 'chrome'); // plate lamp / boot handle
}
// Door mirror on a black stalk: housing in body colour, mirror glass facing back.
function mirrors(b, W, y, z, size = 1, kind = 'paint') {
  const hx = W / 2;
  b.pair(hx + 0.05 * size, y - 0.02, z + 0.02, 0.1 * size, 0.035, 0.06, 'black');
  b.pair(hx + 0.15 * size, y + 0.03, z, 0.18 * size, 0.12 * size, 0.09 * size, kind);
  b.pair(hx + 0.15 * size, y + 0.03, z - 0.046 * size, 0.16 * size, 0.1 * size, 0.006, 'chrome');
}
function handles(b, W, y, zs) { for (const z of zs) b.pair(W / 2 + 0.008, y, z, 0.02, 0.03, 0.15, 'chrome'); }
function sills(b, W, y, z0, z1, h = 0.1) { b.pair(W / 2 + 0.006, y, (z0 + z1) / 2, 0.03, h, z1 - z0, 'black'); }
function antenna(b, x, y, z, len = 0.42, rake = -0.35) { b.box(x, y + len / 2 * Math.cos(rake), z + len / 2 * Math.sin(rake), 0.008, len, 0.008, 'black', { rx: -rake }); b.box(x, y + 0.01, z, 0.03, 0.02, 0.05, 'black'); }
function finAntenna(b, y, z) { b.box(0, y + 0.03, z, 0.05, 0.06, 0.16, 'black', { rx: 0.15 }); }
function exhaust(b, x, y, z, r = 0.04) { b.cyl(x, y, z, r, 0.16, 'z', 'chrome', 8); b.cyl(x, y, z - 0.081, r * 0.72, 0.004, 'z', 'under', 8); }
function arches(t, extra = 0.06) {
  const r = t.wheelR + extra;
  const out = [[t.frontAxle, r]];
  if (t.rearTandem) out.push([t.rearAxle + t.rearTandem / 2, r], [t.rearAxle - t.rearTandem / 2, r]);
  else out.push([t.rearAxle, r]);
  return out;
}
// arch liners: dark inner wheel-well faces so the arches read as openings
function archLiners(b, t, W, ride, extra = 0.06) {
  for (const [z, r] of arches(t, extra)) {
    const g = new THREE.CylinderGeometry(r - 0.005, r - 0.005, W - 0.36, b.lod ? (b.lod >= 2 ? 4 : 6) : 12, 1, true, -Math.PI / 2, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 1, 1);
    b.add(g, new THREE.Matrix4().makeTranslation(0, t.wheelR, z), 'under');
  }
}

// Body detail kit (PASS 6b) ----------------------------------------------------
// Height of the lower-body top line at z (linear along the profile polyline;
// the extrude bevel lifts the centre of the panel by bevelSize above it).
function profY(top, z) {
  for (let i = 0; i < top.length - 1; i++) {
    const [z0, y0] = top[i], [z1, y1] = top[i + 1];
    if ((z - z0) * (z - z1) <= 0 && z0 !== z1) return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
  }
  return top[0][1];
}
// Character line: a shallow triangular rib along the flank between z0..z1 whose
// top facet faces the sky and bottom facet the road, so the side breaks into a
// lit upper band and a shaded lower band instead of reading as one slab. The rib
// fades to nothing at both ends so it melts into the panel.
function crease(b, W, y, z0, z1, { d = 0.016, h = 0.05, rise = 0, kind = 'paint' } = {}) {
  if (b.lod) return;
  const s = new THREE.Shape();
  s.moveTo(0, h / 2); s.lineTo(0, -h / 2); s.lineTo(d, -h * 0.12); s.closePath();
  const len = z1 - z0, fade = Math.min(0.45, len * 0.25);
  for (const sx of [1, -1]) {
    const g = new THREE.ExtrudeGeometry(s, { depth: len, steps: 8, bevelEnabled: false, curveSegments: 1 });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const lz = p.getZ(i), u = Math.min(lz, len - lz) / fade;
      const k = Math.min(1, Math.max(0.05, u));
      const x = p.getX(i) * k;
      p.setXYZ(i, sx * (W / 2 - 0.004 + x), y + p.getY(i) + rise * (lz / len - 0.5), z0 + lz);
    }
    g.computeVertexNormals();
    b.add(g, new THREE.Matrix4(), kind);
  }
}
// Wheel-arch lip: a rolled painted (or black-clad) band round each opening,
// standing proud of the flank so the arch reads as a pressed edge, not a hole
// cut in a slab.
function archLips(b, t, W, ride, extra = 0.06, { band = 0.045, proud = 0.022, kind = 'paint', pick = null } = {}) {
  if (b.lod && kind === 'paint') return;
  for (const [az, ar] of arches(t, extra).filter((_, i) => !pick || pick.includes(i))) {
    const th = ride > t.wheelR ? Math.asin(Math.min(0.95, (ride - t.wheelR) / ar)) : 0;
    const r0 = ar - 0.004, r1 = ar + band;
    const s = new THREE.Shape();
    s.moveTo(az + r1 * Math.cos(th), t.wheelR + r1 * Math.sin(th));
    s.absarc(az, t.wheelR, r1, th, Math.PI - th, false);
    s.lineTo(az - r0 * Math.cos(th), t.wheelR + r0 * Math.sin(th));
    s.absarc(az, t.wheelR, r0, Math.PI - th, th, true);
    s.closePath();
    for (const sx of [1, -1]) b.side(s, 0.05, kind, { x: sx * (W / 2 - 0.025 + proud), bevel: 0, curve: 10, crease: 50 });
  }
}
// Door / wing shut gaps cut into the flank at each z, from y0 to y1.
// A gap that falls over a wheel opening starts above the arch lip.
function shutGaps(b, t, W, zs, y0, y1, extra = 0.06, band = 0.045) {
  if (b.lod) return;
  for (const z of zs) {
    let lo = y0;
    for (const [az, ar] of arches(t, extra)) {
      const R = ar + band + 0.02;
      if (Math.abs(z - az) < R) lo = Math.max(lo, t.wheelR + Math.sqrt(R * R - (z - az) ** 2));
    }
    if (y1 - lo > 0.08) b.pair(W / 2 + 0.002, (lo + y1) / 2, z, 0.008, y1 - lo, 0.011, 'trim');
  }
}
// Shut lines lying on a top panel (bonnet / boot lid): a gap following the
// profile polyline between z0..z1 at +-x, plus optional cross gaps at zs.
function topGaps(b, top, lift, x, z0, z1, zs = [], halfW = x) {
  if (b.lod) return;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n;
    const ya = profY(top, za) + lift, yb = profY(top, zb) + lift;
    b.pair(x, (ya + yb) / 2 + 0.002, (za + zb) / 2, 0.011, 0.008, Math.hypot(zb - za, yb - ya) + 0.004, 'trim', { rx: -Math.atan2(yb - ya, zb - za) });
  }
  for (const z of zs) b.box(0, profY(top, z) + lift + 0.002, z, 2 * halfW, 0.008, 0.011, 'trim');
}

// The plan/tumblehome warp for a shell: rounded corners of radius rf/rr in plan
// at the nose and tail, body sides leaning in above the shoulder and tucked under.
function shellWarp({ W, zF, zR, rf, rr, ride, shoulder, tumble = 0.035, tuck = 0.03 }) {
  const half = W / 2;
  const plan = (z) => {
    let t = 0, r = 0;
    if (z > zF - rf) { t = (z - (zF - rf)) / rf; r = rf; } else if (z < zR + rr) { t = ((zR + rr) - z) / rr; r = rr; }
    if (!r) return 1;
    t = Math.min(0.96, t);
    return (half - r + r * Math.sqrt(1 - t * t)) / half;
  };
  const sm = (a, c, x) => { const u = Math.min(1, Math.max(0, (x - a) / (c - a))); return u * u * (3 - 2 * u); };
  return (y, z) => plan(z) * (1 - tumble * sm(shoulder - 0.15, shoulder + 0.25, y)) * (1 - tuck * (1 - sm(ride, ride + 0.28, y)));
}

// Types -------------------------------------------------------------------------
function sedan(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.3, belt = 0.93, roof = t.height - 0.02, bs = 0.05;
  // fastback-leaning notchback: low nose, bonnet rising to the cowl, short high boot
  const top = [[zF - 0.02, ride], [zF + 0.03, 0.46], [zF - 0.01, 0.66], [zF - 0.22, 0.76], [zF - 0.6, 0.8], [0.95, belt - 0.01], [-1.5, belt + 0.01],
    [zR + 0.3, belt + 0.03], [zR + 0.04, belt - 0.03], [zR - 0.02, 0.62], [zR + 0.0, 0.42], [zR + 0.04, ride]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride);
  archLips(b, t, W, ride);
  // shoulder line rising toward the tail, and a lower door scallop rising toward the nose
  crease(b, W, belt - 0.13, zR + 0.22, zF - 0.42, { d: 0.024, h: 0.065, rise: -0.035 });
  const fa = arches(t)[0], ra = arches(t)[1];
  crease(b, W, ride + 0.2, t.rearAxle + ra[1] + 0.1, t.frontAxle - fa[1] - 0.08, { d: 0.011, h: 0.04, rise: 0.025 });
  shutGaps(b, t, W, [0.9, -0.42, -1.48], ride + 0.1, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.17, 0.98, zF - 0.16, [zF - 0.16], W / 2 - 0.17);   // bonnet
  topGaps(b, top, bs, W / 2 - 0.2, zR + 0.12, -1.66, [zR + 0.12], W / 2 - 0.2);     // boot lid
  const prof = [[0.95, belt], [0.1, roof], [-0.98, roof], [-1.74, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.16, taper: [belt, roof, 0.84], splits: [-0.42], zMax: 0.9, zMin: -1.52 });
  // lower: black valance and grille in the bumper, plates, sills
  b.box(0, 0.37, zF - 0.02, W - 0.5, 0.11, 0.08, 'black');
  b.box(0, 0.6, zF - 0.015, 0.66, 0.11, 0.07, 'black');
  b.box(0, 0.6, zF + 0.022, 0.7, 0.014, 0.01, 'chrome');
  b.box(0, 0.36, zR + 0.03, W - 0.6, 0.08, 0.08, 'black');
  headlamps(b, W, 0.665, zF - 0.04, { w: 0.36, h: 0.1, inset: 0.13, repeater: [0.72, t.frontAxle + 0.55] });
  tailLamps(b, W, 0.8, zR + 0.03, { w: 0.4, h: 0.12, ins: 0.05, bar: true, third: [belt + 0.07, -1.68], wrap: 0.2 });
  plates(b, 0.42, zF, 0.6, zR);
  mirrors(b, W - 0.08, belt + 0.03, 0.82);
  handles(b, W, belt - 0.11, [0.1, -0.82]);
  sills(b, W, ride + 0.07, t.rearAxle + t.wheelR + 0.12, t.frontAxle - t.wheelR - 0.12);
  exhaust(b, W / 2 - 0.42, ride + 0.03, zR + 0.04);
  antenna(b, -0.25, roof - 0.005, -0.95, 0.36);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.42, rr: 0.32, ride, shoulder: 0.78 }),
    shade: { ride, belt, seams: [0.9, -0.42, -1.48], seamY: [ride + 0.12, belt - 0.03], arch: arches(t)[0][1] } };
}

// Patrol cruiser: its own body, not a liveried sedan. A squared-off, upright
// three-box: blunt vertical nose, tall flat bonnet, near-upright screen, long
// flat boot deck and a square tail, small corner radii, steel push bar.
function police(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.32, belt = 0.97, roof = t.height - 0.02, bs = 0.03;
  const top = [[zF - 0.02, ride], [zF + 0.02, 0.5], [zF + 0.01, 0.8], [zF - 0.1, 0.87], [1.02, 0.93], [-1.55, belt + 0.01],
    [zR + 0.12, belt + 0.02], [zR + 0.01, belt - 0.03], [zR - 0.01, 0.5], [zR + 0.04, ride]];
  b.side(bodyShape(top, ride, arches(t, 0.07), t.wheelR), W, 'paint', { bevel: 0.06, bevelSize: bs });
  archLiners(b, t, W, ride, 0.07);
  archLips(b, t, W, ride, 0.07, { band: 0.05, proud: 0.018 });
  crease(b, W, belt - 0.09, zR + 0.12, zF - 0.15, { d: 0.02, h: 0.045 });             // flat, level beltline rib
  const prof = [[0.98, belt], [0.32, roof], [-0.92, roof], [-1.5, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.14, taper: [belt, roof, 0.88], splits: [-0.38], zMax: 0.93, zMin: -1.42, dlo: 'black' });
  shutGaps(b, t, W, [0.95, -0.38, -1.42], ride + 0.1, belt - 0.06, 0.07, 0.05);
  topGaps(b, top, bs, W / 2 - 0.14, 1.06, zF - 0.1, [zF - 0.1], W / 2 - 0.14);
  topGaps(b, top, bs, W / 2 - 0.16, zR + 0.1, -1.58, [zR + 0.1], W / 2 - 0.16);
  // front: wide black grille with a bright surround, square lamps, steel bumpers
  b.box(0, 0.68, zF - 0.01, 0.92, 0.16, 0.06, 'black');
  b.box(0, 0.77, zF + 0.016, 0.96, 0.018, 0.012, 'chrome');
  b.box(0, 0.59, zF + 0.016, 0.96, 0.018, 0.012, 'chrome');
  b.box(0, ride + 0.1, zF + 0.0, W - 0.06, 0.16, 0.12, 'dark');
  b.box(0, ride + 0.1, zR - 0.0, W - 0.06, 0.16, 0.12, 'dark');
  headlamps(b, W, 0.69, zF - 0.03, { w: 0.3, h: 0.13, inset: 0.08, proj: 1, drl: false, repeater: [0.76, t.frontAxle + 0.55] });
  tailLamps(b, W, 0.82, zR + 0.03, { w: 0.34, h: 0.16, ins: 0.04, third: [belt + 0.07, -1.47], wrap: 0.12 });
  plates(b, 0.5, zF + 0.06, 0.66, zR);
  mirrors(b, W - 0.08, belt + 0.03, 0.85);
  handles(b, W, belt - 0.11, [0.15, -0.8]);
  sills(b, W, ride + 0.07, t.rearAxle + t.wheelR + 0.14, t.frontAxle - t.wheelR - 0.14);
  exhaust(b, W / 2 - 0.4, ride + 0.02, zR + 0.06, 0.045);
  antenna(b, 0.3, roof - 0.005, -0.75, 0.6);
  antenna(b, -0.3, belt + 0.02, -2.1, 0.5, -0.1);
  // livery: white doors with a black band, light bar, push bar, A-pillar spotlights
  b.pair(W / 2 + 0.006, (ride + 0.16 + belt - 0.06) / 2, -0.24, 0.01, belt - 0.22 - ride, 2.2, 'white');
  b.pair(W / 2 + 0.012, belt - 0.21, -0.24, 0.008, 0.07, 2.2, 'black');
  b.box(0, roof + 0.045, -0.3, 1.25, 0.06, 0.3, 'black');
  b.box(0.31, roof + 0.11, -0.3, 0.56, 0.08, 0.26, 'red');
  b.box(-0.31, roof + 0.11, -0.3, 0.56, 0.08, 0.26, 'blue');
  b.box(0, roof + 0.11, -0.3, 0.06, 0.085, 0.27, 'black');
  for (const sx of [1, -1]) {
    b.box(sx * 0.42, 0.58, zF + 0.17, 0.06, 0.52, 0.06, 'black');
    b.box(sx * 0.42, 0.62, zF + 0.09, 0.05, 0.05, 0.18, 'black');
  }
  b.box(0, 0.76, zF + 0.17, 0.9, 0.06, 0.06, 'black');
  b.box(0, 0.46, zF + 0.17, 0.9, 0.06, 0.06, 'black');
  b.pair(W / 2 - 0.02, belt + 0.12, 0.62, 0.08, 0.08, 0.12, 'chrome');
  b.pair(0.25, 0.44, zF + 0.19, 0.12, 0.06, 0.02, 'blue');
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.22, rr: 0.16, ride, shoulder: 0.85, tumble: 0.02 }),
    shade: { ride, belt, seams: [0.95, -0.38, -1.42], seamY: [ride + 0.12, belt - 0.03], arch: arches(t, 0.07)[0][1] } };
}

function sports(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.17, belt = 0.8, roof = t.height - 0.01;
  b.side(bodyShape([[zF - 0.05, ride], [zF + 0.02, 0.34], [zF - 0.04, 0.5], [zF - 0.3, 0.6], [1.3, 0.67], [0.5, belt - 0.03], [-1.95, belt + 0.02],
    [zR + 0.1, belt + 0.03], [zR - 0.02, 0.7], [zR - 0.02, 0.44], [zR + 0.06, ride]], ride, arches(t, 0.05), t.wheelR), W, 'paint', { bevel: 0.12, bevelSize: 0.05 });
  // flared haunches over the rear wheels: wider than the cabin, the stance of the car
  const haunch = bodyShape([[t.rearAxle + 0.75, belt - 0.16], [t.rearAxle + 0.3, belt - 0.01], [t.rearAxle - 0.45, belt - 0.01], [t.rearAxle - 0.66, belt - 0.2]],
    ride + 0.22, [[t.rearAxle, t.wheelR + 0.05]], t.wheelR);
  b.side(haunch, 0.16, 'paint', { x: W / 2 - 0.02, bevel: 0.06, bevelSize: 0.03 });   // x is the slab centre
  b.side(haunch, 0.16, 'paint', { x: -W / 2 + 0.02, bevel: 0.06, bevelSize: 0.03 });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.04, proud: 0.03, pick: [0] });
  // blade line: from behind the front wheel, rising into the rear haunch
  crease(b, W, 0.42, t.rearAxle + 0.75, t.frontAxle - 0.5, { d: 0.022, h: 0.06, rise: -0.1 });
  shutGaps(b, t, W, [0.42, -1.02], ride + 0.1, belt - 0.08, 0.05, 0.04);
  const prof = [[0.45, belt], [-0.4, roof], [-0.92, roof], [-1.95, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.34, taper: [belt, roof, 0.78], zMin: -1.25, zMax: 0.4, pillar: 0.07, dlo: 'black', rearGlass: 'tint' });
  b.box(0, 0.24, zF - 0.04, W - 0.16, 0.12, 0.14, 'black');          // splitter
  b.box(0, 0.36, zF - 0.01, 1.05, 0.12, 0.06, 'black');              // intake
  b.box(0, 0.26, zR + 0.07, W - 0.2, 0.16, 0.14, 'black');           // diffuser
  for (let i = -2; i <= 2; i++) b.box(i * 0.2, 0.2, zR + 0.0, 0.02, 0.1, 0.14, 'black');
  headlamps(b, W, 0.52, zF - 0.14, { w: 0.36, h: 0.07, inset: 0.1, proj: 3, repeater: [0.58, t.frontAxle + 0.5] });
  tailLamps(b, W, 0.66, zR + 0.03, { w: 0.34, h: 0.08, ins: 0.08, bar: true, wrap: 0.16 });
  plates(b, 0.38, zF - 0.01, 0.48, zR + 0.02, false);
  // rear wing on stands
  b.box(0, belt + 0.21, zR + 0.22, W - 0.32, 0.03, 0.3, 'paint', { rx: -0.1 });
  b.pair(W / 2 - 0.16, belt + 0.21, zR + 0.22, 0.02, 0.1, 0.32, 'black');   // end plates
  b.pair(0.55, belt + 0.11, zR + 0.24, 0.03, 0.16, 0.1, 'black');
  b.pair(W / 2 + 0.004, 0.45, -0.5, 0.012, 0.14, 0.5, 'black');            // side intakes ahead of the haunch
  mirrors(b, W - 0.3, belt + 0.06, 0.32, 0.9);
  handles(b, W, belt - 0.12, [-0.35]);
  sills(b, W, ride + 0.06, t.rearAxle + t.wheelR + 0.12, t.frontAxle - t.wheelR - 0.12, 0.1);
  for (const x of [0.36, 0.5]) { exhaust(b, x, 0.27, zR + 0.05, 0.045); exhaust(b, -x, 0.27, zR + 0.05, 0.045); }
  b.pair(0.3, 0.6, zF - 0.62, 0.22, 0.012, 0.32, 'black', { rx: 0.12 });   // bonnet vents
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.5, rr: 0.3, ride, shoulder: 0.62, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.42, -1.02, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

function suv(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.42, belt = 1.13, roof = t.height - 0.06;
  b.side(bodyShape([[zF - 0.03, ride], [zF + 0.03, 0.7], [zF - 0.02, 0.98], [zF - 0.32, 1.06], [0.95, belt], [-2.15, belt + 0.02],
    [zR + 0.04, belt], [zR - 0.02, 0.66], [zR + 0.03, ride]], ride, arches(t, 0.08), t.wheelR), W, 'paint', { bevel: 0.09, bevelSize: 0.04 });
  archLiners(b, t, W, ride, 0.08);
  const prof = [[0.95, belt], [0.22, roof], [-2.18, roof], [-2.33, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.12, taper: [belt, roof, 0.9], splits: [-0.48, -1.5], zMin: -2.15, zMax: 0.9, rearGlass: 'tint' });
  b.pair(0.66, roof + 0.07, -1.0, 0.05, 0.04, 2.1, 'brushed');       // roof rails
  for (const z of [0.0, -2.0]) b.pair(0.66, roof + 0.035, z, 0.06, 0.06, 0.08, 'black');
  // black cladding over the arches and along the sills
  archLips(b, t, W, ride, 0.08, { band: 0.085, proud: 0.03, kind: 'black' });
  crease(b, W, belt - 0.14, zR + 0.15, zF - 0.35, { d: 0.018, h: 0.055, rise: -0.03 });
  crease(b, W, ride + 0.26, t.rearAxle + 0.6, t.frontAxle - 0.58, { d: 0.012, h: 0.04 });
  shutGaps(b, t, W, [0.9, -0.48, -1.52], ride + 0.2, belt - 0.07, 0.08, 0.085);
  sills(b, W, ride + 0.09, t.rearAxle + t.wheelR + 0.1, t.frontAxle - t.wheelR - 0.1, 0.18);
  b.box(0, 0.5, zF - 0.02, W - 0.3, 0.16, 0.08, 'black');
  b.box(0, 0.86, zF - 0.01, 0.92, 0.24, 0.07, 'black');
  for (let i = 0; i < 3; i++) b.box(0, 0.78 + i * 0.08, zF + 0.03, 0.88, 0.016, 0.02, 'chrome');
  b.box(0, ride + 0.02, zF - 0.06, 0.8, 0.05, 0.3, 'brushed');       // skid plate
  b.box(0, ride + 0.05, zR + 0.06, 0.9, 0.06, 0.2, 'brushed');
  headlamps(b, W, 0.97, zF - 0.06, { w: 0.38, h: 0.12, inset: 0.11, repeater: [0.95, t.frontAxle + 0.55] });
  tailLamps(b, W, 1.02, zR + 0.02, { w: 0.24, h: 0.3, ins: 0.04, third: [roof - 0.04, -2.3], wrap: 0.14 });
  b.cyl(0, 0.85, zR - 0.12, 0.36, 0.2, 'z', 'rubber', 14);           // spare wheel
  b.cyl(0, 0.85, zR - 0.225, 0.26, 0.02, 'z', 'paint', 14);
  plates(b, 0.62, zF, 0.6, zR - 0.02);
  mirrors(b, W - 0.06, belt + 0.04, 0.82, 1.15);
  handles(b, W, belt - 0.12, [0.05, -0.95]);
  exhaust(b, W / 2 - 0.4, ride - 0.01, zR + 0.06, 0.045);
  finAntenna(b, roof, -1.95);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.36, rr: 0.22, ride, shoulder: 1.0, tumble: 0.025 }),
    shade: { ride, belt, seams: [0.9, -0.48, -1.52], seamY: [ride + 0.2, belt - 0.03], arch: arches(t, 0.08)[0][1] } };
}

function pickup(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.5, belt = 1.16, roof = t.height - 0.04, bed = 0.98, cab = -0.95;
  b.side(bodyShape([[zF - 0.03, ride], [zF + 0.03, 0.86], [zF - 0.04, 1.1], [zF - 0.4, belt], [1.1, belt + 0.01], [cab - 0.02, belt + 0.01],
    [cab - 0.02, bed], [zR + 0.02, bed], [zR - 0.01, 0.62], [zR + 0.03, ride]], ride, arches(t, 0.08), t.wheelR), W, 'paint', { bevel: 0.07, bevelSize: 0.03 });
  archLiners(b, t, W, ride, 0.08);
  archLips(b, t, W, ride, 0.08, { band: 0.07, proud: 0.035 });
  crease(b, W, belt - 0.12, cab + 0.1, zF - 0.3, { d: 0.018, h: 0.05 });
  shutGaps(b, t, W, [1.05, -0.1, cab + 0.05], ride + 0.14, belt - 0.07, 0.08, 0.07);
  // bed walls with a black rail cap, tailgate, ribbed liner
  b.pair(W / 2 - 0.06, (bed + belt) / 2, (cab - 0.1 + zR) / 2, 0.12, belt - bed, -(zR - cab + 0.1), 'paint');
  b.pair(W / 2 - 0.06, belt + 0.012, (cab - 0.1 + zR) / 2, 0.14, 0.025, -(zR - cab + 0.1), 'black');
  b.box(0, (bed + belt) / 2, zR + 0.06, W - 0.06, belt - bed, 0.1, 'paint');
  b.box(0, belt - 0.07, zR - 0.002, 0.42, 0.05, 0.02, 'chrome');
  b.box(0, (bed + belt) / 2, cab - 0.11, W - 0.1, belt - bed, 0.06, 'paint');
  b.box(0, bed + 0.012, (cab + zR) / 2, W - 0.24, 0.02, -(zR - cab) - 0.25, 'black');
  for (let i = 0; i < 6; i++) b.box(-0.6 + i * 0.24, bed + 0.03, (cab + zR) / 2, 0.06, 0.02, -(zR - cab) - 0.3, 'dark');
  b.box(0, 0.9, cab - 0.06, W - 0.04, 0.6, 0.012, 'under');          // cab / bed gap
  const prof = [[1.1, belt], [0.42, roof], [-0.82, roof], [cab, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.1, taper: [belt, roof, 0.9], splits: [-0.1], zMin: -0.82, zMax: 1.05, back: true });
  b.box(0, ride + 0.12, zF + 0.02, W + 0.04, 0.24, 0.16, 'chrome');  // chrome bumpers
  b.box(0, ride + 0.12, zR - 0.02, W + 0.02, 0.22, 0.16, 'chrome');
  b.box(0, 0.98, zF - 0.02, 1.12, 0.32, 0.08, 'chrome');             // big grille
  b.box(0, 0.98, zF + 0.016, 1.0, 0.25, 0.02, 'black');
  b.box(0, 0.98, zF + 0.028, 1.0, 0.03, 0.02, 'chrome');
  b.box(0, 0.98, zF + 0.028, 0.03, 0.25, 0.02, 'chrome');
  headlamps(b, W, 1.0, zF - 0.05, { w: 0.28, h: 0.18, inset: 0.08, repeater: [1.02, t.frontAxle + 0.6] });
  tailLamps(b, W, 0.98, zR + 0.0, { w: 0.1, h: 0.34, ins: 0.0, third: [roof + 0.02, cab - 0.05] });
  plates(b, ride + 0.12, zF + 0.1, 0.78, zR - 0.01);
  b.pair(W / 2 + 0.06, ride + 0.1, 0.05, 0.12, 0.04, 1.4, 'brushed');  // side steps
  // tow mirrors on long stalks
  b.pair(W / 2 + 0.12, belt + 0.02, 1.0, 0.24, 0.03, 0.05, 'black');
  b.pair(W / 2 + 0.25, belt + 0.06, 0.99, 0.1, 0.22, 0.22, 'black');
  b.pair(W / 2 + 0.25, belt + 0.06, 0.875, 0.08, 0.18, 0.006, 'chrome');
  handles(b, W, belt - 0.12, [0.55, -0.6]);
  sills(b, W, ride + 0.03, t.rearAxle + t.wheelR + 0.15, t.frontAxle - t.wheelR - 0.15, 0.08);
  exhaust(b, -W / 2 + 0.3, ride - 0.04, zR + 0.3, 0.05);
  antenna(b, W / 2 - 0.25, belt + 0.02, 1.25, 0.8, -0.05);
  b.box(0, ride - 0.02, zR + 0.15, 0.12, 0.1, 0.25, 'black');        // tow hitch
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.28, rr: 0.1, ride, shoulder: 1.05, tumble: 0.02 }),
    shade: { ride, belt, seams: [1.05, -0.1, cab], seamY: [ride + 0.14, belt - 0.03], arch: arches(t, 0.08)[0][1] } };
}

function van(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, ride = 0.42, belt = 1.15, roof = t.height - 0.03, bp = 0.9;
  b.side(bodyShape([[zF - 0.03, ride], [zF + 0.03, 0.8], [zF - 0.1, 1.05], [1.9, belt], [zR + 0.02, belt], [zR - 0.02, 0.5], [zR + 0.03, ride]],
    ride, arches(t, 0.07), t.wheelR), W, 'paint', { bevel: 0.08, bevelSize: 0.03 });
  archLiners(b, t, W, ride, 0.07);
  archLips(b, t, W, ride, 0.07, { band: 0.07, proud: 0.03, kind: 'black' });
  crease(b, W, belt - 0.16, zR + 0.15, zF - 0.4, { d: 0.014, h: 0.05 });
  shutGaps(b, t, W, [1.85, bp], ride + 0.1, belt - 0.06, 0.07, 0.07);
  shutGaps(b, t, W, [-0.4], ride + 0.1, roof - 0.12, 0.07, 0.07);
  // long flat-roofed cargo body behind the cab
  b.side(poly([[bp - 0.02, belt - 0.02], [bp - 0.02, roof], [zR + 0.06, roof], [zR + 0.02, roof - 0.06], [zR + 0.02, belt - 0.02]]), W - 0.04, 'paint',
    { bevel: 0.08, bevelSize: 0.045, taper: [belt, roof, 0.97] });
  const prof = [[1.88, belt], [1.1, roof - 0.04], [bp, roof - 0.04], [bp, belt]];
  greenhouse(b, { prof, width: W - 0.08, taper: [belt, roof, 0.95], zMin: bp + 0.05, zMax: 1.8, back: false, pillar: 0.08, dlo: 'black' });
  // sliding door rail, rear doors with windows and handles, roof bars
  b.pair(W / 2 + 0.006, roof - 0.35, (bp - 0.4) / 2 + 0.25, 0.01, 0.025, 1.6, 'black');
  b.box(0, (belt + roof) / 2, zR - 0.004, 0.014, roof - belt - 0.1, 0.012, 'under');
  b.pair(0.45, roof - 0.42, zR - 0.012, 0.7, 0.5, 0.01, 'tint');
  b.pair(0.18, 1.15, zR - 0.02, 0.04, 0.18, 0.02, 'black');
  for (const z of [-0.4, -1.4, -2.2]) b.box(0, roof + 0.06, z, W - 0.4, 0.035, 0.06, 'black');
  b.pair(W / 2 - 0.25, roof + 0.04, -1.3, 0.04, 0.04, 2.0, 'black');
  b.box(0, ride + 0.1, zF - 0.02, W - 0.02, 0.22, 0.12, 'black');    // black bumpers
  b.box(0, ride + 0.1, zR + 0.02, W - 0.02, 0.22, 0.12, 'black');
  b.box(0, 0.86, zF - 0.04, 1.0, 0.2, 0.06, 'black');
  for (let i = 0; i < 3; i++) b.box(0, 0.8 + i * 0.06, zF - 0.005, 0.95, 0.014, 0.02, 'chrome');
  headlamps(b, W, 0.93, zF - 0.08, { w: 0.32, h: 0.15, inset: 0.1, repeater: [0.95, t.frontAxle + 0.55] });
  tailLamps(b, W, 0.98, zR + 0.0, { w: 0.14, h: 0.42, ins: 0.02, third: [roof - 0.04, zR - 0.01] });
  plates(b, ride + 0.1, zF + 0.04, ride + 0.32, zR + 0.0);
  mirrors(b, W - 0.06, belt + 0.12, 1.72, 1.3);
  handles(b, W, belt - 0.1, [1.2, -0.3]);
  b.pair(W / 2 + 0.006, 1.6, -0.9, 0.006, 0.36, 2.2, 'white', { color: C('#ff6f61') }); // courier stripe
  sills(b, W, ride + 0.05, t.rearAxle + t.wheelR + 0.12, t.frontAxle - t.wheelR - 0.12, 0.1);
  exhaust(b, -W / 2 + 0.35, ride - 0.05, zR + 0.1, 0.045);
  finAntenna(b, roof, 1.0);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.3, rr: 0.1, ride, shoulder: 1.0, tumble: 0.015 }),
    shade: { ride, belt, seams: [1.85, bp, -0.4], seamY: [ride + 0.1, roof - 0.12], arch: arches(t, 0.07)[0][1] } };
}

function truck(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, cabBack = 2.12, ride = 0.68, roof = 3.08, boxTop = t.height, boxFront = 1.82;
  // cab-over: tall cab with an arch over the front wheel
  b.side(bodyShape([[zF - 0.02, ride], [zF + 0.03, 1.55], [zF - 0.04, 2.85], [zF - 0.2, roof], [cabBack + 0.05, roof], [cabBack, ride]],
    ride, [[t.frontAxle, t.wheelR + 0.1]], t.wheelR), W - 0.1, 'paint', { bevel: 0.1, bevelSize: 0.06 });
  const gw = W - 0.3;
  b.quad(new THREE.Vector3(gw / 2, 1.82, zF + 0.065), new THREE.Vector3(-gw / 2, 1.82, zF + 0.065), new THREE.Vector3(-gw / 2 + 0.04, 2.75, zF + 0.035),
    new THREE.Vector3(gw / 2 - 0.04, 2.75, zF + 0.035), new THREE.Vector3(0, 0, 1), 'glass');
  b.box(0, 1.8, zF + 0.07, gw + 0.04, 0.03, 0.02, 'black');
  for (const x of [0.45, -0.5]) b.box(x, 1.86, zF + 0.075, 0.8, 0.014, 0.02, 'black');  // wipers
  b.pair((W - 0.1) / 2 + 0.01, 2.25, zF - 0.7, 0.012, 0.75, 0.95, 'glass');
  b.pair((W - 0.1) / 2 + 0.016, 2.63, zF - 0.7, 0.02, 0.02, 0.97, 'black');
  b.pair((W - 0.1) / 2 + 0.01, 1.55, zF - 1.05, 0.02, 0.04, 0.18, 'chrome');
  b.box(0, 1.25, zF + 0.05, 1.5, 0.5, 0.06, 'black');                 // grille
  for (let i = 0; i < 5; i++) b.box(0, 1.05 + i * 0.1, zF + 0.085, 1.45, 0.02, 0.02, 'chrome');
  b.box(0, 0.62, zF + 0.05, W, 0.32, 0.22, 'dark');                   // bumper
  headlamps(b, W - 0.1, 0.88, zF + 0.12, { w: 0.34, h: 0.16, inset: 0.1, repeater: [1.4, zF - 0.4] });
  plates(b, 0.68, zF + 0.16, 0.95, zR + 0.1, true);
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) b.box(x, roof + 0.03, zF - 0.25, 0.1, 0.04, 0.05, 'amber');
  b.pair(W / 2 + 0.12, 2.15, zF - 0.25, 0.22, 0.035, 0.035, 'black');  // mirror arms
  b.pair(W / 2 + 0.24, 2.15, zF - 0.25, 0.1, 0.45, 0.2, 'black');
  b.pair(W / 2 + 0.24, 2.15, zF - 0.355, 0.08, 0.38, 0.006, 'chrome');
  b.box(0, roof + 0.25, cabBack + 0.8, W - 0.3, 0.5, 1.2, 'paint', { rx: -0.25 }); // wind deflector
  b.pair(W / 2 - 0.15, 0.45, zF - 0.85, 0.36, 0.08, 0.5, 'brushed');   // steps
  // exposed chassis between cab and box, fuel tank, exhaust stack
  b.pair(0.5, 0.78, (cabBack + zR) / 2, 0.16, 0.26, cabBack - zR, 'under');
  b.cyl(W / 2 - 0.35, 0.72, cabBack - 0.9, 0.3, 1.0, 'z', 'brushed', 12);
  b.cyl(-W / 2 + 0.25, 2.3, cabBack - 0.12, 0.08, 2.2, 'y', 'chrome', 8);
  // separate cargo box with ribs, roll-up door, marker lights, side guards and mudflaps
  const boxW = W, boxL = boxFront - zR, boxC = (boxFront + zR) / 2, boxBot = 1.12;
  b.box(0, (boxBot + boxTop) / 2, boxC, boxW, boxTop - boxBot, boxL, 'white', { color: C('#e6e7e8') });
  for (let z = boxFront - 0.3; z > zR + 0.2; z -= 0.62) b.pair(boxW / 2 + 0.012, (boxBot + boxTop) / 2, z, 0.025, boxTop - boxBot - 0.05, 0.05, 'brushed');
  b.pair(boxW / 2 + 0.015, boxTop - 0.08, boxC, 0.03, 0.08, boxL, 'dark');
  b.pair(boxW / 2 + 0.015, boxBot + 0.06, boxC, 0.03, 0.12, boxL, 'dark');
  b.pair(boxW / 2 + 0.02, 2.35, boxC + 0.2, 0.006, 0.9, 3.6, 'white', { color: C('#ff6f61') });
  b.pair(boxW / 2 + 0.024, 2.35, boxC + 0.2, 0.006, 0.18, 3.62, 'white', { color: C('#3fe0d0') });
  for (let y = boxBot + 0.15; y < boxTop - 0.1; y += 0.16) b.box(0, y, zR - 0.012, boxW - 0.2, 0.02, 0.02, 'dark');
  b.box(0, boxBot - 0.08, zR + 0.1, boxW, 0.16, 0.2, 'under');
  for (const z of [boxFront - 0.1, boxC, zR + 0.12]) b.pair(boxW / 2 + 0.02, boxTop - 0.1, z, 0.03, 0.06, 0.1, 'amber');
  tailLamps(b, boxW, 0.95, zR + 0.1, { w: 0.3, h: 0.14, ins: 0.08 });
  b.pair(boxW / 2 - 0.05, 0.75, 0.3, 0.05, 0.12, 1.4, 'dark');
  const ta = t.rearAxle + t.rearTandem / 2 + t.wheelR + 0.15, tb = t.rearAxle - t.rearTandem / 2 - t.wheelR - 0.15;
  b.pair(boxW / 2 - 0.14, 1.12, (ta + tb) / 2, 0.36, 0.05, ta - tb, 'dark');
  b.pair(boxW / 2 - 0.15, 0.62, tb - 0.04, 0.34, 0.6, 0.02, 'rubber');
  return { b, warp: shellWarp({ W, zF, zR: cabBack - 20, rf: 0.22, rr: 0.01, ride, shoulder: 2.6, tumble: 0.0, tuck: 0.0 }),
    shade: { ride, belt: 1.75, seams: [zF - 1.2, 99, 99], seamY: [ride + 0.1, 2.6], arch: t.wheelR + 0.1 } };
}

// PASS 10a1 sports car collection -------------------------------------------------
// Kit: wings on stands or swan necks, louvre slats following a top line, round lamps.
function wing(b, { y, z, span, chord = 0.3, aoa = 0.1, kind = 'paint', stands = [], deckY, swan = false }) {
  b.box(0, y, z, span, 0.03, chord, kind, { rx: aoa });
  const te = z - (chord / 2) * Math.cos(aoa), ty = y + (chord / 2) * Math.sin(aoa);
  b.box(0, ty + 0.022, te, span, 0.045, 0.012, 'black');                       // gurney lip
  b.pair(span / 2 + 0.01, y - 0.01, z, 0.02, 0.16, chord + 0.08, 'black');     // end plates
  for (const x of stands) {
    const h = y - deckY;
    if (swan) {   // swan neck: rises behind the wing and hooks over onto its top face
      b.pair(x, deckY + h * 0.55, z - chord / 2 - 0.02, 0.025, h * 1.1, 0.06, 'black', { rx: 0.25 });
      b.pair(x, y + 0.05, z - 0.04, 0.025, 0.05, chord * 0.7, 'black');
    } else b.pair(x, deckY + h / 2, z, 0.025, h, 0.1, 'black');
  }
}
function slats(b, top, lift, z0, z1, n, width, { x = 0, tilt = -0.35 } = {}) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n, y = profY(top, z) + lift + 0.012;
    if (x) b.pair(x, y, z, width, 0.018, 0.05, 'black', { rx: tilt });
    else b.box(0, y, z, width, 0.018, 0.05, 'black', { rx: tilt });
  }
}
// round lamp facing dir (+1 forward, -1 back): housing or chrome cup, lens, brake core
function roundLamp(b, x, y, z, r, dir, kind) {
  b.cyl(x, y, z - dir * 0.015, r * 1.25, 0.04, 'z', kind === 'head' ? 'chrome' : 'housing', 14);
  b.cyl(x, y, z + dir * 0.008, r, 0.03, 'z', kind, 14);
  if (kind === 'tail') b.cyl(x, y, z + dir * 0.02, r * 0.5, 0.012, 'z', 'brake', 14);
}
// a straight painted / black member between two (z, y) points at lateral x
function strut(b, x, [z0, y0], [z1, y1], sx, sy, kind, pair = true) {
  const opts = { rx: -Math.atan2(y0 - y1, z0 - z1) };
  const len = Math.hypot(z0 - z1, y0 - y1);
  if (pair) b.pair(x, (y0 + y1) / 2, (z0 + z1) / 2, sx, sy, len, kind, opts);
  else b.box(x, (y0 + y1) / 2, (z0 + z1) / 2, sx, sy, len, kind, opts);
}

// Squall X1 (hyper, AWD): pontoon fenders standing proud of a low centre tub,
// a teardrop canopy with a roof scoop and a spine fin, swan-neck active wing.
function vortex(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.11, belt = 0.7, roof = t.height - 0.01;
  const tubW = 1.3, podW = 0.46, podX = W / 2 - podW / 2;
  const tub = [[zF - 0.04, ride + 0.03], [zF + 0.02, 0.22], [zF - 0.1, 0.32], [zF - 0.55, 0.46], [0.85, belt - 0.02], [-1.05, belt],
    [zR + 0.45, 0.79], [zR + 0.03, 0.82], [zR - 0.02, 0.55], [zR + 0.06, 0.24], [zR + 0.2, ride + 0.03]];
  b.side(poly(tub), tubW, 'paint', { bevel: 0.08, bevelSize: 0.05 });
  const podTop = [[zF - 0.12, ride + 0.02], [zF - 0.08, 0.3], [zF - 0.25, 0.52], [fa + 0.35, 0.74], [fa, 0.82], [fa - 0.4, 0.74], [0.3, 0.6], [-0.5, 0.6],
    [ra + 0.55, 0.8], [ra, 0.88], [ra - 0.45, 0.86], [zR + 0.06, 0.78], [zR + 0.02, 0.5], [zR + 0.1, ride + 0.02]];
  const pod = bodyShape(podTop, ride, arches(t, 0.05), t.wheelR, true);
  for (const sx of [1, -1]) b.side(pod, podW, 'paint', { x: sx * podX, bevel: 0.07, bevelSize: 0.04 });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.02 });
  shutGaps(b, t, W, [0.72, -0.78], 0.3, 0.58, 0.05, 0.035);
  const prof = [[0.85, belt], [0.05, roof], [-0.55, roof], [-1.15, belt + 0.03]];
  greenhouse(b, { prof, width: 1.36, taper: [belt, roof, 0.7], zMin: -0.95, zMax: 0.72, pillar: 0.07, dlo: 'black', rearGlass: 'tint' });
  // roof scoop, spine fin down the engine deck, deck louvres
  b.box(0, roof + 0.05, -0.38, 0.32, 0.1, 0.46, 'paint');
  b.box(0, roof + 0.05, -0.15, 0.24, 0.06, 0.02, 'black');
  strut(b, 0, [-0.6, roof + 0.02], [zR + 0.35, profY(tub, zR + 0.35) + 0.1], 0.03, 0.12, 'paint', false);
  slats(b, tub, 0.05, -1.15, zR + 0.45, 7, 0.36, { x: 0.3 });
  wing(b, { y: 1.08, z: zR + 0.3, span: W - 0.26, chord: 0.34, aoa: 0.1, stands: [0.42], deckY: 0.84, swan: true });
  // nose: splitter, twin intakes, canards, light blades on the pods
  b.box(0, ride + 0.02, zF - 0.14, W - 0.24, 0.025, 0.36, 'black');
  b.pair(0.33, 0.2, zF + 0.02, 0.4, 0.1, 0.06, 'black');
  b.pair(W / 2 - 0.12, 0.24, zF - 0.1, 0.2, 0.012, 0.14, 'black', { rz: 0.25 });
  headlamps(b, W, 0.42, zF - 0.12, { w: 0.3, h: 0.05, inset: 0.08, proj: 3 });
  // tail: full-width light blade, diffuser with strakes, centre exhaust
  b.box(0, 0.74, zR - 0.01, W - 0.3, 0.07, 0.04, 'housing');
  b.box(0, 0.745, zR - 0.03, W - 0.38, 0.032, 0.03, 'tail');
  b.pair(W / 2 - 0.32, 0.745, zR - 0.045, 0.32, 0.026, 0.02, 'brake');
  b.pair(0.32, 0.66, zR - 0.03, 0.16, 0.03, 0.03, 'reverse');
  b.pair(W / 2 - 0.12, 0.66, zR - 0.02, 0.1, 0.03, 0.03, 'amber');
  b.box(0, 0.25, zR + 0.16, W - 0.42, 0.26, 0.34, 'black');
  for (let i = -3; i <= 3; i++) b.box(i * 0.2, 0.22, zR + 0.12, 0.015, 0.14, 0.22, 'black');
  exhaust(b, 0, 0.56, zR - 0.02, 0.07);
  plates(b, 0, 0, 0.42, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.42, -0.55, 0.012, 0.22, 0.75, 'black');            // side intakes in the pods
  mirrors(b, 1.42, belt + 0.06, 0.5, 0.85);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.5, rr: 0.28, ride, shoulder: 0.62, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.72, -0.78, 99], seamY: [0.3, 0.58], arch: arches(t, 0.05)[0][1] } };
}

// Riptide V12 (hyper, front-mid V12): very long bonnet with a power bulge and
// louvres, cabin far back, fastback with flying buttresses, quad round tails.
function tempesta(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.76, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.05, ride + 0.02], [zF + 0.02, 0.3], [zF - 0.06, 0.45], [zF - 0.3, 0.64], [fa + 0.2, 0.79], [fa, 0.82], [0.75, 0.8], [0.55, belt],
    [-0.75, belt + 0.03], [ra, 0.86], [ra - 0.35, 0.87], [zR + 0.25, 0.86], [zR + 0.02, 0.84], [zR - 0.03, 0.5], [zR + 0.06, ride + 0.02]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.1, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.022 });
  crease(b, W, 0.5, ra + 0.5, fa - 0.45, { d: 0.02, h: 0.06, rise: 0.06 });
  shutGaps(b, t, W, [0.55, -0.72], ride + 0.12, belt - 0.06, 0.05, 0.035);
  topGaps(b, top, bs, W / 2 - 0.2, 0.85, zF - 0.32, [zF - 0.32], W / 2 - 0.2);
  const prof = [[0.55, belt], [-0.12, roof], [-0.72, roof], [-1.7, belt + 0.06]];
  greenhouse(b, { prof, width: W - 0.3, taper: [belt, roof, 0.76], zMin: -1.1, zMax: 0.5, pillar: 0.07, dlo: 'black', rearGlass: 'tint' });
  b.box(0, 0.87, 1.25, 0.5, 0.05, 1.0, 'paint');                                // power bulge
  slats(b, top, bs, 1.45, 1.0, 5, 0.3, { x: 0.55, tilt: -0.3 });
  const bz1 = zR + 0.35;
  strut(b, 0.64, [-0.78, roof - 0.05], [bz1, profY(top, bz1) + bs], 0.09, 0.05, 'paint');   // flying buttresses
  b.box(0, 0.3, zF - 0.0, 1.0, 0.14, 0.06, 'black');                            // egg-crate grille
  for (let i = -4; i <= 4; i++) b.box(i * 0.11, 0.3, zF + 0.03, 0.012, 0.12, 0.012, 'brushed');
  b.box(0, ride + 0.03, zF - 0.1, W - 0.3, 0.025, 0.3, 'black');
  headlamps(b, W, 0.56, zF - 0.14, { w: 0.34, h: 0.06, inset: 0.12, proj: 2, repeater: [0.62, fa + 0.5] });
  for (const dx of [0.3, 0.58]) for (const sx of [1, -1]) roundLamp(b, sx * (W / 2 - dx), 0.72, zR - 0.04, 0.08, -1, 'tail');
  b.pair(0.16, 0.6, zR - 0.03, 0.12, 0.035, 0.03, 'reverse');
  for (const x of [-0.27, -0.09, 0.09, 0.27]) exhaust(b, x, 0.26, zR - 0.03, 0.042);
  b.box(0, 0.24, zR + 0.12, W - 0.5, 0.14, 0.28, 'black');
  b.box(0, 0.92, zR + 0.12, W - 0.42, 0.03, 0.2, 'paint', { rx: -0.22 });      // ducktail
  for (let i = 0; i < 3; i++) b.pair(W / 2 + 0.004, 0.5, fa - 0.5 - i * 0.09, 0.012, 0.14, 0.035, 'black');   // gills
  plates(b, 0, 0, 0.45, zR - 0.03, false);
  mirrors(b, W - 0.3, belt + 0.06, 0.42, 0.9);
  handles(b, W, belt - 0.08, [-0.2]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.55, rr: 0.35, ride, shoulder: 0.66, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.55, -0.72, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Cormorant R (super, mid-engine): a straight wedge from a knife nose, short
// cab-forward canopy, louvred engine cover, roof periscope and a ducktail.
function stratos(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.76, roof = t.height - 0.01, bs = 0.04;
  const top = [[zF - 0.02, ride + 0.06], [zF + 0.03, 0.26], [zF - 0.02, 0.33], [fa + 0.15, 0.75], [fa - 0.3, 0.79], [0.65, belt], [-0.85, belt + 0.02],
    [ra, 0.86], [zR + 0.12, 0.92], [zR, 0.9], [zR - 0.02, 0.56], [zR + 0.08, ride + 0.04]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.07, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.02 });
  crease(b, W, 0.46, ra + 0.45, fa - 0.45, { d: 0.025, h: 0.06, rise: -0.08 });
  shutGaps(b, t, W, [0.62, -0.82], ride + 0.12, belt - 0.06, 0.05, 0.035);
  const prof = [[0.7, belt], [-0.1, roof], [-0.6, roof], [-1.05, belt + 0.03]];
  greenhouse(b, { prof, width: W - 0.3, taper: [belt, roof, 0.78], zMin: -0.85, zMax: 0.62, pillar: 0.07, dlo: 'black', rearGlass: 'tint' });
  slats(b, top, bs, -1.12, zR + 0.25, 8, W - 0.75);
  b.box(0, roof + 0.06, -0.42, 0.36, 0.12, 0.42, 'paint');                     // periscope
  b.box(0, roof + 0.06, -0.21, 0.28, 0.08, 0.02, 'black');
  // headlamps lie in the wedge, under clear covers
  const sl = Math.atan2(0.42, 0.67), hz = 1.85, hy = profY(top, hz) + bs;
  b.pair(0.58, hy, hz, 0.42, 0.03, 0.26, 'housing', { rx: sl });
  b.pair(0.58, hy + 0.012, hz, 0.34, 0.03, 0.2, 'head', { rx: sl });
  b.pair(0.55, 0.3, zF + 0.04, 0.5, 0.02, 0.02, 'drl');
  b.pair(0.86, 0.27, zF + 0.02, 0.1, 0.03, 0.03, 'amber');
  b.box(0, 0.2, zF + 0.02, 1.1, 0.08, 0.06, 'black');
  b.box(0, ride + 0.02, zF - 0.1, W - 0.3, 0.025, 0.28, 'black');
  tailLamps(b, W, 0.76, zR - 0.03, { w: 0.42, h: 0.1, ins: 0.06 });
  b.box(0, 0.76, zR - 0.02, W - 1.0, 0.12, 0.04, 'black');
  b.box(0, 0.92 + bs + 0.02, zR + 0.06, W - 0.4, 0.04, 0.02, 'black');         // ducktail lip
  for (const x of [0.12, -0.12]) exhaust(b, x, 0.4, zR - 0.03, 0.05);
  b.box(0, 0.24, zR + 0.12, W - 0.5, 0.18, 0.28, 'black');
  for (let i = -2; i <= 2; i++) b.box(i * 0.22, 0.22, zR + 0.1, 0.015, 0.12, 0.2, 'black');
  b.pair(W / 2 + 0.004, 0.58, -0.75, 0.012, 0.16, 0.42, 'black');              // NACA ducts
  plates(b, 0, 0, 0.55, zR - 0.03, false);
  mirrors(b, W - 0.32, belt + 0.06, 0.55, 0.85);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.45, rr: 0.22, ride, shoulder: 0.64, tumble: 0.06 }),
    shade: { ride, belt, seams: [0.62, -0.82, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Fathom V10 (super, mid-engine): long and low, canopy running into a glass
// engine cover, Y-graphic lamps and intakes, fixed wing on outboard stands.
function corsa(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.77, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.04, ride + 0.03], [zF + 0.02, 0.3], [zF - 0.08, 0.42], [zF - 0.4, 0.62], [fa + 0.15, 0.79], [fa - 0.3, 0.8], [0.75, belt],
    [-0.9, belt + 0.02], [ra + 0.3, 0.86], [ra - 0.3, 0.9], [zR + 0.05, 0.9], [zR - 0.02, 0.6], [zR + 0.06, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.04, proud: 0.022 });
  crease(b, W, 0.55, ra + 0.5, fa - 0.5, { d: 0.02, h: 0.05 });
  shutGaps(b, t, W, [0.72, -0.75], ride + 0.12, belt - 0.06, 0.05, 0.04);
  const prof = [[0.8, belt], [-0.05, roof], [-0.55, roof], [-1.7, belt + 0.1]];
  greenhouse(b, { prof, width: W - 0.36, taper: [belt, roof, 0.74], zMin: -0.85, zMax: 0.7, pillar: 0.07, dlo: 'black', rearGlass: 'tint' });
  strut(b, 0.18, [-0.6, roof + 0.012], [-1.66, belt + 0.12], 0.03, 0.02, 'black');   // engine-cover ribs
  wing(b, { y: 1.13, z: zR + 0.22, span: W - 0.16, chord: 0.3, aoa: 0.08, kind: 'black', stands: [0.6], deckY: 0.9 });
  b.pair(0.6, 0.27, zF + 0.02, 0.42, 0.16, 0.06, 'black', { rz: 0.12 });
  b.box(0, 0.22, zF + 0.03, 0.5, 0.07, 0.06, 'black');
  b.box(0, ride + 0.02, zF - 0.12, W - 0.2, 0.025, 0.32, 'black');
  headlamps(b, W, 0.6, zF - 0.32, { w: 0.3, h: 0.055, inset: 0.12, proj: 2, repeater: [0.62, fa + 0.48] });
  b.pair(0.62, 0.53, zF - 0.26, 0.22, 0.018, 0.02, 'drl', { rz: 0.6 });
  // Y tail graphic
  b.pair(W / 2 - 0.3, 0.77, zR - 0.01, 0.5, 0.12, 0.04, 'housing');
  b.pair(W / 2 - 0.3, 0.8, zR - 0.035, 0.42, 0.035, 0.03, 'tail');
  b.pair(W / 2 - 0.22, 0.745, zR - 0.035, 0.22, 0.03, 0.03, 'tail', { rz: 0.6 });
  b.pair(W / 2 - 0.3, 0.8, zR - 0.052, 0.2, 0.03, 0.01, 'brake');
  b.pair(0.3, 0.71, zR - 0.035, 0.12, 0.03, 0.03, 'reverse');
  b.pair(W / 2 - 0.08, 0.72, zR - 0.02, 0.06, 0.05, 0.03, 'amber');
  b.box(0, 0.55, zR - 0.02, 0.6, 0.14, 0.04, 'black');
  for (const x of [0.13, -0.13]) exhaust(b, x, 0.53, zR - 0.04, 0.055);
  b.box(0, 0.26, zR + 0.14, W - 0.4, 0.24, 0.3, 'black');
  for (let i = -3; i <= 3; i++) b.box(i * 0.18, 0.22, zR + 0.1, 0.015, 0.14, 0.2, 'black');
  b.pair(W / 2 + 0.004, 0.5, -0.75, 0.012, 0.26, 0.42, 'black');
  plates(b, 0, 0, 0.42, zR - 0.03, false);
  mirrors(b, W - 0.36, belt + 0.06, 0.6, 0.85);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.5, rr: 0.3, ride, shoulder: 0.64, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.72, -0.75, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Kestrel R (sports, front-engine RWD coupe): long bonnet with a bulge and
// vents, fastback with a quarter window, ducktail, slim full-width tail strip.
function phoenix(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.15, belt = 0.86, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.02], [zF + 0.03, 0.38], [zF - 0.02, 0.55], [zF - 0.25, 0.66], [fa, 0.76], [0.85, 0.8], [0.6, belt - 0.02], [-1.0, belt],
    [zR + 0.3, belt + 0.05], [zR + 0.04, belt + 0.04], [zR - 0.02, 0.62], [zR + 0.04, 0.38], [zR + 0.1, ride + 0.02]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride);
  archLips(b, t, W, ride);
  crease(b, W, belt - 0.12, zR + 0.3, zF - 0.35, { d: 0.022, h: 0.06, rise: -0.04 });
  shutGaps(b, t, W, [0.58, -0.85], ride + 0.1, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.18, 0.9, zF - 0.28, [zF - 0.28], W / 2 - 0.18);
  const prof = [[0.6, belt], [-0.05, roof], [-0.55, roof], [-1.75, belt + 0.05]];
  greenhouse(b, { prof, width: W - 0.16, taper: [belt, roof, 0.82], splits: [-0.85], zMin: -1.15, zMax: 0.55 });
  b.box(0, 0.84, 1.3, 0.5, 0.04, 0.9, 'paint');
  b.pair(0.42, profY(top, 1.55) + bs + 0.005, 1.55, 0.2, 0.012, 0.22, 'black');
  b.pair(W / 2 + 0.004, 0.6, fa - 0.55, 0.012, 0.09, 0.22, 'black');
  headlamps(b, W, 0.58, zF - 0.04, { w: 0.4, h: 0.07, inset: 0.1, proj: 3, repeater: [0.66, fa + 0.48] });
  b.box(0, 0.3, zF + 0.04, 1.1, 0.13, 0.05, 'black');
  b.box(0, ride + 0.03, zF - 0.04, W - 0.4, 0.03, 0.16, 'black');
  tailLamps(b, W, 0.8, zR - 0.02, { w: 0.42, h: 0.06, ins: 0.05, bar: true, third: [belt + 0.1, -1.72] });
  b.box(0, belt + 0.1, zR + 0.1, W - 0.3, 0.03, 0.16, 'paint', { rx: -0.25 });
  b.box(0, 0.3, zR + 0.06, W - 0.5, 0.12, 0.16, 'black');
  for (const x of [0.45, 0.56]) { exhaust(b, x, 0.3, zR - 0.0, 0.042); exhaust(b, -x, 0.3, zR - 0.0, 0.042); }
  plates(b, 0.3, zF + 0.07, 0.6, zR - 0.02);
  mirrors(b, W - 0.12, belt + 0.04, 0.5);
  handles(b, W, belt - 0.1, [-0.3]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.45, rr: 0.32, ride, shoulder: 0.76, tumble: 0.04 }),
    shade: { ride, belt, seams: [0.58, -0.85, 99], seamY: [ride + 0.12, belt - 0.03], arch: arches(t)[0][1] } };
}

// Driftline Z (sports, drift build): a boxy notchback coupe on bolt-on black
// overfenders out to a wide track, big GT wing, lip, tow hook, single big pipe.
function driftline(t) {
  const b = new PartBuilder();
  const W = t.width, Wb = W - 0.12, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.88, roof = t.height - 0.01, bs = 0.04;
  const top = [[zF - 0.02, ride + 0.02], [zF + 0.04, 0.45], [zF + 0.02, 0.64], [zF - 0.12, 0.7], [fa, 0.76], [0.95, 0.79], [0.8, belt - 0.03], [-1.2, belt],
    [zR + 0.45, belt + 0.02], [zR + 0.06, belt + 0.01], [zR, 0.66], [zR + 0.04, 0.4], [zR + 0.1, ride + 0.02]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), Wb, 'paint', { bevel: 0.06, bevelSize: bs });
  archLiners(b, t, Wb, ride);
  for (const proud of [0.03, 0.06]) archLips(b, t, Wb, ride, 0.06, { band: 0.1, proud, kind: 'black' });
  for (const [az, ar] of arches(t)) for (let k = 0; k < 7; k++) {
    const a = 0.25 + (k / 6) * (Math.PI - 0.5), r = ar + 0.05;
    for (const sx of [1, -1]) b.cyl(sx * (W / 2 + 0.004), t.wheelR + r * Math.sin(a), az + r * Math.cos(a), 0.012, 0.012, 'x', 'chrome', 6);
  }
  crease(b, Wb, belt - 0.1, zR + 0.15, zF - 0.15, { d: 0.02, h: 0.045 });
  shutGaps(b, t, Wb, [0.82, -0.55], ride + 0.12, belt - 0.06);
  topGaps(b, top, bs, Wb / 2 - 0.16, 1.0, zF - 0.14, [zF - 0.14], Wb / 2 - 0.16);
  topGaps(b, top, bs, Wb / 2 - 0.18, zR + 0.1, -1.3, [zR + 0.1], Wb / 2 - 0.18);
  const prof = [[0.8, belt], [0.18, roof], [-0.75, roof], [-1.25, belt + 0.02]];
  greenhouse(b, { prof, width: Wb - 0.14, taper: [belt, roof, 0.86], splits: [-0.55], zMin: -1.05, zMax: 0.75, dlo: 'black' });
  wing(b, { y: belt + 0.36, z: zR + 0.22, span: W - 0.2, chord: 0.3, aoa: 0.1, kind: 'black', stands: [0.42], deckY: belt + 0.05 });
  b.box(0, ride + 0.02, zF - 0.02, Wb - 0.1, 0.03, 0.2, 'black');               // lip
  b.box(0, 0.52, zF + 0.06, 0.8, 0.1, 0.05, 'black');                           // grille
  b.box(0, 0.32, zF + 0.07, 1.1, 0.12, 0.05, 'black');
  b.box(-0.45, 0.24, zF + 0.1, 0.06, 0.1, 0.04, 'white', { color: C('#d01818') });   // tow hook
  headlamps(b, Wb, 0.63, zF + 0.06, { w: 0.4, h: 0.09, inset: 0.1, proj: 2, repeater: [0.7, fa + 0.5] });
  tailLamps(b, Wb, 0.78, zR, { w: 0.36, h: 0.14, ins: 0.06 });
  b.box(0, 0.78, zR + 0.0, Wb - 0.95, 0.12, 0.03, 'black');
  b.cyl(-(Wb / 2 - 0.35), 0.24, zR + 0.0, 0.065, 0.2, 'z', 'brushed', 10);
  b.cyl(-(Wb / 2 - 0.35), 0.24, zR - 0.101, 0.05, 0.004, 'z', 'under', 10);
  plates(b, 0.33, zF + 0.09, 0.55, zR - 0.01);
  mirrors(b, Wb - 0.1, belt + 0.03, 0.7, 0.9);
  handles(b, Wb, belt - 0.1, [0.0]);
  sills(b, Wb, ride + 0.07, ra + t.wheelR + 0.16, fa - t.wheelR - 0.16);
  return { b, warp: shellWarp({ W: Wb, zF, zR, rf: 0.28, rr: 0.2, ride, shoulder: 0.8, tumble: 0.03 }),
    shade: { ride, belt, seams: [0.82, -0.55, 99], seamY: [ride + 0.12, belt - 0.03], arch: arches(t)[0][1] } };
}

// Thunder V8 (muscle): long flat bonnet with a cowl scoop and stripes, twin
// round lamps in a full-width grille, kicked-up haunches, fastback, triple-bar tails.
function thunder(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.16, belt = 0.9, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.04], [zF + 0.03, 0.48], [zF + 0.04, 0.74], [zF - 0.06, 0.8], [fa, 0.84], [1.0, 0.86], [0.75, belt - 0.02], [-0.4, belt - 0.01],
    [ra + 0.2, belt + 0.06], [zR + 0.3, belt + 0.06], [zR + 0.04, belt + 0.08], [zR - 0.02, 0.7], [zR + 0.03, 0.42], [zR + 0.1, ride + 0.04]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W - 0.04, 'paint', { bevel: 0.09, bevelSize: bs });
  const haunch = bodyShape([[ra + 0.85, belt - 0.12], [ra + 0.35, belt + 0.0], [ra - 0.45, belt + 0.02], [ra - 0.75, belt - 0.14]], ride + 0.3, [[ra, t.wheelR + 0.06]], t.wheelR);
  for (const sx of [1, -1]) b.side(haunch, 0.1, 'paint', { x: sx * (W / 2 - 0.05), bevel: 0.04, bevelSize: 0.02 });
  archLiners(b, t, W, ride);
  archLips(b, t, W - 0.04, ride, 0.06, { pick: [0] });
  crease(b, W - 0.04, belt - 0.14, zR + 0.2, zF - 0.3, { d: 0.03, h: 0.07, rise: -0.06 });
  shutGaps(b, t, W - 0.04, [0.68, -0.9], ride + 0.12, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.2, zR + 0.1, -1.95, [zR + 0.1], W / 2 - 0.2);
  const prof = [[0.72, belt], [0.05, roof], [-0.65, roof], [-1.85, belt + 0.06]];
  greenhouse(b, { prof, width: W - 0.24, taper: [belt, roof, 0.84], zMin: -1.1, zMax: 0.68 });
  b.box(0, 0.92, 1.45, 0.62, 0.07, 1.0, 'paint');                               // cowl scoop
  b.box(0, 0.925, 1.96, 0.5, 0.045, 0.02, 'black');
  b.pair(0.62, 0.9, zF - 0.2, 0.035, 0.02, 0.035, 'chrome');                    // bonnet pins
  b.pair(0.12, 0.957, 1.45, 0.1, 0.004, 1.0, 'black');                          // stripes
  b.pair(0.12, roof + 0.003, -0.3, 0.1, 0.004, 0.6, 'black');
  b.box(0, 0.62, zF + 0.07, W - 0.3, 0.2, 0.04, 'black');
  for (const x of [0.55, 0.75]) for (const sx of [1, -1]) roundLamp(b, sx * x, 0.63, zF + 0.09, 0.07, 1, 'head');
  b.pair(0.88, 0.52, zF + 0.07, 0.08, 0.04, 0.03, 'amber');
  b.box(0, 0.42, zF + 0.06, W - 0.12, 0.08, 0.1, 'chrome');
  b.box(0, ride + 0.05, zF - 0.02, W - 0.3, 0.05, 0.16, 'black');
  b.box(0, 0.76, zR - 0.04, W - 0.2, 0.22, 0.03, 'black');
  for (let i = 0; i < 3; i++) {
    const x = W / 2 - 0.22 - i * 0.14;
    b.pair(x, 0.76, zR - 0.055, 0.1, 0.17, 0.03, 'tail');
    b.pair(x, 0.76, zR - 0.072, 0.06, 0.12, 0.01, 'brake');
  }
  b.pair(0.16, 0.76, zR - 0.055, 0.1, 0.05, 0.03, 'reverse');
  b.pair(W / 2 - 0.08, 0.7, zR - 0.05, 0.05, 0.05, 0.03, 'amber');
  b.box(0, 0.45, zR - 0.04, W - 0.12, 0.07, 0.1, 'chrome');
  b.pair(W / 2 + 0.004, 0.68, ra + 0.62, 0.012, 0.12, 0.3, 'black');           // haunch scoops
  for (const x of [0.42, 0.55]) { exhaust(b, x, 0.3, zR - 0.02, 0.045); exhaust(b, -x, 0.3, zR - 0.02, 0.045); }
  plates(b, 0, 0, 0.58, zR - 0.07, false);
  mirrors(b, W - 0.12, belt + 0.03, 0.62);
  handles(b, W - 0.04, belt - 0.1, [-0.2]);
  sills(b, W - 0.04, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.3, rr: 0.25, ride, shoulder: 0.82, tumble: 0.03 }),
    shade: { ride, belt, seams: [0.68, -0.9, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Monarch S (luxury saloon): long, formal and upright: tall chrome-framed grille
// with vertical vanes, bonnet mascot, long wheelbase, opera window, chrome lines.
function monarch(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.3, belt = 0.98, roof = t.height - 0.02, bs = 0.05;
  const top = [[zF - 0.02, ride], [zF + 0.03, 0.5], [zF + 0.04, 0.8], [zF - 0.06, 0.88], [fa, 0.92], [1.1, 0.94], [0.98, belt - 0.02], [-1.5, belt],
    [zR + 0.25, belt + 0.02], [zR + 0.03, belt - 0.02], [zR - 0.01, 0.6], [zR + 0.04, 0.42], [zR + 0.08, ride]];
  b.side(bodyShape(top, ride, arches(t, 0.07), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride, 0.07);
  archLips(b, t, W, ride, 0.07, { band: 0.04, proud: 0.016 });
  crease(b, W, belt - 0.12, zR + 0.2, zF - 0.3, { d: 0.02, h: 0.055 });
  shutGaps(b, t, W, [0.92, -0.42, -1.38], ride + 0.1, belt - 0.07, 0.07, 0.04);
  topGaps(b, top, bs, W / 2 - 0.16, 1.15, zF - 0.1, [zF - 0.1], W / 2 - 0.16);
  topGaps(b, top, bs, W / 2 - 0.18, zR + 0.1, -1.66, [zR + 0.1], W / 2 - 0.18);
  const prof = [[0.98, belt], [0.32, roof], [-1.12, roof], [-1.62, belt + 0.02]];
  greenhouse(b, { prof, width: W - 0.14, taper: [belt, roof, 0.88], splits: [-0.42, -1.18], zMin: -1.45, zMax: 0.92, rearGlass: 'tint' });
  // grille: black field, chrome frame and vanes; mascot and bonnet strip
  b.box(0, 0.66, zF + 0.07, 0.6, 0.32, 0.04, 'black');
  b.box(0, 0.83, zF + 0.08, 0.66, 0.025, 0.05, 'chrome');
  b.box(0, 0.49, zF + 0.08, 0.66, 0.025, 0.05, 'chrome');
  b.pair(0.32, 0.66, zF + 0.08, 0.025, 0.36, 0.05, 'chrome');
  for (let i = -4; i <= 4; i++) b.box(i * 0.065, 0.66, zF + 0.09, 0.014, 0.3, 0.02, 'chrome');
  b.box(0, 0.94 + bs + 0.03, zF - 0.12, 0.025, 0.07, 0.07, 'chrome', { rx: 0.3 });
  strut(b, 0, [2.55, profY(top, 2.55) + bs + 0.004], [1.55, profY(top, 1.55) + bs + 0.004], 0.03, 0.01, 'chrome', false);
  headlamps(b, W, 0.74, zF + 0.08, { w: 0.42, h: 0.1, inset: 0.08, proj: 2, repeater: [0.8, fa + 0.55] });
  b.box(0, 0.36, zF + 0.04, W - 0.5, 0.1, 0.06, 'black');
  tailLamps(b, W, 0.86, zR - 0.02, { w: 0.5, h: 0.08, ins: 0.04, wrap: 0.3, third: [belt + 0.06, -1.6] });
  b.box(0, 0.86, zR - 0.03, W - 1.2, 0.03, 0.03, 'chrome');
  b.pair(0.55, 0.36, zR - 0.02, 0.22, 0.06, 0.06, 'chrome');
  b.pair(0.55, 0.36, zR - 0.052, 0.18, 0.035, 0.004, 'under');
  const s0 = ra + 0.5, s1 = fa - 0.5;
  b.pair(W / 2 + 0.008, 0.58, (s0 + s1) / 2, 0.012, 0.022, s1 - s0, 'chrome');  // side strip
  plates(b, 0.4, zF + 0.08, 0.6, zR - 0.02);
  mirrors(b, W - 0.08, belt + 0.03, 0.88, 1.05);
  handles(b, W, belt - 0.1, [0.15, -0.85]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.14, fa - t.wheelR - 0.14);
  finAntenna(b, roof, -1.0);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.3, rr: 0.26, ride, shoulder: 0.9, tumble: 0.03 }),
    shade: { ride, belt, seams: [0.92, -0.42, -1.38], seamY: [ride + 0.12, belt - 0.03], arch: arches(t, 0.07)[0][1] } };
}

// PASS 10a2: the rest of the collection -------------------------------------------

// Undertow GT (hyper, AWD twin-turbo V8): a low-drag long-tail. Teardrop canopy far
// forward, rear wheels under spats, a dorsal fin running to a tail wing slung
// between two tail booms, slit lamps, centre-high twin pipes.
function nemesis(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.1, belt = 0.74, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.05, ride + 0.03], [zF + 0.02, 0.2], [zF - 0.06, 0.31], [zF - 0.45, 0.5], [fa + 0.35, 0.72], [fa, 0.8], [fa - 0.4, 0.77], [0.75, belt],
    [-0.8, belt + 0.02], [ra + 0.5, 0.84], [ra, 0.9], [ra - 0.5, 0.88], [zR + 0.25, 0.86], [zR + 0.02, 0.84], [zR - 0.03, 0.55], [zR + 0.05, 0.22], [zR + 0.25, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.1, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.03, proud: 0.018, pick: [0] });
  spats(b, t, W);
  crease(b, W, 0.5, ra + 0.45, fa - 0.45, { d: 0.02, h: 0.06, rise: 0.05 });
  shutGaps(b, t, W, [0.7, -0.78], ride + 0.12, belt - 0.06, 0.05, 0.03);
  const prof = [[0.75, belt], [0.02, roof], [-0.5, roof], [-1.25, belt + 0.06]], gw = 1.36;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.68], zMin: -0.9, zMax: 0.7, pillar: 0.07, dlo: 'black', rearGlass: 'tint', hollow: true });
  cabin(b, t, prof, gw);
  strut(b, 0, [-0.55, roof - 0.01], [zR + 0.35, 1.0], 0.025, 0.16, 'paint', false);          // dorsal fin
  b.pair(0.62, 0.92, zR + 0.3, 0.07, 0.16, 0.56, 'paint');                                  // tail booms
  wing(b, { y: 1.0, z: zR + 0.22, span: 1.24, chord: 0.26, aoa: 0.05, kind: 'black', stands: [], deckY: 0.88 });
  slats(b, top, bs, -1.3, -1.9, 6, 0.3, { x: 0.32 });
  b.box(0, ride + 0.02, zF - 0.16, W - 0.3, 0.025, 0.36, 'black');
  b.box(0, 0.2, zF + 0.0, 0.7, 0.09, 0.05, 'black');
  b.pair(0.78, 0.22, zF - 0.06, 0.26, 0.1, 0.05, 'black');
  headlamps(b, W, 0.44, zF - 0.22, { w: 0.26, h: 0.042, inset: 0.15, proj: 3 });
  b.box(0, 0.8, zR - 0.02, W - 0.42, 0.05, 0.03, 'housing');
  b.box(0, 0.8, zR - 0.038, W - 0.5, 0.022, 0.02, 'tail');
  b.pair(W / 2 - 0.3, 0.8, zR - 0.05, 0.22, 0.02, 0.01, 'brake');
  b.pair(0.36, 0.72, zR - 0.03, 0.12, 0.03, 0.03, 'reverse');
  b.box(0, 0.26, zR + 0.18, W - 0.4, 0.26, 0.36, 'black');
  for (let i = -3; i <= 3; i++) b.box(i * 0.22, 0.22, zR + 0.12, 0.015, 0.14, 0.24, 'black');
  for (const x of [0.1, -0.1]) exhaust(b, x, 0.62, zR - 0.02, 0.055);
  plates(b, 0, 0, 0.45, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.5, -0.55, 0.012, 0.24, 0.5, 'black');
  mirrors(b, gw + 0.02, belt + 0.06, 0.5, 0.8);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.6, rr: 0.4, ride, shoulder: 0.64, tumble: 0.06 }),
    shade: { ride, belt, seams: [0.7, -0.78, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Brazier RS (hyper, open V12 speedster): no roof. A cockpit tub cut into the body,
// a wrap-round visor, a speed hump and roll hoop behind each seat, a swan-neck wing.
function inferno(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.11, sill = 0.56, belt = 0.74, bs = 0.05;
  const top = [[zF - 0.04, ride + 0.03], [zF + 0.02, 0.24], [zF - 0.08, 0.36], [zF - 0.5, 0.56], [fa + 0.2, 0.74], [fa - 0.15, 0.77], [0.75, 0.7], [0.62, sill],
    [-0.55, sill], [-0.7, 0.78], [ra, 0.86], [zR + 0.3, 0.85], [zR + 0.02, 0.83], [zR - 0.02, 0.5], [zR + 0.06, 0.24], [zR + 0.2, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.02 });
  b.pair(W / 2 - 0.14, (sill + belt) / 2 + bs / 2, 0.035, 0.24, belt - sill + bs, 1.17, 'paint');   // tub walls
  shutGaps(b, t, W, [0.6, -0.5], ride + 0.12, belt - 0.04, 0.05, 0.035);
  // visor: a low wrap-round screen on a black frame
  const vb = [0.66, sill + 0.17], vt = [0.42, sill + 0.4], hw = 0.74;
  b.quad(new THREE.Vector3(hw, vb[1], vb[0]), new THREE.Vector3(-hw, vb[1], vb[0]), new THREE.Vector3(-hw + 0.06, vt[1], vt[0]), new THREE.Vector3(hw - 0.06, vt[1], vt[0]),
    new THREE.Vector3(0, 0.5, 0.9), 'clear');
  strut(b, 0, vb, vt, 0.014, 0.02, 'black', false);
  b.box(0, vt[1] + 0.01, vt[0], 2 * hw - 0.1, 0.025, 0.03, 'black');
  b.pair(hw - 0.02, (vb[1] + vt[1]) / 2, (vb[0] + vt[0]) / 2, 0.03, 0.26, 0.04, 'black', { rx: -0.8 });
  // speed humps and roll hoops
  const hump = poly([[-0.55, sill], [-0.6, 0.96], [-0.85, 1.0], [-1.45, 0.88], [-1.6, 0.8], [-1.6, sill]]);
  for (const sx of [1, -1]) b.side(hump, 0.42, 'paint', { x: sx * 0.38, bevel: 0.07, bevelSize: 0.04 });
  b.pair(0.38, 0.95, -0.56, 0.36, 0.05, 0.05, 'black');
  cockpit(b, { y: sill, dashZ: 0.6, seatZ: -0.42, top: 1.2, w: W - 0.6, x: 0.38, full: true, accent: '#e2b400', harness: true });
  wing(b, { y: 1.2, z: zR + 0.32, span: W - 0.2, chord: 0.36, aoa: 0.12, kind: 'black', stands: [0.35], deckY: 0.86, swan: true });
  b.box(0, ride + 0.02, zF - 0.12, W - 0.22, 0.025, 0.34, 'black');
  b.box(0, 0.26, zF + 0.02, 1.0, 0.12, 0.05, 'black');
  b.pair(W / 2 - 0.1, 0.26, zF - 0.1, 0.18, 0.012, 0.16, 'black', { rz: 0.3 });
  headlamps(b, W, 0.5, zF - 0.16, { w: 0.3, h: 0.05, inset: 0.12, proj: 2 });
  for (const dy of [0, -0.07]) {
    b.pair(W / 2 - 0.32, 0.74 + dy, zR - 0.02, 0.44, 0.035, 0.04, 'housing');
    b.pair(W / 2 - 0.32, 0.74 + dy, zR - 0.04, 0.4, 0.02, 0.02, 'tail');
  }
  b.pair(W / 2 - 0.3, 0.74, zR - 0.055, 0.2, 0.02, 0.01, 'brake');
  b.pair(0.12, 0.62, zR - 0.03, 0.1, 0.03, 0.03, 'reverse');
  b.box(0, 0.25, zR + 0.15, W - 0.4, 0.24, 0.32, 'black');
  for (let i = -3; i <= 3; i++) b.box(i * 0.2, 0.21, zR + 0.1, 0.015, 0.14, 0.22, 'black');
  for (const x of [0.2, 0.08]) { exhaust(b, x, 0.5, zR - 0.02, 0.045); exhaust(b, -x, 0.5, zR - 0.02, 0.045); }
  plates(b, 0, 0, 0.38, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.46, -0.95, 0.012, 0.22, 0.5, 'black');
  mirrors(b, W - 0.34, belt + 0.02, 0.45, 0.8);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.5, rr: 0.3, ride, shoulder: 0.6, tumble: 0.04 }),
    shade: { ride, belt, seams: [0.6, -0.5, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Lionfish GT (super, twin-turbo V8 RWD): long rear, cleft "shark" nose with a centre
// blade, a roof scoop feeding a dorsal spine between twin deck fins, vertical lamps.
function venom(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.11, belt = 0.76, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.03], [zF + 0.02, 0.24], [zF - 0.05, 0.34], [zF - 0.35, 0.56], [fa, 0.76], [fa - 0.3, 0.78], [0.7, belt], [-0.8, belt + 0.02],
    [ra + 0.4, 0.86], [ra - 0.2, 0.9], [zR + 0.2, 0.9], [zR + 0.02, 0.86], [zR - 0.02, 0.52], [zR + 0.06, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.04, proud: 0.025 });
  crease(b, W, 0.56, ra + 0.4, fa - 0.4, { d: 0.022, h: 0.06, rise: -0.06 });
  shutGaps(b, t, W, [0.66, -0.78], ride + 0.12, belt - 0.06, 0.05, 0.04);
  const prof = [[0.72, belt], [-0.02, roof], [-0.52, roof], [-1.25, belt + 0.08]], gw = W - 0.38;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.72], zMin: -0.95, zMax: 0.66, pillar: 0.07, dlo: 'black', rearGlass: 'tint', hollow: true });
  cabin(b, t, prof, gw);
  b.box(0, roof + 0.06, -0.3, 0.3, 0.1, 0.5, 'paint');                                       // roof scoop
  b.box(0, roof + 0.06, -0.05, 0.24, 0.07, 0.02, 'black');
  strut(b, 0, [-0.55, roof + 0.08], [zR + 0.3, 0.98], 0.2, 0.08, 'paint', false);          // spine
  for (const sx of [1, -1]) strut(b, sx * 0.62, [-0.9, 0.9], [zR + 0.12, 1.04], 0.04, 0.14, 'paint', false);
  b.box(0, 1.06, zR + 0.12, W - 0.5, 0.03, 0.22, 'paint', { rx: -0.12 });                   // flush spoiler
  b.box(0, 0.3, zF + 0.0, 0.06, 0.2, 0.08, 'paint');                                         // nose blade
  b.pair(0.38, 0.24, zF - 0.02, 0.6, 0.12, 0.05, 'black');
  b.box(0, ride + 0.02, zF - 0.12, W - 0.22, 0.025, 0.32, 'black');
  headlamps(b, W, 0.55, zF - 0.24, { w: 0.16, h: 0.1, inset: 0.12, proj: 1, repeater: [0.6, fa + 0.45] });
  for (const sx of [1, -1]) {
    b.box(sx * (W / 2 - 0.12), 0.74, zR - 0.01, 0.1, 0.24, 0.04, 'housing');
    b.box(sx * (W / 2 - 0.12), 0.74, zR - 0.03, 0.06, 0.2, 0.03, 'tail');
    b.box(sx * (W / 2 - 0.12), 0.8, zR - 0.045, 0.05, 0.07, 0.01, 'brake');
  }
  b.pair(0.4, 0.66, zR - 0.03, 0.14, 0.03, 0.03, 'reverse');
  for (const y of [0.5, 0.4]) exhaust(b, 0, y, zR - 0.02, 0.05);
  b.box(0, 0.24, zR + 0.15, W - 0.45, 0.22, 0.32, 'black');
  for (let i = -2; i <= 2; i++) b.box(i * 0.24, 0.21, zR + 0.1, 0.015, 0.13, 0.22, 'black');
  plates(b, 0, 0, 0.6, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.55, -0.7, 0.012, 0.2, 0.5, 'black');
  mirrors(b, gw + 0.02, belt + 0.06, 0.55, 0.85);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.55, rr: 0.25, ride, shoulder: 0.66, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.66, -0.78, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Halyard 720 (super, twin-turbo V8): a teardrop glass canopy over a tub, deep black
// "eye socket" lamp recesses, floating buttresses standing clear of the engine
// cover, C-shaped tail lamps and a mesh rear grille.
function spectre(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.78, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.04, ride + 0.03], [zF + 0.02, 0.28], [zF - 0.06, 0.4], [zF - 0.4, 0.6], [fa, 0.78], [fa - 0.3, 0.79], [0.7, belt], [-0.7, belt + 0.02],
    [ra + 0.3, 0.86], [ra - 0.3, 0.9], [zR + 0.12, 0.9], [zR - 0.0, 0.82], [zR - 0.02, 0.5], [zR + 0.06, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.1, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.02 });
  crease(b, W, 0.5, ra + 0.5, fa - 0.4, { d: 0.022, h: 0.08, rise: 0.08 });
  shutGaps(b, t, W, [0.66, -0.66], ride + 0.12, belt - 0.06, 0.05, 0.035);
  const prof = [[0.72, belt], [0.0, roof], [-0.45, roof], [-1.1, belt + 0.06]], gw = W - 0.42;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.66], zMin: -0.75, zMax: 0.68, pillar: 0.06, dlo: 'black', rearGlass: 'tint', hollow: true, roofKind: 'tint' });
  cabin(b, t, prof, gw, { accent: '#ff7a00' });
  // floating buttresses: from the roof's rear corners to the tail, standing off the deck
  strut(b, 0.6, [-0.5, roof - 0.06], [zR + 0.25, 0.98], 0.08, 0.04, 'paint');
  b.pair(0.6, 0.94, -1.35, 0.06, 0.08, 0.06, 'black');
  b.box(0, 0.94, -1.45, 0.86, 0.02, 0.8, 'tint');                                           // glass engine cover
  // eye sockets: a deep black teardrop recess holding a slim lamp and the intake
  b.pair(0.62, 0.48, zF - 0.16, 0.4, 0.22, 0.1, 'black', { rz: 0.18 });
  headlamps(b, W, 0.58, zF - 0.12, { w: 0.2, h: 0.04, inset: 0.32, proj: 2, drl: true });
  b.pair(0.6, 0.38, zF - 0.1, 0.24, 0.016, 0.02, 'drl', { rz: 0.5 });
  b.box(0, ride + 0.02, zF - 0.1, W - 0.3, 0.025, 0.28, 'black');
  b.box(0, 0.24, zF + 0.0, 0.8, 0.07, 0.05, 'black');
  // C-shaped tails
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.22);
    b.box(x, 0.82, zR - 0.02, 0.3, 0.035, 0.03, 'tail');
    b.box(x + sx * 0.14, 0.74, zR - 0.02, 0.035, 0.18, 0.03, 'tail');
    b.box(x, 0.66, zR - 0.02, 0.3, 0.035, 0.03, 'tail');
    b.box(x, 0.74, zR - 0.01, 0.3, 0.2, 0.03, 'housing');
    b.box(x, 0.74, zR - 0.035, 0.12, 0.05, 0.01, 'brake');
  }
  b.box(0, 0.7, zR - 0.01, W - 1.1, 0.26, 0.03, 'black');
  for (let i = 0; i < 4; i++) b.box(0, 0.6 + i * 0.06, zR - 0.025, W - 1.15, 0.012, 0.012, 'brushed');
  b.pair(0.34, 0.6, zR - 0.03, 0.1, 0.03, 0.03, 'reverse');
  for (const x of [0.16, -0.16]) exhaust(b, x, 0.6, zR - 0.02, 0.05);
  b.box(0, 0.24, zR + 0.15, W - 0.45, 0.22, 0.32, 'black');
  plates(b, 0, 0, 0.36, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.56, -0.62, 0.012, 0.3, 0.42, 'black');
  mirrors(b, gw + 0.04, belt + 0.07, 0.5, 0.8);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.55, rr: 0.38, ride, shoulder: 0.66, tumble: 0.07 }),
    shade: { ride, belt, seams: [0.66, -0.66, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Moray SV (super, AWD V12): all straight lines and hexagons. A knife wedge with
// arrow DRLs, a huge splitter, C-pillar snorkels, a fixed wing on a centre pylon,
// X-graphic tails and hexagonal pipes.
function reaper(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.11, belt = 0.76, roof = t.height - 0.01, bs = 0.03;
  const top = [[zF - 0.01, ride + 0.05], [zF + 0.04, 0.24], [zF - 0.02, 0.3], [fa + 0.2, 0.72], [fa - 0.35, 0.79], [0.72, belt], [-0.85, belt + 0.02],
    [ra + 0.3, 0.88], [zR + 0.1, 0.92], [zR - 0.02, 0.9], [zR - 0.03, 0.46], [zR + 0.08, ride + 0.05]];
  b.side(bodyShape(top, ride, arches(t, 0.06), t.wheelR, true), W, 'paint', { bevel: 0.05, bevelSize: bs, curve: 2 });
  archLiners(b, t, W, ride, 0.06);
  archLips(b, t, W, ride, 0.06, { band: 0.06, proud: 0.03, kind: 'black' });
  crease(b, W, 0.46, ra + 0.4, fa - 0.4, { d: 0.035, h: 0.07, rise: -0.1 });
  shutGaps(b, t, W, [0.7, -0.84], ride + 0.12, belt - 0.06, 0.06, 0.06);
  const prof = [[0.74, belt], [-0.05, roof], [-0.6, roof], [-1.35, belt + 0.08]], gw = W - 0.36;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.74], zMin: -0.92, zMax: 0.7, pillar: 0.075, dlo: 'black', rearGlass: 'tint', hollow: true });
  cabin(b, t, prof, gw);
  b.pair(0.5, roof - 0.04, -0.9, 0.16, 0.16, 0.4, 'paint');                                 // C-pillar snorkels
  b.pair(0.5, roof - 0.04, -0.69, 0.12, 0.1, 0.02, 'black');
  slats(b, top, bs, -1.0, zR + 0.4, 7, W - 0.8);
  b.box(0, 1.0, zR + 0.4, 0.08, 0.2, 0.2, 'black');                                         // wing pylon
  wing(b, { y: 1.14, z: zR + 0.3, span: W - 0.1, chord: 0.36, aoa: 0.12, kind: 'black', stands: [], deckY: 0.92 });
  b.box(0, ride + 0.01, zF - 0.06, W - 0.06, 0.03, 0.4, 'black');                            // splitter
  b.pair(0.55, 0.26, zF + 0.03, 0.5, 0.16, 0.05, 'black', { rz: -0.2 });
  b.box(0, 0.22, zF + 0.04, 0.4, 0.08, 0.04, 'black');
  const hy = profY(top, fa + 0.45) + bs, sl = Math.atan2(0.42, zF - fa - 0.2);
  b.pair(0.6, hy, fa + 0.45, 0.36, 0.03, 0.16, 'housing', { rx: sl });
  b.pair(0.6, hy + 0.012, fa + 0.45, 0.3, 0.03, 0.1, 'head', { rx: sl });
  for (const r of [0.55, -0.55]) b.pair(0.62, 0.4, zF - 0.1, 0.22, 0.02, 0.02, 'drl', { rz: r });
  b.pair(0.88, 0.3, zF - 0.04, 0.1, 0.03, 0.03, 'amber');
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.3);
    b.box(x, 0.78, zR - 0.02, 0.44, 0.22, 0.03, 'housing');
    for (const r of [0.45, -0.45]) b.box(x, 0.78, zR - 0.04, 0.4, 0.03, 0.02, 'tail', { rz: r });
    b.box(x, 0.78, zR - 0.055, 0.08, 0.06, 0.01, 'brake');
  }
  b.pair(0.18, 0.66, zR - 0.03, 0.12, 0.03, 0.03, 'reverse');
  for (const x of [0.12, -0.12]) hexPipe(b, x, 0.48, zR - 0.03, 0.07);
  b.box(0, 0.24, zR + 0.15, W - 0.4, 0.24, 0.34, 'black');
  for (let i = -3; i <= 3; i++) b.box(i * 0.2, 0.2, zR + 0.1, 0.015, 0.16, 0.24, 'black');
  plates(b, 0, 0, 0.62, zR - 0.03, false);
  b.pair(W / 2 + 0.004, 0.5, -0.7, 0.012, 0.32, 0.55, 'black', { rx: 0.3 });
  mirrors(b, gw + 0.02, belt + 0.06, 0.6, 0.85);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.3, rr: 0.15, ride, shoulder: 0.62, tumble: 0.07 }),
    shade: { ride, belt, seams: [0.7, -0.84, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.06)[0][1] } };
}

// Flint S (sports, light mid-engine targa): short and compact, a black targa
// roof panel, oval lamps under clear covers, side scoops behind the doors,
// a raised engine lid with sail panels and twin round tails each side.
function carbon(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.12, belt = 0.78, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.03], [zF + 0.02, 0.3], [zF - 0.05, 0.44], [zF - 0.3, 0.62], [fa, 0.73], [fa - 0.3, 0.75], [0.55, belt - 0.01], [-0.65, belt],
    [ra + 0.25, 0.86], [zR + 0.1, 0.9], [zR - 0.01, 0.84], [zR - 0.03, 0.52], [zR + 0.06, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.05), t.wheelR, true), W, 'paint', { bevel: 0.09, bevelSize: bs });
  archLiners(b, t, W, ride, 0.05);
  archLips(b, t, W, ride, 0.05, { band: 0.035, proud: 0.02 });
  crease(b, W, 0.55, ra + 0.35, fa - 0.35, { d: 0.02, h: 0.05, rise: -0.04 });
  shutGaps(b, t, W, [0.52, -0.55], ride + 0.12, belt - 0.06, 0.05, 0.035);
  topGaps(b, top, bs, W / 2 - 0.22, 0.7, zF - 0.2, [zF - 0.2], W / 2 - 0.22);
  const prof = [[0.56, belt], [-0.05, roof], [-0.45, roof], [-0.95, belt + 0.06]], gw = W - 0.24;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.78], zMin: -0.7, zMax: 0.52, pillar: 0.075, dlo: 'black', rearGlass: 'tint', hollow: true, roofKind: 'black' });
  cabin(b, t, prof, gw);
  b.pair(0.66, 0.92, -1.15, 0.12, 0.12, 0.7, 'paint', { rx: 0.1 });                         // sail panels
  slats(b, top, bs, -1.0, zR + 0.3, 5, 0.9);
  b.box(0, 0.95, zR + 0.1, W - 0.45, 0.025, 0.18, 'black', { rx: -0.2 });
  for (const sx of [1, -1]) {
    b.cyl(sx * 0.58, 0.6, zF - 0.24, 0.1, 0.04, 'z', 'housing', 14);
    b.cyl(sx * 0.58, 0.6, zF - 0.21, 0.075, 0.03, 'z', 'head', 14);
    b.box(sx * 0.58, 0.56, zF - 0.2, 0.2, 0.016, 0.012, 'drl');
  }
  b.box(0, 0.3, zF + 0.0, 0.9, 0.12, 0.05, 'black');
  b.box(0, ride + 0.03, zF - 0.05, W - 0.36, 0.025, 0.18, 'black');
  b.pair(0.84, 0.34, zF - 0.08, 0.08, 0.03, 0.03, 'amber');
  for (const dx of [0.22, 0.42]) for (const sx of [1, -1]) roundLamp(b, sx * (W / 2 - dx), 0.76, zR - 0.04, 0.065, -1, 'tail');
  b.pair(0.14, 0.62, zR - 0.03, 0.1, 0.03, 0.03, 'reverse');
  exhaust(b, 0, 0.36, zR - 0.02, 0.06);
  b.box(0, 0.26, zR + 0.12, W - 0.5, 0.18, 0.26, 'black');
  plates(b, 0, 0, 0.58, zR - 0.04, false);
  b.pair(W / 2 + 0.004, 0.56, -0.68, 0.012, 0.22, 0.32, 'black');
  mirrors(b, gw, belt + 0.05, 0.42, 0.8);
  handles(b, W, belt - 0.08, [-0.2]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.48, rr: 0.36, ride, shoulder: 0.68, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.52, -0.55, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.05)[0][1] } };
}

// Apex GT (sports, rear-engine flat-six): front wings standing proud of a low
// bonnet with upright oval lamps, a fastback roof sweeping to the tail, wide rear
// haunches, a louvred engine lid, a full-width lamp bar and a ducktail with lip.
function apex(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.14, belt = 0.84, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.03], [zF + 0.02, 0.36], [zF - 0.05, 0.5], [zF - 0.4, 0.64], [0.9, 0.74], [0.75, belt - 0.02], [-0.6, belt],
    [ra + 0.3, belt + 0.06], [zR + 0.25, 0.88], [zR + 0.02, 0.84], [zR - 0.02, 0.6], [zR + 0.04, 0.36], [zR + 0.12, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W - 0.06, 'paint', { bevel: 0.09, bevelSize: bs });
  // proud front wings and rear haunches
  const wingF = bodyShape([[zF - 0.15, 0.4], [zF - 0.12, 0.62], [fa + 0.3, 0.76], [fa - 0.15, 0.8], [fa - 0.55, 0.76], [fa - 0.62, 0.5]], ride + 0.24, [[fa, t.wheelR + 0.06]], t.wheelR);
  const wingR = bodyShape([[ra + 0.75, 0.55], [ra + 0.6, 0.86], [ra + 0.1, 0.92], [ra - 0.4, 0.9], [zR + 0.15, 0.82], [zR + 0.12, 0.45]], ride + 0.24, [[ra, t.wheelR + 0.06]], t.wheelR);
  for (const sx of [1, -1]) {
    b.side(wingF, 0.34, 'paint', { x: sx * (W / 2 - 0.17), bevel: 0.08, bevelSize: 0.05 });
    b.side(wingR, 0.36, 'paint', { x: sx * (W / 2 - 0.18), bevel: 0.08, bevelSize: 0.05 });
  }
  archLiners(b, t, W, ride);
  archLips(b, t, W, ride, 0.06, { band: 0.03, proud: 0.012 });
  shutGaps(b, t, W, [0.72, -0.55], ride + 0.12, belt - 0.06);
  topGaps(b, top, bs, 0.42, 0.92, zF - 0.1, [zF - 0.1], 0.42);
  const prof = [[0.75, belt], [0.12, roof], [-0.4, roof], [-1.75, belt + 0.06]], gw = W - 0.36;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.78], splits: [-0.55], zMin: -1.05, zMax: 0.72, pillar: 0.07, hollow: true });
  cabin(b, t, prof, gw, { accent: '#c9a227' });
  slats(b, top, bs, zR + 0.55, zR + 0.25, 6, 0.8, { tilt: -0.5 });
  b.box(0, 0.92, zR + 0.12, W - 0.5, 0.025, 0.2, 'paint', { rx: -0.25 });
  b.box(0, 0.95, zR + 0.03, W - 0.5, 0.02, 0.02, 'black');
  for (const sx of [1, -1]) {
    b.cyl(sx * 0.66, 0.64, zF - 0.2, 0.11, 0.04, 'z', 'chrome', 14);
    b.cyl(sx * 0.66, 0.64, zF - 0.17, 0.085, 0.03, 'z', 'head', 14);
    b.cyl(sx * 0.66, 0.64, zF - 0.155, 0.04, 0.006, 'z', 'drl', 10);
  }
  b.box(0, 0.32, zF + 0.0, 1.2, 0.1, 0.05, 'black');
  b.pair(0.7, 0.3, zF - 0.02, 0.16, 0.04, 0.04, 'amber');
  b.box(0, ride + 0.03, zF - 0.06, W - 0.4, 0.025, 0.18, 'black');
  b.box(0, 0.76, zR - 0.01, W - 0.3, 0.05, 0.03, 'housing');
  b.box(0, 0.76, zR - 0.03, W - 0.36, 0.024, 0.02, 'tail');
  b.pair(W / 2 - 0.3, 0.76, zR - 0.045, 0.24, 0.02, 0.01, 'brake');
  b.pair(0.3, 0.66, zR - 0.03, 0.12, 0.03, 0.03, 'reverse');
  for (const x of [0.1, -0.1]) exhaust(b, x, 0.3, zR - 0.02, 0.05);
  b.box(0, 0.3, zR + 0.05, W - 0.6, 0.12, 0.14, 'black');
  plates(b, 0.3, zF + 0.04, 0.5, zR - 0.02);
  mirrors(b, gw + 0.08, belt + 0.04, 0.6, 0.9);
  handles(b, W - 0.06, belt - 0.1, [-0.15]);
  sills(b, W - 0.06, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.5, rr: 0.4, ride, shoulder: 0.76, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.72, -0.55, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Nocturne (sports, AWD twin-turbo six): faceted and dark. Flat planes with small
// radii, a high shoulder and shallow slit glass, a trapezoid grille, a bonnet vent
// pair, boomerang tails and a tall wing on outboard stands.
function nightshade(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.14, belt = 0.94, roof = t.height - 0.01, bs = 0.03;
  const top = [[zF - 0.02, ride + 0.03], [zF + 0.03, 0.44], [zF + 0.01, 0.62], [zF - 0.2, 0.74], [fa, 0.82], [0.9, 0.88], [0.78, belt - 0.02], [-1.15, belt],
    [zR + 0.4, belt + 0.03], [zR + 0.04, belt + 0.02], [zR - 0.01, 0.66], [zR + 0.04, 0.4], [zR + 0.1, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W, 'paint', { bevel: 0.05, bevelSize: bs, curve: 3 });
  archLiners(b, t, W, ride);
  archLips(b, t, W, ride, 0.06, { band: 0.05, proud: 0.03 });
  crease(b, W, belt - 0.12, zR + 0.15, zF - 0.2, { d: 0.035, h: 0.07 });
  crease(b, W, ride + 0.22, ra + 0.5, fa - 0.5, { d: 0.02, h: 0.05, rise: 0.04 });
  shutGaps(b, t, W, [0.76, -0.5], ride + 0.12, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.16, 0.95, zF - 0.2, [zF - 0.2], W / 2 - 0.16);
  topGaps(b, top, bs, W / 2 - 0.18, zR + 0.1, -1.3, [zR + 0.1], W / 2 - 0.18);
  const prof = [[0.78, belt], [0.12, roof], [-0.7, roof], [-1.2, belt + 0.02]], gw = W - 0.2;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.84], splits: [-0.5], zMin: -1.0, zMax: 0.75, pillar: 0.085, dlo: 'black', hollow: true });
  cabin(b, t, prof, gw);
  b.pair(0.3, profY(top, 1.3) + bs + 0.008, 1.3, 0.22, 0.016, 0.32, 'black');               // bonnet vents
  wing(b, { y: belt + 0.32, z: zR + 0.22, span: W - 0.14, chord: 0.28, aoa: 0.1, kind: 'black', stands: [0.7], deckY: belt + 0.03 });
  b.box(0, 0.4, zF + 0.05, 0.9, 0.26, 0.05, 'black');
  b.box(0, 0.4, zF + 0.075, 0.92, 0.012, 0.01, 'brushed', { color: C('#6f2bd1') });
  headlamps(b, W, 0.64, zF + 0.01, { w: 0.34, h: 0.06, inset: 0.08, proj: 3, repeater: [0.74, fa + 0.48] });
  b.box(0, ride + 0.02, zF - 0.02, W - 0.2, 0.03, 0.22, 'black');
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.22);
    b.box(x, 0.86, zR - 0.01, 0.4, 0.14, 0.04, 'housing');
    b.box(x - sx * 0.04, 0.89, zR - 0.03, 0.32, 0.025, 0.02, 'tail');
    b.box(x + sx * 0.1, 0.83, zR - 0.03, 0.025, 0.1, 0.02, 'tail', { rz: sx * 0.4 });
    b.box(x, 0.85, zR - 0.04, 0.1, 0.04, 0.01, 'brake');
  }
  b.box(0, 0.86, zR - 0.01, W - 1.0, 0.03, 0.03, 'tail');
  b.pair(0.3, 0.72, zR - 0.02, 0.12, 0.03, 0.03, 'reverse');
  b.box(0, 0.32, zR + 0.06, W - 0.4, 0.16, 0.16, 'black');
  for (const x of [0.5, 0.62]) { exhaust(b, x, 0.3, zR - 0.0, 0.04); exhaust(b, -x, 0.3, zR - 0.0, 0.04); }
  plates(b, 0.24, zF + 0.08, 0.6, zR - 0.01);
  mirrors(b, gw - 0.02, belt + 0.03, 0.66, 0.9);
  handles(b, W, belt - 0.1, [-0.05]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.2, rr: 0.14, ride, shoulder: 0.86, tumble: 0.05 }),
    shade: { ride, belt, seams: [0.76, -0.5, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Tracer RS (sports, FWD hot hatch): a tall short two-box. Raked screen, long roof,
// near-vertical tailgate under a roof spoiler, honeycomb grille with a red pinstripe,
// flared arches and a centre twin exit.
function bullet(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.15, belt = 0.9, roof = t.height - 0.02, bs = 0.05;
  const top = [[zF - 0.02, ride + 0.03], [zF + 0.03, 0.46], [zF + 0.0, 0.64], [zF - 0.25, 0.76], [0.98, belt - 0.02], [-1.6, belt + 0.02],
    [zR + 0.06, belt + 0.04], [zR - 0.0, 0.6], [zR + 0.03, 0.4], [zR + 0.08, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W - 0.06, 'paint', { bevel: 0.08, bevelSize: bs });
  for (const proud of [0.03]) archLips(b, t, W - 0.06, ride, 0.06, { band: 0.06, proud, kind: 'paint' });
  archLiners(b, t, W, ride);
  crease(b, W - 0.06, belt - 0.12, zR + 0.15, zF - 0.3, { d: 0.022, h: 0.06, rise: -0.05 });
  shutGaps(b, t, W - 0.06, [0.95, -0.35], ride + 0.12, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.2, 1.0, zF - 0.22, [zF - 0.22], W / 2 - 0.2);
  const prof = [[0.98, belt], [0.25, roof], [-1.78, roof - 0.02], [-1.98, belt + 0.04]], gw = W - 0.18;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.86], splits: [-0.35, -1.45], zMin: -1.88, zMax: 0.95, pillar: 0.07, dlo: 'black', rearGlass: 'tint', hollow: true });
  cabin(b, t, prof, gw, { seatZ: -0.55 });
  b.box(0, roof + 0.0, zR + 0.2, gw - 0.16, 0.04, 0.3, 'paint', { rx: 0.12 });                // roof spoiler
  b.box(0, roof - 0.04, zR + 0.05, gw - 0.3, 0.03, 0.04, 'brake');
  b.box(0, 0.42, zF + 0.04, 1.2, 0.22, 0.05, 'black');
  for (let i = 0; i < 4; i++) b.box(0, 0.34 + i * 0.05, zF + 0.065, 1.16, 0.008, 0.01, 'dark');
  b.box(0, 0.555, zF + 0.065, 1.2, 0.014, 0.01, 'white', { color: C('#d8141e') });
  headlamps(b, W - 0.06, 0.64, zF - 0.04, { w: 0.36, h: 0.09, inset: 0.08, proj: 2, repeater: [0.74, fa + 0.42] });
  b.box(0, ride + 0.03, zF - 0.02, W - 0.3, 0.03, 0.16, 'black');
  tailLamps(b, W - 0.06, 0.98, zR + 0.04, { w: 0.3, h: 0.14, ins: 0.04, wrap: 0.22 });
  b.box(0, 0.3, zR + 0.04, W - 0.4, 0.12, 0.1, 'black');
  for (const x of [0.08, -0.08]) exhaust(b, x, 0.3, zR + 0.0, 0.05);
  plates(b, 0.3, zF + 0.06, 0.72, zR + 0.01);
  mirrors(b, gw + 0.02, belt + 0.03, 0.85);
  handles(b, W - 0.06, belt - 0.1, [0.1]);
  sills(b, W - 0.06, ride + 0.07, ra + t.wheelR + 0.14, fa - t.wheelR - 0.14);
  antenna(b, -0.1, roof, -1.3, 0.2, -0.8);
  return { b, warp: shellWarp({ W: W - 0.06, zF, zR, rf: 0.42, rr: 0.18, ride, shoulder: 0.82, tumble: 0.04 }),
    shade: { ride, belt, seams: [0.95, -0.35, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Ironclad 69 (muscle, big-block V8): late-sixties fastback. Long bonnet with a
// raised dome and twin scoops, a full-width chrome-barred grille hiding the lamps,
// chrome bumpers, coke-bottle hips, tunnel-roof sail panels, a full-width tail panel.
function ironclad(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.2, belt = 0.88, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.06, ride + 0.05], [zF + 0.0, 0.5], [zF + 0.02, 0.74], [zF - 0.1, 0.8], [fa, 0.83], [0.95, 0.85], [0.72, belt - 0.02], [-0.5, belt - 0.02],
    [ra + 0.3, belt + 0.04], [zR + 0.2, belt + 0.03], [zR + 0.02, belt + 0.05], [zR - 0.0, 0.66], [zR + 0.04, 0.42], [zR + 0.1, ride + 0.05]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W - 0.06, 'paint', { bevel: 0.07, bevelSize: bs });
  const hip = bodyShape([[ra + 0.95, belt - 0.16], [ra + 0.4, belt - 0.02], [ra - 0.5, belt + 0.0], [ra - 0.85, belt - 0.16]], ride + 0.32, [[ra, t.wheelR + 0.06]], t.wheelR);
  for (const sx of [1, -1]) b.side(hip, 0.08, 'paint', { x: sx * (W / 2 - 0.04), bevel: 0.03, bevelSize: 0.02 });
  archLiners(b, t, W, ride);
  archLips(b, t, W - 0.06, ride, 0.06, { pick: [0] });
  crease(b, W - 0.06, belt - 0.1, zR + 0.15, zF - 0.15, { d: 0.025, h: 0.05 });
  shutGaps(b, t, W - 0.06, [0.7, -0.7], ride + 0.12, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.18, 0.98, zF - 0.12, [zF - 0.12], W / 2 - 0.18);
  const prof = [[0.72, belt], [0.05, roof], [-0.7, roof], [-1.7, belt + 0.04]], gw = W - 0.24;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.82], zMin: -1.05, zMax: 0.68, pillar: 0.075, hollow: true });
  cabin(b, t, prof, gw);
  b.pair(gw / 2 - 0.04, belt + 0.12, -1.35, 0.08, 0.2, 0.8, 'paint', { rx: 0.18 });       // tunnel-roof sails
  b.box(0, 0.9, 1.4, 0.7, 0.06, 1.1, 'paint');                                             // bonnet dome
  b.pair(0.18, 0.95, 1.6, 0.2, 0.06, 0.3, 'paint');
  b.pair(0.18, 0.95, 1.75, 0.16, 0.04, 0.012, 'black');
  b.box(0, 0.62, zF + 0.04, W - 0.26, 0.2, 0.04, 'black');
  for (let i = 0; i < 3; i++) b.box(0, 0.56 + i * 0.06, zF + 0.065, W - 0.3, 0.012, 0.012, 'chrome');
  b.pair(0.62, 0.63, zF + 0.05, 0.16, 0.05, 0.02, 'head');                                 // lamps behind the bars
  b.box(0, 0.44, zF + 0.04, W - 0.1, 0.09, 0.12, 'chrome');                                // bumpers
  b.box(0, 0.46, zR - 0.02, W - 0.1, 0.09, 0.12, 'chrome');
  b.pair(0.7, 0.38, zF + 0.02, 0.1, 0.04, 0.03, 'amber');
  b.box(0, 0.7, zR - 0.02, W - 0.2, 0.2, 0.03, 'chrome');
  b.box(0, 0.7, zR - 0.035, W - 0.26, 0.15, 0.02, 'tail');
  b.pair(W / 2 - 0.3, 0.7, zR - 0.05, 0.3, 0.08, 0.01, 'brake');
  b.box(0, 0.7, zR - 0.05, 0.36, 0.1, 0.01, 'black');
  b.pair(0.08, 0.38, zR - 0.02, 0.1, 0.04, 0.03, 'reverse');
  b.box(0, belt + 0.06, zR + 0.12, W - 0.4, 0.03, 0.14, 'paint', { rx: -0.3 });           // deck spoiler
  for (const x of [0.5, -0.5]) exhaust(b, x, 0.3, zR + 0.02, 0.05);
  plates(b, 0, 0, 0.56, zR - 0.05, false);
  mirrors(b, gw + 0.04, belt + 0.03, 0.55, 0.9, 'chrome');
  handles(b, W - 0.06, belt - 0.1, [-0.15]);
  sills(b, W - 0.06, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.06);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.22, rr: 0.2, ride, shoulder: 0.8, tumble: 0.03 }),
    shade: { ride, belt, seams: [0.7, -0.7, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Bulwark XR (muscle, supercharged V8): retro-modern and square-shouldered. Flat
// bonnet with a power bulge and a black heat extractor, a trapezoid grille with
// halo-ring lamps, an upright screen, a short boxy roof and a ducktail over a
// full-width segmented tail panel, quad pipes.
function dominator(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.17, belt = 0.95, roof = t.height - 0.01, bs = 0.04;
  const top = [[zF - 0.02, ride + 0.04], [zF + 0.03, 0.5], [zF + 0.04, 0.78], [zF - 0.04, 0.86], [fa, 0.9], [1.05, 0.92], [0.85, belt - 0.02], [-0.85, belt],
    [zR + 0.5, belt + 0.03], [zR + 0.05, belt + 0.06], [zR - 0.01, 0.72], [zR + 0.03, 0.44], [zR + 0.1, ride + 0.04]];
  b.side(bodyShape(top, ride, arches(t), t.wheelR, true), W - 0.04, 'paint', { bevel: 0.06, bevelSize: bs, curve: 4 });
  archLiners(b, t, W, ride);
  archLips(b, t, W - 0.04, ride, 0.06, { band: 0.05, proud: 0.025 });
  crease(b, W - 0.04, belt - 0.09, zR + 0.1, zF - 0.1, { d: 0.035, h: 0.08 });
  shutGaps(b, t, W - 0.04, [0.82, -0.75], ride + 0.12, belt - 0.07);
  topGaps(b, top, bs, W / 2 - 0.16, 1.05, zF - 0.06, [zF - 0.06], W / 2 - 0.16);
  const prof = [[0.85, belt], [0.2, roof], [-0.6, roof], [-1.45, belt + 0.06]], gw = W - 0.22;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.84], zMin: -1.05, zMax: 0.82, pillar: 0.08, dlo: 'black', hollow: true });
  cabin(b, t, prof, gw, { accent: '#b80e1a' });
  b.box(0, 0.94, 1.55, 0.7, 0.05, 1.1, 'paint');                                           // power bulge
  b.box(0, 0.97, 1.75, 0.42, 0.012, 0.34, 'black');
  for (let i = 0; i < 4; i++) b.box(0, 0.98, 1.62 + i * 0.08, 0.4, 0.012, 0.02, 'dark');
  // trapezoid grille and halo lamps
  b.box(0, 0.62, zF + 0.06, 1.3, 0.24, 0.04, 'black');
  b.box(0, 0.48, zF + 0.05, 1.0, 0.06, 0.04, 'black');
  for (const sx of [1, -1]) {
    b.cyl(sx * 0.68, 0.66, zF + 0.07, 0.085, 0.03, 'z', 'drl', 16);
    b.cyl(sx * 0.68, 0.66, zF + 0.085, 0.065, 0.02, 'z', 'housing', 16);
    b.cyl(sx * 0.68, 0.66, zF + 0.095, 0.045, 0.012, 'z', 'head', 14);
    b.box(sx * 0.42, 0.66, zF + 0.075, 0.2, 0.05, 0.02, 'head');
  }
  b.pair(0.82, 0.44, zF + 0.03, 0.12, 0.04, 0.03, 'amber');
  b.box(0, ride + 0.04, zF - 0.02, W - 0.24, 0.04, 0.18, 'black');
  b.box(0, belt + 0.09, zR + 0.12, W - 0.3, 0.03, 0.2, 'paint', { rx: -0.3 });              // ducktail
  b.box(0, 0.82, zR - 0.03, W - 0.16, 0.16, 0.03, 'black');
  for (let i = 0; i < 6; i++) {
    const x = 0.12 + i * 0.13;
    b.pair(x, 0.82, zR - 0.045, 0.1, 0.1, 0.02, 'tail');
    if (i > 3) b.pair(x, 0.82, zR - 0.058, 0.06, 0.06, 0.01, 'brake');
  }
  b.pair(0.05, 0.82, zR - 0.045, 0.05, 0.06, 0.02, 'reverse');
  b.box(0, 0.3, zR + 0.06, W - 0.3, 0.14, 0.14, 'black');
  for (const x of [0.48, 0.62]) { exhaust(b, x, 0.3, zR - 0.01, 0.048); exhaust(b, -x, 0.3, zR - 0.01, 0.048); }
  plates(b, 0, 0, 0.6, zR - 0.04, false);
  mirrors(b, gw + 0.02, belt + 0.03, 0.75, 0.95);
  handles(b, W - 0.04, belt - 0.1, [-0.1]);
  sills(b, W - 0.04, ride + 0.07, ra + t.wheelR + 0.12, fa - t.wheelR - 0.12, 0.12);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.22, rr: 0.16, ride, shoulder: 0.86, tumble: 0.02 }),
    shade: { ride, belt, seams: [0.82, -0.75, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t)[0][1] } };
}

// Royale GT (luxury, AWD W12 grand tourer): a long two-door coupe. Long bonnet with
// a wide chrome-meshed grille, twin round lamps each side, a frameless fastback
// glasshouse with chrome trim, haunched rear wings, slim oval tails, oval pipes.
function royale(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.18, belt = 0.92, roof = t.height - 0.01, bs = 0.05;
  const top = [[zF - 0.03, ride + 0.03], [zF + 0.03, 0.44], [zF + 0.0, 0.66], [zF - 0.22, 0.78], [fa, 0.84], [0.85, 0.88], [0.7, belt - 0.02], [-0.8, belt],
    [ra + 0.2, belt + 0.06], [zR + 0.3, belt + 0.05], [zR + 0.04, belt + 0.02], [zR - 0.01, 0.62], [zR + 0.04, 0.4], [zR + 0.1, ride + 0.03]];
  b.side(bodyShape(top, ride, arches(t, 0.07), t.wheelR, true), W - 0.04, 'paint', { bevel: 0.1, bevelSize: bs });
  const haunch = bodyShape([[ra + 0.95, belt - 0.14], [ra + 0.4, belt + 0.0], [ra - 0.5, belt + 0.02], [ra - 0.9, belt - 0.14]], ride + 0.3, [[ra, t.wheelR + 0.07]], t.wheelR);
  for (const sx of [1, -1]) b.side(haunch, 0.1, 'paint', { x: sx * (W / 2 - 0.05), bevel: 0.05, bevelSize: 0.03 });
  archLiners(b, t, W, ride, 0.07);
  archLips(b, t, W - 0.04, ride, 0.07, { band: 0.035, proud: 0.015, pick: [0] });
  crease(b, W - 0.04, belt - 0.14, zR + 0.3, zF - 0.3, { d: 0.02, h: 0.06, rise: -0.05 });
  shutGaps(b, t, W - 0.04, [0.68, -0.72], ride + 0.12, belt - 0.07, 0.07);
  topGaps(b, top, bs, W / 2 - 0.2, 0.9, zF - 0.15, [zF - 0.15], W / 2 - 0.2);
  const prof = [[0.7, belt], [0.0, roof], [-0.65, roof], [-1.75, belt + 0.06]], gw = W - 0.24;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.8], splits: [-0.72], zMin: -1.25, zMax: 0.66, pillar: 0.065, hollow: true });
  cabin(b, t, prof, gw, { accent: '#c9b48a' });
  b.box(0, 0.6, zF + 0.06, 0.9, 0.26, 0.04, 'black');
  for (let i = -5; i <= 5; i++) b.box(i * 0.08, 0.6, zF + 0.08, 0.008, 0.24, 0.01, 'chrome', { rz: 0.5 });
  for (let i = -5; i <= 5; i++) b.box(i * 0.08, 0.6, zF + 0.085, 0.008, 0.24, 0.01, 'chrome', { rz: -0.5 });
  b.box(0, 0.74, zF + 0.075, 0.94, 0.025, 0.03, 'chrome');
  b.box(0, 0.46, zF + 0.075, 0.94, 0.025, 0.03, 'chrome');
  for (const sx of [1, -1]) for (const [dx, r] of [[0.62, 0.075], [0.8, 0.06]]) roundLamp(b, sx * dx, 0.68, zF + 0.01, r, 1, 'head');
  b.pair(0.82, 0.5, zF + 0.03, 0.12, 0.03, 0.03, 'amber');
  b.box(0, ride + 0.04, zF - 0.03, W - 0.4, 0.03, 0.16, 'black');
  for (const sx of [1, -1]) {
    b.box(sx * (W / 2 - 0.25), 0.86, zR - 0.01, 0.4, 0.09, 0.04, 'housing');
    b.box(sx * (W / 2 - 0.25), 0.86, zR - 0.03, 0.34, 0.05, 0.02, 'tail');
    b.box(sx * (W / 2 - 0.25), 0.86, zR - 0.045, 0.16, 0.03, 0.01, 'brake');
  }
  b.box(0, 0.86, zR - 0.02, W - 1.0, 0.025, 0.03, 'chrome');
  b.pair(0.3, 0.7, zR - 0.02, 0.12, 0.03, 0.03, 'reverse');
  b.box(0, 0.34, zR + 0.05, W - 0.4, 0.12, 0.12, 'black');
  for (const sx of [1, -1]) { b.box(sx * 0.6, 0.32, zR - 0.01, 0.2, 0.08, 0.12, 'chrome'); b.box(sx * 0.6, 0.32, zR - 0.072, 0.16, 0.05, 0.004, 'under'); }
  plates(b, 0.4, zF + 0.06, 0.6, zR - 0.02);
  b.pair(W / 2 - 0.016, 0.62, fa - 0.65, 0.012, 0.06, 0.22, 'chrome');                    // wing vents
  mirrors(b, gw + 0.06, belt + 0.03, 0.6, 0.95);
  handles(b, W - 0.04, belt - 0.1, [-0.3]);
  sills(b, W - 0.04, ride + 0.07, ra + t.wheelR + 0.14, fa - t.wheelR - 0.14);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.4, rr: 0.36, ride, shoulder: 0.84, tumble: 0.04 }),
    shade: { ride, belt, seams: [0.68, -0.72, 99], seamY: [ride + 0.12, belt - 0.04], arch: arches(t, 0.07)[0][1] } };
}

// Executive V12 (luxury, long four-door fastback saloon): low, long and smooth: a wide
// horizontal-slat chrome grille, thin lamp blades, a roof that runs down into a
// short boot lip, six-light glass, chrome side strakes and a full-width tail blade.
function executive(t) {
  const b = new PartBuilder();
  const W = t.width, zF = t.length / 2, zR = -zF, fa = t.frontAxle, ra = t.rearAxle, ride = 0.24, belt = 0.94, roof = t.height - 0.02, bs = 0.05;
  const top = [[zF - 0.02, ride], [zF + 0.03, 0.48], [zF + 0.01, 0.68], [zF - 0.25, 0.8], [fa, 0.86], [1.1, 0.9], [0.95, belt - 0.02], [-1.6, belt],
    [zR + 0.25, belt + 0.03], [zR + 0.03, belt + 0.0], [zR - 0.01, 0.6], [zR + 0.04, 0.4], [zR + 0.1, ride]];
  b.side(bodyShape(top, ride, arches(t, 0.07), t.wheelR, true), W, 'paint', { bevel: 0.1, bevelSize: bs });
  archLiners(b, t, W, ride, 0.07);
  archLips(b, t, W, ride, 0.07, { band: 0.035, proud: 0.014 });
  crease(b, W, belt - 0.12, zR + 0.2, zF - 0.3, { d: 0.018, h: 0.05, rise: -0.03 });
  shutGaps(b, t, W, [0.92, -0.32, -1.4], ride + 0.1, belt - 0.07, 0.07, 0.035);
  topGaps(b, top, bs, W / 2 - 0.17, 1.2, zF - 0.12, [zF - 0.12], W / 2 - 0.17);
  const prof = [[0.95, belt], [0.2, roof], [-0.9, roof], [-2.0, belt + 0.03]], gw = W - 0.16;
  greenhouse(b, { prof, width: gw, taper: [belt, roof, 0.82], splits: [-0.32, -1.25], zMin: -1.75, zMax: 0.92, pillar: 0.065, hollow: true });
  cabin(b, t, prof, gw);
  b.box(0, 0.62, zF + 0.06, 1.0, 0.22, 0.04, 'black');
  for (let i = 0; i < 5; i++) b.box(0, 0.53 + i * 0.045, zF + 0.08, 0.98, 0.014, 0.012, 'chrome');
  b.box(0, 0.62, zF + 0.08, 1.04, 0.24, 0.02, 'chrome', { color: C('#aeb2b8') });
  headlamps(b, W, 0.74, zF - 0.02, { w: 0.4, h: 0.05, inset: 0.06, proj: 3, repeater: [0.82, fa + 0.5] });
  b.box(0, 0.38, zF + 0.04, W - 0.5, 0.1, 0.06, 'black');
  b.box(0, 0.9, zR - 0.01, W - 0.2, 0.05, 0.04, 'housing');
  b.box(0, 0.9, zR - 0.03, W - 0.26, 0.024, 0.02, 'tail');
  b.pair(W / 2 - 0.25, 0.9, zR - 0.045, 0.3, 0.02, 0.01, 'brake');
  b.pair(0.4, 0.8, zR - 0.02, 0.12, 0.03, 0.03, 'reverse');
  b.pair(0.55, 0.34, zR - 0.02, 0.24, 0.05, 0.06, 'chrome');
  b.pair(0.55, 0.34, zR - 0.052, 0.2, 0.03, 0.004, 'under');
  for (let i = 0; i < 3; i++) b.pair(W / 2 + 0.006, 0.52 + i * 0.05, fa - 0.62, 0.012, 0.014, 0.28 - i * 0.05, 'chrome');
  const s0 = ra + 0.5, s1 = fa - 0.9;
  b.pair(W / 2 + 0.008, 0.46, (s0 + s1) / 2, 0.012, 0.02, s1 - s0, 'chrome');
  plates(b, 0.4, zF + 0.06, 0.62, zR - 0.02);
  mirrors(b, gw + 0.02, belt + 0.03, 0.86, 1.0);
  handles(b, W, belt - 0.1, [0.2, -0.85]);
  sills(b, W, ride + 0.07, ra + t.wheelR + 0.14, fa - t.wheelR - 0.14);
  finAntenna(b, roof, -1.1);
  return { b, warp: shellWarp({ W, zF, zR, rf: 0.36, rr: 0.3, ride, shoulder: 0.88, tumble: 0.04 }),
    shade: { ride, belt, seams: [0.92, -0.32, -1.4], seamY: [ride + 0.12, belt - 0.03], arch: arches(t, 0.07)[0][1] } };
}

const BUILDERS = { sedan, police, sports, suv, pickup, van, truck, vortex, tempesta, stratos, corsa, phoenix, driftline, thunder, monarch,
  nemesis, inferno, venom, spectre, reaper, carbon, apex, nightshade, bullet, ironclad, dominator, royale, executive };

// lod: the distance level (see PartBuilder.lod): true / 1 simplified, 2 low; same
// silhouette, a fraction of the triangles.
export function buildVehicleGeometry(typeName, { lod = false } = {}) {
  const t = VEHICLE_TYPES[typeName];
  LOD = lod === true ? 1 : Number(lod) || 0;
  let built;
  try { built = BUILDERS[typeName](t); } finally { LOD = 0; }
  const { b, warp, shade } = built;
  if (warp) b.warp(warp);
  const g = b.build();
  const axles = arches(t, 0).map((a) => a[0]);
  g.userData.shade = { ...shade, halfW: t.width / 2, wheelR: t.wheelR, axles: [axles[0], axles[1], axles[2] ?? axles[1]] };
  return g;
}

// Wheel styles: spoke pattern, count and finish. Each style is one geometry and
// one instanced draw in the renderer (only drawn when a car wearing it is near).
export const WHEEL_STYLES = {
  twin5: { pattern: 'twin', n: 5, rim: 'rim' },
  turbine: { pattern: 'turbine', n: 10, rim: 'rimDark' },
  mesh10: { pattern: 'mesh', n: 10, rim: 'rim' },
  y5: { pattern: 'y', n: 5, rim: 'rim' },
  mono7: { pattern: 'mono', n: 7, rim: 'rimDark', w: 0.075 },
  star5: { pattern: 'mono', n: 5, rim: 'rimGun', w: 0.17 },
  dish6: { pattern: 'dish', n: 6, rim: 'rimBronze' },
  slot5: { pattern: 'slot', n: 5, rim: 'chrome' },
  multi14: { pattern: 'mono', n: 14, rim: 'chrome', w: 0.032 },
  // PASS 10a2
  aero6: { pattern: 'turbine', n: 6, rim: 'rim' },
  center5: { pattern: 'y', n: 5, rim: 'rimGun' },
  split10: { pattern: 'mesh', n: 5, rim: 'rimDark' },
  blade5: { pattern: 'mono', n: 5, rim: 'rimDark', w: 0.11 },
};
// a flat spoke between polar points (angle, radius) on the wheel face plane at x
function spoke(b, a0, r0, a1, r1, x, w, depth, kind) {
  const y0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0, y1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
  b.box(x, (y0 + y1) / 2, (z0 + z1) / 2, depth, Math.hypot(y1 - y0, z1 - z0), w, kind, { rx: Math.atan2(z1 - z0, y1 - y0) });
}
// turn an open surface inside out (so a dish is seen from within)
function inside(g) {
  g = g.toNonIndexed();
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
  for (let i = 0; i < N.length; i += 9) for (let k = 0; k < 3; k++) { const t = N[i + 3 + k]; N[i + 3 + k] = -N[i + 6 + k]; N[i + 6 + k] = -t; N[i + k] = -N[i + k]; }
  return g;
}

// Unit wheel (radius 1, width 1, axle along x), detailed face at +x (outboard;
// the renderer turns left/right wheels so it always faces out): a tyre with a
// rounded shoulder and a sidewall bulge, a dark rim barrel with a bright outer
// lip of real depth, a brake disc behind the spokes (pattern per style), lug
// nuts and a centre cap. ~470-700 triangles.
export function buildWheelGeometry(styleName = 'twin5') {
  const st = WHEEL_STYLES[styleName] || WHEEL_STYLES.twin5, rim = st.rim;
  const b = new PartBuilder();
  const prof = [[0.66, -0.5], [0.86, -0.49], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.49], [0.7, 0.5]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof.reverse(), 16);
  tyre.rotateZ(Math.PI / 2);
  smoothNormals(tyre, 50);
  b.add(tyre, new THREE.Matrix4(), 'rubber');
  const inner = new THREE.CircleGeometry(0.68, 10);
  inner.rotateY(-Math.PI / 2);
  b.add(inner, new THREE.Matrix4().makeTranslation(-0.45, 0, 0), 'under');
  // rim barrel: an open dark tube from the inner face to the lip, so the wheel has depth
  const barrel = new THREE.CylinderGeometry(0.66, 0.66, 0.5, 16, 1, true);
  barrel.rotateZ(Math.PI / 2);
  b.add(barrel, new THREE.Matrix4().makeTranslation(0.2, 0, 0), 'under');
  const back = new THREE.CircleGeometry(0.66, 16);
  back.rotateY(Math.PI / 2);
  b.add(back, new THREE.Matrix4().makeTranslation(0.0, 0, 0), 'under');
  // brake disc and hat, seen through the spokes
  const disc = new THREE.RingGeometry(0.2, 0.52, 16, 1);
  disc.rotateY(Math.PI / 2);
  b.add(disc, new THREE.Matrix4().makeTranslation(0.12, 0, 0), 'brushed');
  // outer lip: a short bright cylinder plus its front face ring (a wide flat lip on a dish)
  const lipBand = new THREE.CylinderGeometry(0.69, 0.69, 0.06, 16, 1, true);
  lipBand.rotateZ(Math.PI / 2);
  b.add(lipBand, new THREE.Matrix4().makeTranslation(0.45, 0, 0), rim);
  const lip = new THREE.RingGeometry(st.pattern === 'dish' ? 0.56 : 0.6, 0.69, 16);
  lip.rotateY(Math.PI / 2);
  b.add(lip, new THREE.Matrix4().makeTranslation(0.48, 0, 0), rim);
  const n = st.n, TAU = Math.PI * 2;
  let hubX = 0.42;
  if (st.pattern === 'twin') {
    for (let k = 0; k < 5; k++) {
      // twin spokes, dished: hub proud of the lip
      for (const da of [-0.17, 0.17]) {
        const a = (k / 5) * TAU + da * 0.55;
        b.box(0.39, Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.07, 0.46, 0.065, rim, { rx: a - da * 0.35 });
      }
    }
  } else if (st.pattern === 'mono') {
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU; spoke(b, a, 0.14, a, 0.63, 0.39, st.w, 0.07, rim); }
  } else if (st.pattern === 'y') {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      spoke(b, a, 0.14, a, 0.4, 0.4, 0.08, 0.07, rim);
      for (const d of [-0.27, 0.27]) spoke(b, a, 0.36, a + d, 0.63, 0.385, 0.05, 0.06, rim);
    }
  } else if (st.pattern === 'mesh') {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      spoke(b, a, 0.16, a + 0.4, 0.63, 0.4, 0.035, 0.05, rim);
      spoke(b, a, 0.16, a - 0.4, 0.63, 0.375, 0.035, 0.05, rim);
    }
    const ring = new THREE.RingGeometry(0.15, 0.24, 14);
    ring.rotateY(Math.PI / 2);
    b.add(ring, new THREE.Matrix4().makeTranslation(0.43, 0, 0), rim);
  } else if (st.pattern === 'turbine') {
    const face = new THREE.CircleGeometry(0.61, 18);
    face.rotateY(Math.PI / 2);
    b.add(face, new THREE.Matrix4().makeTranslation(0.4, 0, 0), rim);
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU; spoke(b, a, 0.2, a + 0.55, 0.6, 0.425, 0.03, 0.05, 'rim'); }
  } else if (st.pattern === 'dish') {
    // deep dish: a bright cone from the wide lip down to spokes set far inboard
    const cone = new THREE.CylinderGeometry(0.47, 0.57, 0.3, 16, 1, true);
    cone.rotateZ(Math.PI / 2);
    b.add(inside(cone), new THREE.Matrix4().makeTranslation(0.33, 0, 0), rim);
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU; spoke(b, a, 0.12, a, 0.49, 0.2, 0.11, 0.06, rim); }
    hubX = 0.22;
  } else if (st.pattern === 'slot') {
    const face = new THREE.CircleGeometry(0.61, 20);
    face.rotateY(Math.PI / 2);
    b.add(face, new THREE.Matrix4().makeTranslation(0.41, 0, 0), rim);
    for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * TAU; spoke(b, a, 0.27, a, 0.5, 0.415, 0.1, 0.004, 'under'); }
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5 + 0.1) * TAU;
    b.box(hubX + 0.055, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.03, 0.035, 0.035, 'chrome', { rx: a });   // lug nut
  }
  b.cyl(hubX, 0, 0, 0.17, 0.1, 'x', rim, 10);
  b.cyl(hubX + 0.06, 0, 0, 0.075, 0.012, 'x', 'chrome', 8);
  return b.build();
}

// Distance wheel: a plain tyre drum and a rim disc (~50 triangles).
export function buildWheelLOD() {
  const b = new PartBuilder();
  const drum = new THREE.CylinderGeometry(0.98, 0.98, 0.94, 10, 1, true);
  drum.rotateZ(Math.PI / 2);
  b.add(drum, new THREE.Matrix4(), 'rubber');
  const face = new THREE.CircleGeometry(0.66, 8);
  face.rotateY(Math.PI / 2);
  b.add(face, new THREE.Matrix4().makeTranslation(0.46, 0, 0), 'rimGun');
  const ring = new THREE.RingGeometry(0.66, 0.98, 10, 1);
  ring.rotateY(Math.PI / 2);
  b.add(ring, new THREE.Matrix4().makeTranslation(0.47, 0, 0), 'rubber');
  return b.build();
}
