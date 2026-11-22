// PASS 17c: invisible walls. Two passes over the real build (seed 1337):
//
// 1. Static: every collider face that borders reachable ground (walkable for the player, inside the car
//    bounds for a car) is sampled every 0.5 m at body height. From 0.5 m outside the face a ray is cast
//    back into it against the drawn triangles (merged district, instanced props with every instance
//    expanded, plazas, harbour, customs site). A face sample whose drawn surface is more than TOL behind
//    the collider face (or missing) is an invisible blocker. The same test runs across the walkable
//    bounds (CITY.bounds, the jetty) and the vehicle bound boxes: a stop there needs a drawn barrier.
//    Open ground is also checked directly: road, pavement and promenade sample points covered by a
//    collider (or cut off by a bound) are counted per tag.
// 2. Dynamic: walk (pavement and carriageway lanes) and drive (keep-right lanes, both directions) the
//    full length of every street, and the promenade, through the real controller. Each stall is
//    classified: traffic/pedestrian (dynamic, skipped), drawn obstacle (visible, hopped), the end of a
//    street at a drawn barrier (visible end) or invisible (nothing drawn where the movement stopped).
//
// Exit code 1 if any invisible blocker is found.
import { launch, startServer, watchPage } from './cdp.mjs';

const headed = process.argv.includes('--headed');
const quick = process.argv.includes('--static');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);   // 'walk' or 'drive'
const server = await startServer(8095);
const page = await launch({ headless: !headed, port: 9439 });
const watch = watchPage(page, new URL(server.url).host);

const SETUP = String.raw`(() => {
  const W = window.__world, scene = window.__scene, g = window.__game;
  const C = W.colliders, L = W.layout;
  const V3 = scene.position.constructor, M4 = scene.matrixWorld.constructor;
  const TOL = 0.3;            // drawn surface may sit this far inside the collider face
  const Y0 = 0.2, Y1 = 2.2;   // body-height band we index
  const R = { x0: -240, x1: 250, z0: -240, z1: 300 };
  // ---- 1. drawn triangles in the body-height band, 2 m grid
  const SKIP = /^(pedestrians|vehicles|police|mission|rain|glow-sprites|light-shafts|far-city|harbour-tags|facade-kit)/;
  const tris = [];
  const cell = 2, grid = new Map();
  const key = (i, k) => i * 100003 + k;
  const pPos = { x: g.player().x, z: g.player().z };
  const a = new V3(), b = new V3(), c = new V3(), m = new M4(), im = new M4();
  const seen = new Set();
  function addTri(A, B, Cc) {
    const y0 = Math.min(A.y, B.y, Cc.y), y1 = Math.max(A.y, B.y, Cc.y);
    if (y1 < Y0 || y0 > Y1) return;
    const x0 = Math.min(A.x, B.x, Cc.x), x1 = Math.max(A.x, B.x, Cc.x), z0 = Math.min(A.z, B.z, Cc.z), z1 = Math.max(A.z, B.z, Cc.z);
    if (x1 < R.x0 || x0 > R.x1 || z1 < R.z0 || z0 > R.z1) return;
    if (x1 - x0 > 400 || z1 - z0 > 400) return;            // sky dome / ground plane
    if (Math.hypot((x0 + x1) / 2 - pPos.x, (z0 + z1) / 2 - pPos.z) < 2.5) return;   // the player's own body
    const id = tris.length / 9;
    tris.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
        const kk = key(i, k); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(id);
      }
  }
  function gather(mesh, mat) {
    const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const at = (i, v) => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mat);
    for (let i = 0; i + 2 < n; i += 3) addTri(at(i, a), at(i + 1, b), at(i + 2, c));
  }
  const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || SKIP.test(p.name || '')) return false; return true; };
  // instanced props are culled to 145 m round the camera: sweep the camera over the district to see them all
  const inst = new Map();
  scene.updateMatrixWorld(true);
  for (let x = -240; x <= 260; x += 100) for (let z = -240; z <= 260; z += 100) {
    W.props.update(0, { position: { x, y: 2, z } });
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !visible(o)) return;
      let s = inst.get(o); if (!s) inst.set(o, (s = new Map()));
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        const e = im.elements, k = e[12].toFixed(2) + ',' + e[13].toFixed(2) + ',' + e[14].toFixed(2) + ',' + e[0].toFixed(3) + ',' + e[2].toFixed(3);
        if (!s.has(k)) s.set(k, im.clone());
      }
    });
  }
  scene.traverse((o) => {
    if (!o.isMesh || !visible(o) || !o.geometry?.attributes?.position) return;
    if (o.isInstancedMesh) { for (const mi of inst.get(o)?.values() ?? []) gather(o, m.multiplyMatrices(o.matrixWorld, mi)); }
    else gather(o, o.matrixWorld);
  });
  W.props.update(0, { position: { x: pPos.x + 1000, y: 2, z: 0 } });   // force a re-cull at the next real frame
  const T = new Float32Array(tris);
  // ray (horizontal or not) vs triangles, double-sided; returns the nearest t or Infinity
  const stampArr = new Uint32Array(T.length / 9); let stamp = 0;
  function ray(ox, oy, oz, dx, dy, dz, maxT) {
    stamp++;
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    let best = Infinity;
    for (let i = Math.floor(Math.min(ox, ex) / cell); i <= Math.floor(Math.max(ox, ex) / cell); i++)
      for (let k = Math.floor(Math.min(oz, ez) / cell); k <= Math.floor(Math.max(oz, ez) / cell); k++) {
        const l = grid.get(key(i, k)); if (!l) continue;
        for (const id of l) {
          if (stampArr[id] === stamp) continue; stampArr[id] = stamp;
          const o = id * 9;
          const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
          const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
          const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t >= 0 && t <= maxT && t < best) best = t;
        }
      }
    return best;
  }
  // is something drawn within TOL beyond the blocking face, seen from (x,z) looking along (dx,dz)?
  // A few heights across the overlap of the blocker and the body, so low rails and kerb-high benches count.
  function drawnAhead(x, z, dx, dz, dist, y0, y1) {
    const lo = Math.max(y0 + 0.05, 0.25), hi = Math.min(y1 - 0.05, 1.8);
    // every 5 cm: thin rails, bench slats and seat edges count as drawn
    if (!(hi > lo)) return ray(x, Math.max(0.2, (y0 + y1) / 2), z, dx, 0, dz, dist + TOL) <= dist + TOL;
    for (let h = lo; h <= hi + 1e-6; h += 0.05) if (ray(x, h, z, dx, 0, dz, dist + TOL) <= dist + TOL) return true;
    return false;
  }
  // ---- ground classes for the open-ground census
  const S = [-200, -120, -40, 40, 120, 200], RH = 6;
  const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const lots = L.blocks.map((b) => b.lot).concat(L.outerBlocks.map((b) => b.lot));
  const slabs = L.slabs;
  function groundClass(x, z) {
    if (lots.some((l) => inRect(l, x, z))) return null;               // building lots (plazas are lots too)
    if (slabs.some((s) => inRect(s, x, z))) return z > 200 + RH && z < 226 ? 'promenade' : 'pavement';
    if (z > 226) return null;
    return 'road';
  }
  // a stall against box b from (x, z): drawn geometry within TOL past the collider face, looking at the
  // closest point and at the box centre (thin poles: the closest point of the box can sit beside the pole)
  function stallVisible(x, z, b, y0, y1) {
    const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
    const d = Math.hypot(cx - x, cz - z);
    if (d > 1e-3 && drawnAhead(x, z, (cx - x) / d, (cz - z) / d, d, y0, y1)) return true;
    const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2, dm = Math.hypot(mx - x, mz - z);
    return dm > 1e-3 && drawnAhead(x, z, (mx - x) / dm, (mz - z) / dm, d, y0, y1);
  }
  window.__pw = { W, g, C, L, ray, drawnAhead, stallVisible, groundClass, TOL, tris: T.length / 9 };
  return { triangles: T.length / 9, colliders: C.boxes.length, instancedMeshes: inst.size };
})()`;

const STATIC = String.raw`(() => {
  const { W, g, C, L, drawnAhead, groundClass, TOL } = window.__pw;
  const bounds = window.__pwBounds;
  const walk = (x, z) => L.walkable(x, z);
  const carOK = (x, z) => x > bounds.x0 - 0.5 && x < bounds.x1 + 0.5 && z > bounds.z0 - 0.5 && z < 227;
  const inBox = (b, x, z, y0, y1) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y1 > b.y0 && y0 < b.y1;
  const blockedAt = (x, z, y0, y1, except) => C.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01).some((b) => b !== except && inBox(b, x, z, y0, y1));
  const report = [];
  const perTag = {};
  // ---- collider faces
  for (const b of C.boxes) {
    const footPlayer = b.y1 > 0.25 && b.y0 < 1.9, footCar = b.y1 >= 0.3 && b.y0 <= 1.4;
    if (!footPlayer && !footCar) continue;
    if (b.x1 < bounds.x0 - 3 || b.x0 > bounds.x1 + 3 || b.z1 < bounds.z0 - 3 || b.z0 > 300) continue;
    let bad = 0, exposed = 0, worst = null;
    for (const [nx, nz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const len = nx ? b.z1 - b.z0 : b.x1 - b.x0;
      const n = Math.max(1, Math.ceil(len / 0.5));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const fx = nx ? (nx < 0 ? b.x0 : b.x1) : b.x0 + u * (b.x1 - b.x0);
        const fz = nz ? (nz < 0 ? b.z0 : b.z1) : b.z0 + u * (b.z1 - b.z0);
        const qx = fx + nx * 0.5, qz = fz + nz * 0.5;
        const gy = W.groundHeight(qx, qz);
        const reachP = footPlayer && walk(qx, qz) && !blockedAt(qx, qz, gy + 0.25, gy + 1.75, b);
        const reachC = footCar && carOK(qx, qz) && groundClass(qx, qz) && !blockedAt(qx, qz, 0.3, 1.3, b);
        if (!reachP && !reachC) continue;
        exposed++;
        if (drawnAhead(qx, qz, -nx, -nz, 0.5, b.y0, b.y1)) continue;
        bad++;
        if (!worst) worst = { x: +fx.toFixed(2), z: +fz.toFixed(2), face: nx ? (nx < 0 ? 'W' : 'E') : (nz < 0 ? 'N' : 'S'), by: reachP ? 'foot' : 'car' };
      }
    }
    const t = perTag[b.tag] || (perTag[b.tag] = { boxes: 0, exposedSamples: 0, invisibleBoxes: 0, invisibleSamples: 0 });
    if (exposed) t.boxes++;
    t.exposedSamples += exposed; t.invisibleSamples += bad;
    if (bad) {
      t.invisibleBoxes++;
      report.push({ kind: 'collider', tag: b.tag, box: [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1].map((v) => +v.toFixed(2)), invisibleSamples: bad, exposedSamples: exposed, at: worst });
    }
  }
  // ---- bounds: walkable edge (player) and the vehicle bound boxes (car)
  const edges = [];
  const line = (who, axis, c, from, to, n) => { for (let s = from + 0.25; s < to; s += 0.5) edges.push({ who, x: axis === 'x' ? c : s, z: axis === 'x' ? s : c, nx: axis === 'x' ? n : 0, nz: axis === 'z' ? n : 0 }); };
  line('foot', 'x', bounds.x0, bounds.z0, bounds.z1, -1); line('foot', 'x', bounds.x1, bounds.z0, bounds.z1, 1);
  line('foot', 'z', bounds.z0, bounds.x0, bounds.x1, -1); line('foot', 'z', bounds.z1, bounds.x0, bounds.x1, 1);
  const pier = L.pier;
  line('foot', 'x', pier.x0 + 0.6, bounds.z1, pier.z1 - 0.6, -1); line('foot', 'x', pier.x1 - 0.6, bounds.z1, pier.z1 - 0.6, 1);
  line('foot', 'z', pier.z1 - 0.6, pier.x0 + 0.6, pier.x1 - 0.6, 1);
  line('car', 'x', bounds.x0 - 0.5, bounds.z0, 226, -1); line('car', 'x', bounds.x1 + 0.5, bounds.z0, 226, 1);
  line('car', 'z', bounds.z0 - 0.5, bounds.x0, bounds.x1, -1);
  let run = null;
  const flush = () => { if (run) { report.push(run); run = null; } };
  for (const e of edges) {
    const back = e.who === 'foot' ? 0.5 : 1.2;   // car: body radius ~1 m in front of the box
    const qx = e.x - e.nx * back, qz = e.z - e.nz * back;
    const gy = W.groundHeight(qx, qz);
    const ok = e.who === 'foot' ? walk(qx, qz) && !blockedAt(qx, qz, gy + 0.25, gy + 1.75) : carOK(qx, qz) && groundClass(qx, qz) && !blockedAt(qx, qz, 0.3, 1.3);
    // the bound only matters if open ground carries on past it
    const beyond = e.who === 'foot' ? !walk(e.x + e.nx * 0.3, e.z + e.nz * 0.3) : true;
    if (!ok || !beyond || drawnAhead(qx, qz, e.nx, e.nz, back, 0, 2)) { flush(); continue; }
    const tag = e.who + '-bound';
    if (run && run.tag === tag && Math.hypot(run.to.x - e.x, run.to.z - e.z) < 0.6) { run.to = { x: e.x, z: e.z }; run.length += 0.5; }
    else { flush(); run = { kind: 'bound', tag, from: { x: e.x, z: e.z }, to: { x: e.x, z: e.z }, length: 0.5, ground: groundClass(qx, qz) }; }
    const t = perTag[tag] || (perTag[tag] = { invisibleSamples: 0 }); t.invisibleSamples++;
  }
  flush();
  // ---- open-ground census: drawn road / pavement / promenade inside the district covered by a collider
  const census = {};
  for (let x = bounds.x0 + 0.25; x < bounds.x1; x += 0.5) for (let z = bounds.z0 + 0.25; z < 226; z += 0.5) {
    const cls = groundClass(x, z); if (!cls) continue;
    const gy = W.groundHeight(x, z);
    const hit = C.query(x, z, x, z).find((b) => inBox(b, x, z, gy + 0.25, gy + 1.75));
    const k = cls + ':' + (hit ? hit.tag : walk(x, z) ? 'open' : 'off-bounds');
    census[k] = (census[k] || 0) + 0.25;
  }
  return { perTag, census, report };
})()`;

// ---- dynamic: the real controllers
const WALK = String.raw`((lane) => {
  const { W, g, C, L, drawnAhead, stallVisible } = window.__pw;
  const out = { lane: lane.name, mode: 'foot', length: 0, stalls: [], invisible: [], visible: 0, dynamic: 0, end: null };
  const P = (a, o) => lane.axis === 'x' ? { x: a, z: lane.c + o } : { x: lane.c + o, z: a };
  const along = (p) => lane.axis === 'x' ? p.x : p.z, across = (p) => (lane.axis === 'x' ? p.z : p.x) - lane.c;
  const dir = Math.sign(lane.to - lane.from);
  const clearAt = (pt) => { const q = { ...pt }, gy = W.groundHeight(pt.x, pt.z); return L.walkable(pt.x, pt.z) && !C.resolveCircle(q, 0.34, gy + 0.25, gy + 1.75); };
  let a = lane.from;
  while (!clearAt(P(a, lane.off)) && Math.abs(a - lane.from) < 20) a += dir * 0.5;
  g.teleport(P(a, lane.off).x, P(a, lane.off).z, true);
  let p = g.player(), last = along(p), stuck = 0, hops = 0, guard = 0;
  while (dir * (lane.to - along(p)) > 0.6 && guard++ < 4000) {
    const lat = Math.max(-1, Math.min(1, (lane.off - across(p)) * 0.8));
    const wish = lane.axis === 'x' ? { x: dir, z: lat, sprint: true } : { x: lat, z: dir, sprint: true };
    g.walk(wish, 12);
    p = g.player();
    const prog = dir * (along(p) - last);
    out.length += Math.max(0, prog);
    last = along(p);
    if (prog > 0.35) { stuck = 0; continue; }
    if (++stuck < 3) continue;
    stuck = 0;
    // stalled: what is in front?
    const fx = lane.axis === 'x' ? dir : 0, fz = lane.axis === 'z' ? dir : 0;
    const near = g.nearby(p.x, p.z, 3.5), wide = g.nearby(p.x, p.z, 12);
    const blockers = C.query(p.x - 0.8, p.z - 0.8, p.x + 0.8, p.z + 0.8).filter((b) => b.y1 > p.y + 0.25 && b.y0 < p.y + 1.75 && Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1)) < 0.5);
    const stall = { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
    if (blockers.length) {
      const inv = blockers.filter((b) => !stallVisible(p.x, p.z, b, b.y0, b.y1));
      if (inv.length) out.invisible.push({ ...stall, tags: inv.map((b) => b.tag), boxes: inv.map((b) => [b.x0, b.z0, b.x1, b.z1].map((v) => +v.toFixed(2))) });
      else out.visible++;
      if (!inv.length && blockers.some((b) => b.tag === 'barrier')) { out.end = { ...stall, drawn: true, tag: 'barrier' }; break; }
    } else if (near.cars.length || near.peds.length) { out.dynamic++; }
    else if (!L.walkable(p.x + fx * 0.6, p.z + fz * 0.6)) {
      const drawn = drawnAhead(p.x, p.z, fx, fz, 0.6, 0, 2);
      if (!drawn) out.invisible.push({ ...stall, tags: ['walkable-bound'] });
      out.end = { ...stall, drawn };
      break;
    } else if (wide.cars.some((c) => Math.abs(c.speed) > 2 || Math.hypot(c.x - p.x, c.z - p.z) < 6)) {   /* traffic just went by / pinned the player */ out.dynamic++; out.stalls.push({ ...stall, cars12: wide.cars.length }); }
    else out.invisible.push({ ...stall, tags: ['unknown'], speed: +p.speed.toFixed(2), cars12: wide.cars.length });
    // hop past the obstacle to the next clear point on the lane
    let h = along(p) + dir * 0.5;
    while (!clearAt(P(h, lane.off)) && dir * (lane.to - h) > 0) h += dir * 0.5;
    if (dir * (lane.to - h) <= 0 || ++hops > 80) break;
    g.teleport(P(h, lane.off).x, P(h, lane.off).z, false);
    p = g.player(); last = along(p);
  }
  out.length = +out.length.toFixed(1);
  out.reached = +along(p).toFixed(1);
  return out;
})`;

const DRIVE = String.raw`((lane) => {
  const { W, g, C, L, drawnAhead, stallVisible } = window.__pw;
  const out = { lane: lane.name, mode: 'car', length: 0, invisible: [], visible: 0, visibleAt: [], dynamic: 0, end: null };
  const dir = Math.sign(lane.to - lane.from);
  const P = (a) => lane.axis === 'x' ? { x: a, z: lane.c + lane.off } : { x: lane.c + lane.off, z: a };
  const along = (v) => lane.axis === 'x' ? v.x : v.z;
  const yaw0 = lane.axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
  const start = P(lane.from);
  let last = null, slow = 0, done = false, hops = 0;
  const bounds = window.__pwBounds;
  g.driveTest((t, v) => {
    if (done) return { throttle: 0, brake: 1, steer: 0 };
    const a = along(v);
    if (last === null) last = a;
    out.length += Math.max(0, dir * (a - last)); last = a;
    if (dir * (lane.to - a) < 3) { done = true; out.reached = +a.toFixed(1); return { throttle: 0, brake: 1, steer: 0 }; }
    const tgt = P(a + dir * 10);
    const want = Math.atan2(tgt.x - v.x, tgt.z - v.z);
    const err = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
    const ctl = { throttle: v.fwd < 13 ? 1 : 0, brake: v.fwd > 16 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, -err * 2.2)), handbrake: false };   // positive steer turns towards -yaw
    if (Math.abs(v.fwd) > 1.2) { slow = 0; return ctl; }
    // PASS 17f: knocked well off the lane heading (a crash with traffic, a kerb clip), the car comes about on full
    // lock at walking pace, wheels spinning. Still moving, nothing in the way: that is not a stall. A car held by
    // anything (drawn or not) is at rest, whatever its heading, and still counts.
    if (Math.abs(err) > 0.5 && v.speed > 0.3) { slow = 0; return ctl; }
    if (++slow < 60) return ctl;
    slow = 0;
    // stalled for a second: classify, then hop ahead
    const s = Math.sin(v.yaw), co = Math.cos(v.yaw), Rr = v.type.radius;
    const stall = { x: +v.x.toFixed(2), z: +v.z.toFixed(2) };
    const near = g.nearby(v.x, v.z, v.type.length / 2 + 4).cars.length > 0;
    const hits = [];
    for (const cz of v.type.circles) {
      const px = v.x + s * cz, pz = v.z + co * cz;
      for (const b of C.query(px - Rr - 0.3, pz - Rr - 0.3, px + Rr + 0.3, pz + Rr + 0.3)) {
        if (b.y1 < 0.3 || b.y0 > v.type.height * 0.9) continue;
        const qx = Math.max(b.x0, Math.min(px, b.x1)), qz = Math.max(b.z0, Math.min(pz, b.z1));
        const d = Math.hypot(qx - px, qz - pz);
        if (d < Rr + 0.15 && !hits.some((h) => h.b === b)) hits.push({ b, px, pz, qx, qz, d });
      }
    }
    const atBound = v.x - Rr < bounds.x0 - 0.3 || v.x + Rr > bounds.x1 + 0.3 || v.z - Rr < bounds.z0 - 0.3;
    if (hits.length) {
      const inv = hits.filter((h) => !stallVisible(h.px, h.pz, h.b, h.b.y0, h.b.y1));
      if (inv.length) out.invisible.push({ ...stall, tags: inv.map((h) => h.b.tag), boxes: inv.map((h) => [h.b.x0, h.b.z0, h.b.x1, h.b.z1].map((q) => +q.toFixed(2))) });
      else {
        out.visible++;
        if (out.visibleAt.length < 6) out.visibleAt.push({ ...stall, tags: hits.map((h) => h.b.tag) });
        // the street ends at a drawn road closure: that is the end of this lane
        if (hits.some((h) => h.b.tag === 'barrier')) { out.end = { ...stall, drawn: true, tag: 'barrier' }; done = true; out.reached = +a.toFixed(1); return { throttle: 0, brake: 1, steer: 0 }; }
      }
    } else if (atBound) {
      const fx = lane.axis === 'x' ? dir : 0, fz = lane.axis === 'z' ? dir : 0;
      const drawn = drawnAhead(v.x + fx * Rr * 0.5, v.z + fz * Rr * 0.5, fx, fz, Rr + 0.6, 0, 1.4);
      if (!drawn) out.invisible.push({ ...stall, tags: ['vehicle-bound'] });
      out.end = { ...stall, drawn };
      done = true; out.reached = +a.toFixed(1);
      return { throttle: 0, brake: 1, steer: 0 };
    } else if (near) out.dynamic++;
    else out.invisible.push({ ...stall, tags: ['unknown'] });
    if (++hops > 40) { done = true; return { throttle: 0, brake: 1, steer: 0 }; }
    const next = P(a + dir * 14);
    v.place(next.x, next.z, yaw0); v.settle(W.groundHeight, 1);
    last = along(v);
    return ctl;
  }, Math.abs(lane.to - lane.from) / 9 + 25, { x: start.x, z: start.z, yaw: yaw0 });
  out.length = +out.length.toFixed(1);
  return out;
})`;

let failures = 0;
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!window.__game?.ready'), 60000);
  // park the player at the end of the jetty so their own body is not counted as drawn geometry
  await page.evaluate(`window.__game.teleport(-60, 290, true)`);
  await page.evaluate(`(async () => { const m = await import('./src/config.js'); window.__pwBounds = { ...m.CITY.bounds }; })()`);
  const setup = await page.evaluate(SETUP);
  console.log(JSON.stringify({ setup, bounds: await page.evaluate('window.__pwBounds') }));
  const st = await page.evaluate(STATIC);
  console.log(JSON.stringify({ static: 'per-tag', perTag: st.perTag }));
  console.log(JSON.stringify({ static: 'open-ground census (m², body-height blockers on road/pavement/promenade)', census: st.census }));
  for (const r of st.report) console.log(JSON.stringify(r));
  const staticInvisible = st.report.length;
  console.log(JSON.stringify({ staticInvisibleBlockers: staticInvisible }));
  failures += staticInvisible;

  if (!quick) {
    const b = await page.evaluate('window.__pwBounds');
    const S = [-200, -120, -40, 40, 120, 200];
    const walks = [], drives = [];
    for (const axis of ['x', 'z']) for (const c of S) {
      const lo = axis === 'x' ? b.x0 : b.z0, hi = axis === 'x' ? b.x1 : (c === -200 || c === 200 ? b.z1 : b.z1);
      const offs = [-8, -3, 3, 8];
      for (const off of offs) {
        if (axis === 'z' && false) continue;
        walks.push({ name: `${axis}=${c} off ${off} +`, axis, c, off, from: lo + 0.5, to: hi - 0.4 });
        walks.push({ name: `${axis}=${c} off ${off} -`, axis, c, off, from: hi - 0.5, to: lo + 0.4 });
      }
      // keep right: +x drives at c+3, -x at c-3; +z at c-3, -z at c+3
      drives.push({ name: `${axis}=${c} +`, axis, c, off: axis === 'x' ? 3 : -3, from: (axis === 'x' ? b.x0 : b.z0) + 4, to: (axis === 'x' ? b.x1 : 204) + 12 });
      drives.push({ name: `${axis}=${c} -`, axis, c, off: axis === 'x' ? -3 : 3, from: (axis === 'x' ? b.x1 : 196) - 4, to: (axis === 'x' ? b.x0 : b.z0) - 12 });
    }
    // the promenade, both ways, two lines
    for (const z of [214, 221]) {
      walks.push({ name: `promenade z=${z} +`, axis: 'x', c: z, off: 0, from: b.x0 + 0.5, to: b.x1 - 0.4 });
      walks.push({ name: `promenade z=${z} -`, axis: 'x', c: z, off: 0, from: b.x1 - 0.5, to: b.x0 + 0.4 });
    }
    // the jetty
    walks.push({ name: 'jetty', axis: 'z', c: -60, off: 0, from: 222, to: 295.5 });
    let dyn = 0;
    for (const lane of only === 'drive' ? [] : walks) {
      const r = await page.evaluate(`${WALK}(${JSON.stringify(lane)})`);
      dyn += r.invisible.length;
      console.log(JSON.stringify(r));
    }
    for (const lane of only === 'walk' ? [] : drives) {
      const r = await page.evaluate(`${DRIVE}(${JSON.stringify(lane)})`);
      dyn += r.invisible.length;
      console.log(JSON.stringify(r));
    }
    console.log(JSON.stringify({ dynamicInvisibleStalls: dyn, walks: walks.length, drives: drives.length }));
    failures += dyn;
  }
  const errs = watch.errors.length;
  console.log(JSON.stringify({ invisibleBlockers: failures, consoleErrors: errs }));
} finally {
  await page.close();
  server.stop();
}
process.exit(failures ? 1 : 0);
