// Vehicle contacts. Each car is a row of circles along its centreline (rounded
// box). Static boxes (buildings, poles, trees, benches, rails, bounds) and other
// cars respond with impulses at the contact point, so hits spin the car as
// well as stopping it. Kerbs are slab edges: a shallow approach scrubs along
// the kerb, a square one mounts it with a jolt. Run inside swept substeps.
import { CITY } from '../config.js';

const BOUNDS = [
  { x0: -400, x1: CITY.bounds.x0 - 0.5, z0: -400, z1: 400, y0: 0, y1: 9 },
  { x0: CITY.bounds.x1 + 0.5, x1: 400, z0: -400, z1: 400, y0: 0, y1: 9 },
  { x0: -400, x1: 400, z0: -400, z1: CITY.bounds.z0 - 0.5, y0: 0, y1: 9 },
];

// Fast ground height: road 0, pavement slabs at kerb height, indexed on a grid.
export function makeGround(layout) {
  const cell = 16, grid = new Map();
  const key = (i, j) => i * 4096 + j;
  for (const s of layout.slabs) {
    for (let i = Math.floor(s.x0 / cell); i <= Math.floor(s.x1 / cell); i++) {
      for (let j = Math.floor(s.z0 / cell); j <= Math.floor(s.z1 / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  const slabAt = (x, z) => {
    const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    if (list) for (const s of list) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
    return null;
  };
  const height = (x, z) => (slabAt(x, z) ? CITY.kerbH : 0);
  const nearSlabs = (x, z) => grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? [];
  return { height, slabAt, nearSlabs };
}

export function cruiserObstruction(v, colliders, ground) {
  const { radius, height, circles } = v.type;
  const sin = Math.sin(v.yaw), cos = Math.cos(v.yaw);
  let wall = false, kerb = false;
  const overlaps = (x, z, box) => {
    const dx = Math.max(box.x0 - x, x - box.x1, 0);
    const dz = Math.max(box.z0 - z, z - box.z1, 0);
    return dx * dx + dz * dz < (radius - 0.001) ** 2;
  };
  for (const offset of circles) {
    const x = v.x + sin * offset, z = v.z + cos * offset;
    for (const b of colliders.query(x - radius, z - radius, x + radius, z + radius, tmpList)) {
      if (b.y1 >= 0.3 && b.y0 <= height * 0.9 && overlaps(x, z, b)) wall = true;
    }
    for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) {
      if (ground.nearSlabs(x + dx, z + dz).some((b) => overlaps(x, z, b))) kerb = true;
    }
  }
  return { wall, kerb };
}

const tmpList = [];

// Push one vehicle out of the static world. Returns the largest impulse (m/s).
export function resolveStatic(v, colliders, onHit) {
  const t = v.type;
  const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
  const R = t.radius;
  let worst = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const cz of t.circles) {
      const px = v.x + s * cz, pz = v.z + co * cz;
      const list = colliders.query(px - R, pz - R, px + R, pz + R, tmpList);
      let nx = 0, nz = 0, depth = 0;
      const test = (b) => {
        if (b.y1 < 0.3 || b.y0 > t.height * 0.9) return;
        const qx = Math.max(b.x0, Math.min(px, b.x1)), qz = Math.max(b.z0, Math.min(pz, b.z1));
        let dx = px - qx, dz = pz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) return;
        let d = Math.sqrt(d2), pen;
        if (d > 1e-6) { dx /= d; dz /= d; pen = R - d; }
        else {
          const l = px - b.x0, r = b.x1 - px, n = pz - b.z0, so = b.z1 - pz;
          const mn = Math.min(l, r, n, so);
          if (mn === l) { dx = -1; dz = 0; } else if (mn === r) { dx = 1; dz = 0; } else if (mn === n) { dx = 0; dz = -1; } else { dx = 0; dz = 1; }
          pen = mn + R;
        }
        if (pen > depth) { depth = pen; nx = dx; nz = dz; }
      };
      for (const b of list) test(b);
      for (const b of BOUNDS) test(b);
      if (depth <= 0) continue;
      v.x += nx * depth; v.z += nz * depth;
      const j = impulse(v, px - nx * R - v.x, pz - nz * R - v.z, nx, nz, 0.22, 0.35);
      if (j > worst) worst = j;
    }
  }
  if (worst > 0.5 && onHit) onHit(v, worst);
  return worst;
}

// Impulse on a single body at offset (rx, rz) from its centre along normal n.
function impulse(v, rx, rz, nx, nz, e, mu) {
  const t = v.type;
  const vcx = v.vx + v.r * rz, vcz = v.vz - v.r * rx;   // point velocity (w x r with w along +y)
  const vn = vcx * nx + vcz * nz;
  if (vn >= 0) return 0;
  const rn = rz * nx - rx * nz;
  const k = 1 / t.mass + (rn * rn) / t.inertia;
  const j = -(1 + e) * vn / k;
  v.vx += (j * nx) / t.mass; v.vz += (j * nz) / t.mass; v.r += (j * rn) / t.inertia;
  // friction along the surface
  const tx = -nz, tz = nx;
  const vt = vcx * tx + vcz * tz;
  const rt = rz * tx - rx * tz;
  const kt = 1 / t.mass + (rt * rt) / t.inertia;
  const jt = Math.max(-mu * j, Math.min(mu * j, -vt / kt));
  v.vx += (jt * tx) / t.mass; v.vz += (jt * tz) / t.mass; v.r += (jt * rt) / t.inertia;
  return j / t.mass;
}

// Kerbs: called after the move. If a wheel has crossed onto a pavement slab,
// either deflect (glancing / slow) or mount it (square / fast).
export function resolveKerbs(v, ground, prevX, prevZ, prevYaw) {
  const wl = v.wheels();
  const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
  const ps = Math.sin(prevYaw), pc = Math.cos(prevYaw);
  for (const [lx, lz] of wl) {
    const wx = v.x + co * lx + s * lz, wz = v.z - s * lx + co * lz;
    const ox = prevX + pc * lx + ps * lz, oz = prevZ - ps * lx + pc * lz;
    const slab = ground.slabAt(wx, wz);
    if (!slab || ground.slabAt(ox, oz)) continue;
    // outward normal of the crossed edge (towards the road)
    const dl = wx - slab.x0, dr = slab.x1 - wx, dn = wz - slab.z0, ds = slab.z1 - wz;
    const mn = Math.min(dl, dr, dn, ds);
    let nx = 0, nz = 0;
    if (mn === dl) nx = -1; else if (mn === dr) nx = 1; else if (mn === dn) nz = -1; else nz = 1;
    const rx = wx - v.x, rz = wz - v.z;
    const vcx = v.vx + v.r * rz, vcz = v.vz - v.r * rx;
    const into = -(vcx * nx + vcz * nz);
    if (into <= 0) continue;
    if (into < 2.2 && into < 0.45 * Math.hypot(vcx, vcz)) {
      // glancing: scrub along the kerb: push the wheel back onto the road and bounce lightly
      v.x += nx * (mn + 0.02); v.z += nz * (mn + 0.02);
      impulse(v, rx, rz, nx, nz, 0.15, 0.2);
    } else {
      // mount it: lose some of the speed into the kerb
      const loss = Math.min(into, 0.8 + into * 0.18);
      v.vx += nx * loss; v.vz += nz * loss;
      v.impact = Math.max(v.impact, loss * 0.6);
    }
  }
}

// Car against car: circle pairs, positional split by inverse mass, impulse with spin.
export function resolvePair(A, B, onHit, onPair) {
  const ta = A.type, tb = B.type;
  const dx0 = A.x - B.x, dz0 = A.z - B.z;
  const reach = (ta.length + tb.length) / 2 + 0.2;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return;
  const sa = Math.sin(A.yaw), ca = Math.cos(A.yaw), sb = Math.sin(B.yaw), cb = Math.cos(B.yaw);
  let best = 0, bnx = 0, bnz = 0, bpx = 0, bpz = 0;
  for (const za of ta.circles) {
    const ax = A.x + sa * za, az = A.z + ca * za;
    for (const zb of tb.circles) {
      const bx = B.x + sb * zb, bz = B.z + cb * zb;
      const dx = ax - bx, dz = az - bz, d2 = dx * dx + dz * dz, rr = ta.radius + tb.radius;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4, pen = rr - d;
      if (pen > best) { best = pen; bnx = dx / d; bnz = dz / d; bpx = bx + bnx * tb.radius; bpz = bz + bnz * tb.radius; }
    }
  }
  if (best <= 0) return;
  A.wake(); B.wake();
  const wa = 1 / ta.mass, wb = 1 / tb.mass, ws = wa + wb;
  A.x += bnx * best * (wa / ws); A.z += bnz * best * (wa / ws);
  B.x -= bnx * best * (wb / ws); B.z -= bnz * best * (wb / ws);
  const rax = bpx - A.x, raz = bpz - A.z, rbx = bpx - B.x, rbz = bpz - B.z;
  const vax = A.vx + A.r * raz, vaz = A.vz - A.r * rax;
  const vbx = B.vx + B.r * rbz, vbz = B.vz - B.r * rbx;
  const vn = (vax - vbx) * bnx + (vaz - vbz) * bnz;
  if (vn >= 0) return;
  const rna = raz * bnx - rax * bnz, rnb = rbz * bnx - rbx * bnz;
  const k = wa + wb + (rna * rna) / ta.inertia + (rnb * rnb) / tb.inertia;
  const j = -(1 + 0.25) * vn / k;
  onPair?.(A, B, -vn, bnx, bnz);
  A.vx += j * bnx * wa; A.vz += j * bnz * wa; A.r += (j * rna) / ta.inertia;
  B.vx -= j * bnx * wb; B.vz -= j * bnz * wb; B.r -= (j * rnb) / tb.inertia;
  if (onHit) { onHit(A, j * wa); onHit(B, j * wb); }
}

// Push a walking character (circle) out of a vehicle. Mutates p.
export function pushOutOfVehicle(p, r, v) {
  const t = v.type;
  const dx0 = p.x - v.x, dz0 = p.z - v.z;
  if (dx0 * dx0 + dz0 * dz0 > (t.length / 2 + r + 0.5) ** 2) return false;
  // oriented box test in car space
  const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
  const lx = dx0 * co - dz0 * s, lz = dx0 * s + dz0 * co;
  const hx = t.width / 2 + r, hz = t.length / 2 + r;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return false;
  const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz);
  let nlx = 0, nlz = 0;
  if (ox < oz) nlx = Math.sign(lx) * ox; else nlz = Math.sign(lz) * oz;
  p.x += nlx * co + nlz * s;
  p.z += -nlx * s + nlz * co;
  return true;
}
