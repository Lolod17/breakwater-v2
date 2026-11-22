// Static collision world: axis-aligned boxes in a uniform spatial hash.
// Used for player push-out (circle vs box in XZ) and camera rays (3D slab test).

export class Colliders {
  constructor(cell = 8) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this._stamp = 0;
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  add(x0, y0, z0, x1, y1, z1, tag = 'solid') {
    const b = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), tag, mark: 0 };
    this.boxes.push(b);
    const c = this.cell;
    for (let ix = Math.floor(b.x0 / c); ix <= Math.floor(b.x1 / c); ix++) {
      for (let iz = Math.floor(b.z0 / c); iz <= Math.floor(b.z1 / c); iz++) {
        const k = this._key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    }
    return b;
  }

  addCircle(x, z, r, h, tag) { return this.add(x - r, 0, z - r, x + r, h, z + r, tag); }

  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const b of list) if (b.mark !== stamp) { b.mark = stamp; out.push(b); }
      }
    }
    return out;
  }

  // Push a vertical capsule (circle radius r between y0..y1) out of boxes. Mutates p.
  resolveCircle(p, r, y0, y1) {
    const list = this.query(p.x - r, p.z - r, p.x + r, p.z + r, this._tmp || (this._tmp = []));
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of list) {
        if (y1 <= b.y0 || y0 >= b.y1) continue;
        const cx = Math.max(b.x0, Math.min(p.x, b.x1));
        const cz = Math.max(b.z0, Math.min(p.z, b.z1));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // centre inside: leave by the nearest face
          const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, s = b.z1 - p.z;
          const m = Math.min(l, rr, n, s);
          if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r;
          else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
    }
    return hit;
  }

  // Nearest hit distance along a ray (dir normalised) up to maxDist, or maxDist.
  raycast(o, d, maxDist) {
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const list = this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), this._rtmp || (this._rtmp = []));
    let best = maxDist;
    for (const b of list) {
      const t = rayBox(o, d, b);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
}

function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oa, da, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return -1; continue; }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
