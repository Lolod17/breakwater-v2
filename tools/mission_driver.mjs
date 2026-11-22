// Scripted player for the mission and save probes. Installed into the page as
// window.__md. It plays through the same inputs a person uses:
//   - driving: throttle / brake / steer / handbrake written to the car's ctrl,
//     exactly where the keyboard writes them (window.__game.drive);
//   - on foot: a walk direction (window.__game.walk), the same path as WASD;
//   - key presses: E (briefing / retry), F (enter / exit car), 1 / 2 (ending choice).
// It never moves the car or the player directly and never edits mission state.
//
// Route planning: shortest path over the street grid (no U-turns at nodes; turning back at the start
// costs 2000 m, so it loops round a block instead), followed in the right-hand lane by pure pursuit.
// Speed: slows for corners, for whatever is ahead in the lane, and waits at
// junctions while crossing traffic is inside or about to enter the box. Passes a
// stopped car through the oncoming lane when that lane is clear. Backs out when stuck.
export const DRIVER = String.raw`(() => {
const g = window.__game;
const S = [-200, -120, -40, 40, 120, 200];
const LANE = 1.75;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const key = (p) => p[0] + ',' + p[1];
const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The street segment [A, B] (grid nodes) nearest to a road point, and the point snapped onto its centreline.
function segment(x, z) {
  let best = null, bd = 1e9;
  for (const c of S) {
    const kz = Math.max(0, Math.min(4, S.findIndex((v, i) => i < 5 && z <= S[i + 1])));
    const kx = Math.max(0, Math.min(4, S.findIndex((v, i) => i < 5 && x <= S[i + 1])));
    if (Math.abs(x - c) < bd) { bd = Math.abs(x - c); best = { A: [c, S[kz]], B: [c, S[kz + 1]], snap: [c, clamp(z, S[0], S[5])] }; }
    if (Math.abs(z - c) < bd) { bd = Math.abs(z - c); best = { A: [S[kx], c], B: [S[kx + 1], c], snap: [clamp(x, S[0], S[5]), c] }; }
  }
  return best;
}
function neighbours([x, z]) {
  const i = S.indexOf(x), j = S.indexOf(z), out = [];
  if (i > 0) out.push([S[i - 1], z]); if (i < 5) out.push([S[i + 1], z]);
  if (j > 0) out.push([x, S[j - 1]]); if (j < 5) out.push([x, S[j + 1]]);
  return out;
}
// Centreline points from a car (position + heading) to a road point.
function plan(fx, fz, yaw, tx, tz) {
  const a = segment(fx, fz), b = segment(tx, tz);
  const from = a.snap, to = b.snap;
  const hx = Math.sin(yaw), hz = Math.cos(yaw);
  const sameSeg = (key(a.A) === key(b.A) && key(a.B) === key(b.B));
  if (sameSeg && (to[0] - from[0]) * hx + (to[1] - from[1]) * hz > 0) return [from, to];
  const dist = new Map(), back = new Map(), open = [];
  for (const [n, p] of [[a.A, a.B], [a.B, a.A]]) {
    const ahead = (n[0] - from[0]) * hx + (n[1] - from[1]) * hz;
    const c = dd(from, n) + (ahead < 0 ? 2000 : 0), k = key(n) + '|' + key(p);
    dist.set(k, c); back.set(k, null); open.push({ k, n, p, c });
  }
  let end = null, endCost = 1e9;
  while (open.length) {
    open.sort((u, v) => u.c - v.c);
    const cur = open.shift();
    if (cur.c > dist.get(cur.k)) continue;
    for (const [E, F] of [[b.A, b.B], [b.B, b.A]]) {
      if (key(cur.n) === key(E) && key(cur.p) !== key(F)) { const c = cur.c + dd(cur.n, to); if (c < endCost) { endCost = c; end = cur.k; } }
    }
    for (const nb of neighbours(cur.n)) {
      if (key(nb) === key(cur.p)) continue;
      const k = key(nb) + '|' + key(cur.n), c = cur.c + dd(cur.n, nb);
      if (c < (dist.get(k) ?? 1e9)) { dist.set(k, c); back.set(k, cur.k); open.push({ k, n: nb, p: cur.n, c }); }
    }
  }
  const nodes = [];
  for (let k = end; k; k = back.get(k)) nodes.unshift(k.split('|')[0].split(',').map(Number));
  return [from, ...nodes, to];
}
// Right-hand lane polyline for centreline points. Turns are built like traffic.js
// builds them: straight in the lane up to the stop line (11.4 m before the node),
// then a quadratic curve to 10.5 m past it, with the control point where the two
// lane lines cross, so the car does not cut into the junction early.
// Returns { pts, turns: [index of each curve's first point] }.
function lane(centre) {
  const segs = [];
  for (let i = 0; i < centre.length - 1; i++) {
    const p = centre[i], q = centre[i + 1], L = dd(p, q);
    if (L < 0.5) continue;
    const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
    segs.push({ p, q, L, dx, dz, rx: -dz, rz: dx });
  }
  if (!segs.length) return { pts: [centre[0], centre[centre.length - 1]], turns: [] };   // already at the goal
  const pts = [], turns = [];
  const at = (sg, base, along) => [base[0] + sg.dx * along + sg.rx * LANE, base[1] + sg.dz * along + sg.rz * LANE];
  pts.push(at(segs[0], segs[0].p, 0));
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i], b = segs[i + 1];
    if (!b) { pts.push(at(a, a.q, 0)); break; }
    const straight = Math.abs(a.dx * b.dx + a.dz * b.dz) > 0.99;
    if (straight) continue;                                   // straight on through the node
    const stop = Math.min(11.4, a.L * 0.45), entry = Math.min(10.5, b.L * 0.45);
    const e = at(a, a.q, -stop), x = at(b, a.q, entry);
    // control point: the crossing of the two lane lines
    const c = a.dx !== 0 ? [x[0], e[1]] : [e[0], x[1]];
    pts.push(e);
    turns.push(pts.length - 1);
    for (let k = 1; k <= 8; k++) {
      const u = k / 8, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
      pts.push([w0 * e[0] + w1 * c[0] + w2 * x[0], w0 * e[1] + w1 * c[1] + w2 * x[1]]);
    }
  }
  return { pts, turns };
}

// Insert every grid junction crossed by a straight run (so junction waits see them).
function expand(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1], q = pts[i];
    if (p[0] === q[0] && S.includes(p[0])) for (const z of (q[1] > p[1] ? S : [...S].reverse())) { if ((z - p[1]) * (q[1] - z) > 0) out.push([p[0], z]); }
    else if (p[1] === q[1] && S.includes(p[1])) for (const x of (q[0] > p[0] ? S : [...S].reverse())) { if ((x - p[0]) * (q[0] - x) > 0) out.push([x, p[1]]); }
    out.push(q);
  }
  return out;
}

class Pilot {
  constructor(centre, o = {}) {
    centre = expand(centre);
    const ln = lane(centre);
    this.centre = centre; this.pts = ln.pts; this.turns = ln.turns; this.k = 0;
    this.cum = [0];
    for (let m = 1; m < this.pts.length; m++) this.cum.push(this.cum[m - 1] + dd(this.pts[m - 1], this.pts[m]));
    this.cruise = o.cruise ?? 15; this.stop = o.stop !== false; this.overtake = !!o.overtake; this.escape = !!o.escape; this.keepLane = !!o.keepLane;
    this.shift = 0; this.shiftT = 0; this.held = 0; this.stuck = 0; this.rev = 0; this.revSteer = 0;
    this.nodes = centre.filter((p) => S.includes(p[0]) && S.includes(p[1]));
    this.waits = 0;
  }
  // distance left along the lane from the car's projection
  project(x, z) {
    const P = this.pts;
    for (;;) {
      const a = P[this.k], b = P[this.k + 1];
      if (!b) return { u: 1, px: a[0], pz: a[1], left: 0 };
      const sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1e-6;
      const u = ((x - a[0]) * sx + (z - a[1]) * sz) / l2;
      if (u > 1 && this.k < P.length - 2) { this.k++; continue; }
      const cu = clamp(u, 0, 1), px = a[0] + sx * cu, pz = a[1] + sz * cu;
      const along = this.cum[this.k] + Math.hypot(px - a[0], pz - a[1]);
      return { u, px, pz, along, left: this.cum[P.length - 1] - along };
    }
  }
  lookahead(px, pz, ld) {
    const P = this.pts; let k = this.k, tx = px, tz = pz, rem = ld;
    while (rem > 0 && k + 1 < P.length) {
      const q = P[k + 1], d = Math.hypot(q[0] - tx, q[1] - tz);
      if (d >= rem) { tx += (q[0] - tx) / d * rem; tz += (q[1] - tz) / d * rem; rem = 0; } else { rem -= d; tx = q[0]; tz = q[1]; k++; }
    }
    if (rem > 0) { const a = P[P.length - 2], b = P[P.length - 1], L = dd(a, b) || 1; tx += (b[0] - a[0]) / L * rem; tz += (b[1] - a[1]) / L * rem; }
    return [tx, tz];
  }
  // distance to the next turn curve (0 while inside one)
  corner(along) {
    for (const t of this.turns) {
      const start = this.cum[t], end = this.cum[t + 8];
      if (along < start) return start - along;
      if (along <= end) return 0;
    }
    return 1e9;
  }
  // One fixed step of control. opts.aim: {x, z} to steer straight at (ramming); opts.vt: speed override;
  // opts.ignore: car ids not treated as obstacles.
  step(opts = {}) {
    const car = g.car();
    if (!car) return null;
    const s = Math.sin(car.yaw), co = Math.cos(car.yaw), spd = car.speed;
    const pr = this.project(car.x, car.z);
    const ld = 4.5 + spd * 0.5;
    let [tx, tz] = opts.aim ? [opts.aim.x, opts.aim.z] : this.lookahead(pr.px, pr.pz, ld);
    // lane direction (for the passing shift)
    const a = this.pts[this.k], b = this.pts[this.k + 1] ?? a, L = dd(a, b) || 1;
    const rx = -(b[1] - a[1]) / L, rz = (b[0] - a[0]) / L;
    if (!opts.aim) { tx += rx * this.shift; tz += rz * this.shift; }
    let vt = opts.vt ?? this.cruise;
    if (!opts.aim) {
      vt = Math.min(vt, Math.sqrt(6.5 * 6.5 + 2 * 4 * Math.max(0, this.corner(pr.along) - 2)));
      if (this.stop) vt = Math.min(vt, Math.sqrt(2 * 4 * Math.max(0, pr.left - 1.5)));
    }
    const near = g.nearby(car.x, car.z, 46);
    // what is ahead in the lane (cars and pedestrians)
    let block = null, lim = Infinity;
    const scan = (ox, oz, half, w, o) => {
      const qx = ox - car.x, qz = oz - car.z, df = qx * s + qz * co, dl = qx * co - qz * s;
      const lat = opts.aim ? 0 : -this.shift * 0;     // the corridor follows the car's own heading
      if (df <= 0 || df > 40 || Math.abs(dl - lat) > car.width / 2 + w + 0.55) return;
      const l = Math.sqrt(2 * 5 * Math.max(0, df - car.length / 2 - half - 2.4));
      if (l < lim) { lim = l; block = o; }
    };
    // ramming (aim) ignores cars: contact is the point
    if (!opts.aim) for (const o of near.cars) if (!(opts.ignore || []).includes(o.id)) scan(o.x, o.z, o.half, o.w, o);
    for (const p of near.peds) scan(p.x, p.z, 0.35, 0.35, null);
    vt = Math.min(vt, lim);
    // junction: wait while crossing traffic is in the box or about to enter it
    let waiting = false;
    if (!opts.aim) {
      for (const n of this.nodes) {
        const qx = n[0] - car.x, qz = n[1] - car.z, df = qx * s + qz * co;
        const dn = Math.hypot(qx, qz);
        if (df < 0 || dn > 30 || dn < 13) continue;
        for (const o of near.cars) {
          if (o.speed < 1 || (opts.ignore || []).includes(o.id)) continue;
          const align = Math.abs(Math.sin(o.yaw) * s + Math.cos(o.yaw) * co);
          if (align > 0.8) continue;                              // same or opposite direction: not crossing
          const ox = o.x - n[0], oz = o.z - n[1];
          const inBox = Math.abs(ox) < 11 && Math.abs(oz) < 11;
          const along = Math.hypot(ox, oz), toward = -(ox * Math.sin(o.yaw) + oz * Math.cos(o.yaw)) / (along || 1);
          const coming = along < 38 && toward > 0.7 && along / Math.max(o.speed, 0.1) < 3.2;
          if (inBox || coming) { waiting = true; vt = Math.min(vt, Math.sqrt(2 * 5 * Math.max(0, dn - 14))); }
        }
        break;
      }
    }
    // never wait more than 5 s at one junction (a gridlocked box would hold the pilot forever): go for 2 s
    this.waitT = waiting ? (this.waitT || 0) + 1 / 60 : 0;
    if (this.goT > 0) this.goT -= 1 / 60;
    if (this.waitT > 5) { this.goT = 2; this.waitT = 0; }
    if (waiting && this.goT > 0) { waiting = false; vt = Math.max(vt, Math.min(lim, 6)); }
    if (waiting) this.waits++;
    // pass a stopped car through the oncoming lane when that lane is clear
    // (with o.overtake, as a chasing driver: also any car well below cruise speed)
    const slow = block && (block.speed < 0.8 || (this.overtake && block.speed < this.cruise - 3));
    this.held = slow && !waiting && !opts.aim ? this.held + 1 / 60 : 0;
    // o.keepLane (meet: the drive to a contact): off its own lane, never "pass" an oncoming car.
    // The corridor follows the car's heading, so a car that starts off its lane (mid-turn when the
    // previous mission ended) sees the oncoming queue as "ahead", and "passing" it puts the car on
    // the far kerb, nose to nose with oncoming traffic, for good.
    const offLane = Math.hypot(car.x - pr.px, car.z - pr.pz) > 1.5;
    const oncoming = !!block && Math.sin(block.yaw) * s + Math.cos(block.yaw) * co < -0.5;
    if (this.held > (this.overtake && block?.speed > 0.8 ? 0.7 : 2) && !this.shift && !(this.keepLane && offLane && oncoming)) {
      const clear = near.cars.every((o) => {
        const qx = o.x - car.x, qz = o.z - car.z, df = qx * s + qz * co, dl = qx * co - qz * s;
        return df < -6 || df > 45 || dl < 1.2 || dl > 6.2;     // dl > 0 is the left (oncoming) side
      });
      if (clear) { this.shift = -3.5; this.shiftT = 4; }
    }
    // a stand-off (nose into a junction, both sides waiting): back off 1 s if nothing is behind
    if (this.held > 4 && !this.shift && !this.rev) {
      const rearClear = near.cars.every((o) => {
        const qx = o.x - car.x, qz = o.z - car.z, df = qx * s + qz * co, dl = qx * co - qz * s;
        return df > 0 || df < -(car.length / 2 + o.half + 1.5) || Math.abs(dl) > car.width / 2 + o.w + 0.5;
      });
      if (rearClear) { this.rev = 1.0; this.revSteer = 0; this.held = 0; this.backoffs = (this.backoffs || 0) + 1; }
    }
    // abandon an overtake the moment something comes the other way in that lane within 30 m
    if (this.shift && near.cars.some((o) => {
      const qx = o.x - car.x, qz = o.z - car.z, df = qx * s + qz * co, dl = qx * co - qz * s;
      return df > 0 && df < 30 && dl > 0.5 && dl < 6 && (Math.sin(o.yaw) * s + Math.cos(o.yaw) * co) < -0.5 && o.speed > 0.5;
    })) { this.shift = 0; this.held = 0; this.aborts = (this.aborts || 0) + 1; }
    if (this.shift) { this.shiftT -= 1 / 60; if (this.shiftT <= 0) this.shift = 0; else vt = Math.max(vt, Math.min(this.cruise, 8)); }
    // pure pursuit (steer input + = right, wheel angle + = left)
    const qx = tx - car.x, qz = tz - car.z, df = qx * s + qz * co, dl = qx * co - qz * s;
    const alpha = Math.atan2(dl, Math.max(0.1, df));
    const want = Math.atan2(2 * car.wheelbase * Math.sin(Math.atan2(dl, df)), Math.max(ld, 3));
    let steer = clamp(-want / (car.steerLock / (1 + spd / 13)), -1, 1);
    const ctrl = { throttle: 0, brake: 0, steer, handbrake: false };
    // stuck (or pointing the wrong way at low speed): back out with opposite lock
    if (this.rev > 0) {
      this.rev -= 1 / 60;
      Object.assign(ctrl, { throttle: 0, brake: car.fwd > 0.6 ? 1 : 0.8, steer: this.revSteer });
      if (car.fwd > 0.6) ctrl.brake = 1;
      g.drive(ctrl, 1);
      return { vt, waiting, left: pr.left };
    }
    // with o.escape (a chase where cars box you in on purpose), boxed in (not a junction wait, not arrived): after 4 s at a standstill, back out regardless of the speed plan
    // Any driver: stuck 6 s inside a junction box (a gridlock the AI cars are waiting on us to clear): back out too.
    const inBox = this.nodes.some((n) => Math.abs(n[0] - car.x) < 12 && Math.abs(n[1] - car.z) < 12);
    this.idle = (this.escape || inBox) && spd < 0.4 && !waiting && pr.left > 3 ? (this.idle || 0) + 1 / 60 : 0;
    if (this.idle > (this.escape ? 4 : 6)) { this.idle = 0; this.escapes = (this.escapes || 0) + 1; this.rev = 2; this.revSteer = (this.escapes % 2 ? 1 : -1) * Math.sign(alpha || 1); }
    const behind = df < 0 && Math.hypot(qx, qz) > 3;
    this.stuck = (vt > 2 && spd < 0.4) || (behind && spd < 3) ? this.stuck + 1 / 60 : 0;
    // reverse on the opposite lock to the forward steer (steer = -sign(alpha)), so forward and reverse legs rotate the same way (a K-turn)
    if (this.stuck > (behind ? 0.6 : 2.5)) { this.stuck = 0; this.rev = 1.3; this.revSteer = Math.sign(alpha || 1); }
    const err = vt - car.fwd;
    if (err > 0.3) ctrl.throttle = clamp(err * 0.4, 0.15, 1);
    else if (err < -0.6 && car.fwd > 0.6) ctrl.brake = clamp(-err * 0.3, 0.15, 1);
    if (vt < 0.3 && Math.abs(car.fwd) < 0.6) { ctrl.throttle = 0; ctrl.brake = 0; ctrl.handbrake = true; }
    g.drive(ctrl, 1);
    this.last = { vt: +vt.toFixed(1), waiting, ctrl, block: block ? block.id : lim < Infinity ? 'ped' : null };
    return { vt, waiting, left: pr.left };
  }
}

// ---- on foot
function walkTo(x, z, { maxSeconds = 40, within = 0.7, sprint = true } = {}) {
  let best = 1e9, still = 0, side = 0;
  for (let t = 0; t < maxSeconds * 60; t++) {
    const p = g.player();
    if (p.driving) return { ok: false, why: 'in car' };
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < within) { for (let i = 0; i < 40 && g.player().speed > 0.15; i++) g.walk(null, 1); return { ok: true, t: t / 60 }; }
    if (d < best - 0.05) { best = d; still = 0; } else still++;
    if (still > 90) { side = side ? -side : 1; still = 0; best = d; for (let i = 0; i < 25; i++) g.walk({ x: -dz / d * side, z: dx / d * side, sprint: false }, 1); continue; }
    g.walk({ x: dx / d, z: dz / d, sprint: sprint && d > 3 }, 1);
  }
  return { ok: false, why: 'timeout' };
}
// Walk to the driver's side of a car and press F.
function enter(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pp = g.player(), v = g.nearby(pp.x, pp.z, 400).cars.find((o) => o.id === id);
    if (!v) return { ok: false, why: 'no car ' + id };
    const s = Math.sin(v.yaw), co = Math.cos(v.yaw), lx = 1.0 + 0.7 + attempt * 0.3;   // left side, off the body
    const w = walkTo(v.x + co * lx, v.z - s * lx, { within: 0.5 });
    if (!w.ok) continue;
    g.tap('KeyF'); g.step(40);
    const p = g.player();
    if (p.driving && p.vehicle.id === id) return { ok: true };
    if (p.driving) { g.tap('KeyF'); g.step(60); }
  }
  return { ok: false, why: 'could not enter ' + id };
}
function exitCar() {
  for (let i = 0; i < 4 && g.player().driving; i++) { g.drive({ throttle: 0, brake: 1, steer: 0, handbrake: false }, 30); g.tap('KeyF'); g.drive({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 60); }
  return !g.player().driving;
}
// Drive along centreline points (or to a road point) until fn() is truthy.
function driveUntil(pilot, done, { maxSeconds = 120, each } = {}) {
  window.__md.cur = pilot;      // for probe traces
  for (let t = 0; t < maxSeconds * 60; t++) {
    const r = done();
    if (r) return { ok: true, t: +(t / 60).toFixed(2), r };
    const o = each ? each(pilot) : {};
    if (o === 'stop') return { ok: false, t: t / 60, why: 'aborted' };
    if (!pilot.step(o || {})) return { ok: false, t: t / 60, why: 'not driving' };
  }
  return { ok: false, t: maxSeconds, why: 'timeout' };
}
function routeTo(x, z, o) { const c = g.car(); return new Pilot(plan(c.x, c.z, c.yaw, x, z), o); }
// A fresh route to a moving goal that keeps the old pilot's manoeuvre state (stuck / overtake / back-off timers).
function replan(old, x, z, o) {
  const p = routeTo(x, z, o);
  if (old) for (const k of ['held', 'shift', 'shiftT', 'rev', 'revSteer', 'stuck', 'waitT', 'goT', 'backoffs', 'idle', 'escapes']) p[k] = old[k];
  return p;
}
function routeVia(points, o) { const c = g.car(); const a = segment(c.x, c.z); return new Pilot([a.snap, ...points], o); }
// Meet a mission contact: get out of any car on the way, walk onto the marker, wait for the briefing.
function meet(contact) {
  if (g.player().driving) {
    const p = routeTo(contact.x, contact.z, { cruise: 13, keepLane: true });
    driveUntil(p, () => { const c = g.car(); return Math.hypot(c.x - contact.x, c.z - contact.z) < 14 && c.speed < 1; }, { maxSeconds: 150 });
    exitCar();
  }
  // a contact you are standing on after a reload (or just declined) opens again once you have walked 10 m off
  const p0 = g.player();
  if (Math.hypot(p0.x - contact.x, p0.z - contact.z) < 11) walkTo(contact.x - Math.sin(contact.yaw) * 12, contact.z - Math.cos(contact.yaw) * 12, { within: 0.8 });
  const w = walkTo(contact.x, contact.z, { within: 0.8, maxSeconds: 80 });
  g.step(10);
  return { walked: w, phase: g.missions().phase };
}
window.__md = { plan, lane, Pilot, walkTo, enter, exitCar, driveUntil, routeTo, replan, routeVia, meet, segment };
})()`;

// Scripted plays of the five missions (window.__probe.runMission), shared by
// tools/probe_missions.mjs and tools/probe_save.mjs. Needs DRIVER installed first.
export const PLAY = String.raw`(() => {
const g = window.__game, md = window.__md;
const defs = g.missionDefs();
const M = () => g.missions();
const active = () => M().phase === 'active';
const near = (x, z, r, pred = () => true) => g.nearby(x, z, r).cars.filter(pred).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
const missionCar = (x, z) => near(x, z, 6, (c) => c.mission === 'mission');
const waitStage = (n, sec = 3) => { for (let i = 0; i < sec * 60 && active() && M().stage < n; i++) g.step(1); return M().stage >= n; };
const POSTS = [[-60, -124.85], [60, -124.85]];

// Each play() runs the mission from stage 0 (as after the briefing or a retry) and
// returns when it is no longer active.
const PLAYS = {
  pickup() {
    // the SUV parked across the avenue already faces north, towards the market
    // on a retry the SUV may be gone (left where the last attempt ended): take the nearest parked car
    const pp = g.player();
    const suv = near(44.85, 151, 4) ?? near(pp.x, pp.z, 40, (c) => !c.driven && !c.police && c.type !== 'truck');
    const e = md.enter(suv.id);
    if (!e.ok) return e;
    waitStage(1);
    md.driveUntil(md.routeTo(-120, -160, { cruise: 15 }), () => !active() || M().stage >= 2, { maxSeconds: 150 });
    md.driveUntil(md.routeTo(-120, 160, { cruise: 15 }), () => !active(), { maxSeconds: 150 });
  },
  cargo() {
    const van = missionCar(-115.15, 184);
    const e = md.enter(van.id);
    if (!e.ok) return e;
    waitStage(1);
    const pilot = md.routeVia([[-120, -120], [0, -120], [120, -120], [160, -120]], { cruise: 14 });
    // ease off near the watch posts (limit 12 m/s); at the drop, wait out any heat
    return md.driveUntil(pilot, () => !active(), { maxSeconds: 200,
      each: () => { const c = g.car(); return POSTS.some(([x, z]) => Math.hypot(c.x - x, c.z - z) < 36) ? { vt: 9 } : {}; } });
  },
  witness(demoFail) {
    const ride = missionCar(115.15, -96);
    const e = md.enter(ride.id);
    if (!e.ok) return e;
    waitStage(1);
    if (demoFail) { for (let i = 0; i < 120 * 60 && active(); i++) g.drive({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 1); return; }
    let pilot = null, replan = 0;
    for (let i = 0; i < 150 * 60 && active() && M().stage === 1; i++) {
      const wp = M().waypoint, c = g.car();
      if (!c) break;
      const target = near(wp.x, wp.z, 6, (o) => o.mission === 'hostile');
      const d = Math.hypot(wp.x - c.x, wp.z - c.z);
      if (!pilot || --replan <= 0) { pilot = md.replan(pilot, wp.x, wp.z, { cruise: 16, stop: false, overtake: true }); replan = 30; }
      // close enough and in front: drive straight into it
      const ahead = (wp.x - c.x) * Math.sin(c.yaw) + (wp.z - c.z) * Math.cos(c.yaw);
      const side = (wp.x - c.x) * Math.cos(c.yaw) - (wp.z - c.z) * Math.sin(c.yaw);
      // ram only a target straight ahead on the same street; otherwise follow the lanes to it
      pilot.step((d < 15 && ahead > -2) || (d < 26 && ahead > 0 && Math.abs(side) < 3.5) ? { aim: { x: wp.x, z: wp.z }, vt: d < 15 ? 12 : 21 } : { ignore: target ? [target.id] : [] });
    }
    if (!active()) return;
    // stopped: get out and take the drive
    md.exitCar();
    const wp = M().waypoint;
    md.walkTo(wp.x, wp.z, { within: 2.6, maxSeconds: 30 });
    for (let i = 0; i < 60 && active(); i++) g.step(1);
  },
  escort() {
    const suv = missionCar(74, 44.85);
    const e = md.enter(suv.id);
    if (!e.ok) return e;
    waitStage(1);
    const route = [[120, 40], [120, 120], [200, 120]];
    const pilot = md.routeVia(route, { cruise: 18 });
    // remaining distance along the convoy route from any point
    const line = [[40, 40], ...route];
    const remaining = (x, z) => {
      let best = 1e9, out = 0;
      for (let k = 0; k < line.length - 1; k++) {
        const a = line[k], b = line[k + 1], sx = b[0] - a[0], sz = b[1] - a[1], L2 = sx * sx + sz * sz;
        const u = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / L2));
        const px = a[0] + sx * u, pz = a[1] + sz * u, d = Math.hypot(x - px, z - pz);
        if (d < best) { best = d; out = Math.hypot(b[0] - px, b[1] - pz); for (let m = k + 1; m < line.length - 1; m++) out += Math.hypot(line[m + 1][0] - line[m][0], line[m + 1][1] - line[m][1]); }
      }
      return out;
    };
    md.driveUntil(pilot, () => !active(), { maxSeconds: 200, each: () => {
      const c = g.car(), cars = g.nearby(c.x, c.z, 160).cars;
      const truck = cars.find((o) => o.type === 'truck' && o.mission === 'mission');
      if (!truck) return {};
      // a live crew in front of us, near the truck: ram it
      const crew = cars.filter((o) => o.mission === 'hostile' && o.hp > 0 && o.driven && Math.hypot(o.x - truck.x, o.z - truck.z) < 70)
        .find((o) => (o.x - c.x) * Math.sin(c.yaw) + (o.z - c.z) * Math.cos(c.yaw) > 0 && Math.hypot(o.x - c.x, o.z - c.z) < 60);
      if (crew) return { aim: { x: crew.x, z: crew.z }, vt: 20 };
      // otherwise hold ~16 m behind the truck
      const gap = remaining(c.x, c.z) - remaining(truck.x, truck.z);
      return { vt: Math.max(0, Math.min(18, truck.speed + (gap - 16) * 0.6)), ignore: [] };
    } });
  },
  finale(ending) {
    const ride = missionCar(195.15, 144);
    const e = md.enter(ride.id);
    if (!e.ok) return e;
    waitStage(1);
    md.driveUntil(md.routeTo(165, 200, { cruise: 16 }), () => !active() || M().stage >= 1, { maxSeconds: 90 });
    // demo fail: stop at the gate on the harbour road and wait there; Halden's hunters ram the ledger away
    if (ending === true) {
      for (let i = 0; i < 120 * 60 && active(); i++) g.drive({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 1);
      return;
    }
    md.driveUntil(md.routeTo(-60, 200, { cruise: 24, escape: true }), () => !active() || M().phase === 'choice', { maxSeconds: 300 });
    if (M().phase === 'choice') {
      for (let i = 0; i < 90; i++) g.drive({ throttle: 0, brake: 1, steer: 0, handbrake: false }, 1);   // a beat to read the choice
      g.tap(ending === 'press' ? 'Digit1' : 'Digit2'); g.step(2);
    }
  },
};

// Beat sampler: every 30 fixed steps while a mission is active, read the live systems
// (wanted level, police units in pursuit / intercept, closest pursuing unit, mission HUD meter).
let beat = null, stepCount = 0;
for (const name of ['step', 'drive', 'walk']) {
  const f = g[name].bind(g);
  g[name] = (a, n = 1) => {
    if (name === 'step') n = a ?? 1;
    if (!n) return f(name === 'step' ? 0 : a, 0);      // step(0): just hold the real-time loop
    for (let k = 0; k < n; k++) {
      name === 'step' ? f(1) : f(a, 1);
      if (beat && ++stepCount % 30 === 0 && active()) {
        const st = g.status(), chasing = st.units.filter((u) => u.state === 'pursue' || u.state === 'intercept');
        beat.maxWanted = Math.max(beat.maxWanted, st.wanted);
        beat.maxPursuing = Math.max(beat.maxPursuing, chasing.length);
        if (chasing.length) beat.closestUnit = Math.min(beat.closestUnit ?? 1e9, ...chasing.map((u) => +u.distance.toFixed(1)));
        const m = M();
        if (window.__trace && stepCount % 60 === 0) { const me = g.car() ?? g.player(); window.__trace.push([m.mission, m.stage, +me.x.toFixed(1), +me.z.toFixed(1), +(me.yaw ?? 0).toFixed(2), +me.speed.toFixed(1), st.wanted, m.ledger, md.cur && { k: md.cur.k, rev: +(md.cur.rev || 0).toFixed(1), idle: +(md.cur.idle || 0).toFixed(1), esc: md.cur.escapes, stuck: +(md.cur.stuck || 0).toFixed(1), last: md.cur.last }]); }
        if (m.truckHp !== null) beat.minTruckHp = Math.min(beat.minTruckHp ?? 100, m.truckHp);
        if (m.nerve !== null) beat.minNerve = Math.min(beat.minNerve ?? 100, +m.nerve.toFixed(1));
        if (m.ledger !== null && m.stage === 1) beat.minLedger = Math.min(beat.minLedger ?? 100, Math.round(m.ledger));
        const me = g.car() ?? g.player(), foes = g.nearby(me.x, me.z, 120).cars.filter((o) => o.mission === 'hostile' && o.driven);
        if (foes.length) beat.closestHostile = Math.min(beat.closestHostile ?? 1e9, ...foes.map((o) => +Math.hypot(o.x - me.x, o.z - me.z).toFixed(1)));
      }
    }
  };
}

function runMission(i, { ending, demoFail = false, maxAttempts = 3 } = {}) {
  const id = defs[i].id;
  beat = { maxWanted: 0, maxPursuing: 0 };
  const logFrom = g.missionLog().length;
  const moneyBefore = g.money();
  const t0 = performance.now();
  const meet = md.meet(defs[i].contact);
  if (M().phase !== 'briefing') return { mission: id, error: 'no briefing at the contact', meet, status: M() };
  g.tap('KeyE'); g.step(2);
  let attempts = 0, failures = [];
  for (;;) {
    attempts++;
    const r = PLAYS[id](demoFail && attempts === 1 ? true : ending);
    if (r && r.ok === false && r.why) failures.push('play: ' + r.why);
    // let the result settle
    for (let k = 0; k < 30 && active(); k++) g.step(1);
    const st = M();
    if (st.phase === 'result' && st.result?.ok) break;
    if (st.phase === 'result' && !st.result.ok) {
      failures.push(st.result.detail);
      if (attempts >= maxAttempts) break;
      g.tap('KeyE'); g.step(2);                         // retry from the card
      if (!active()) { failures.push('retry did not restart'); break; }
      continue;
    }
    const c = g.car(), pp = g.player();
    failures.push('stuck: ' + JSON.stringify({ phase: st.phase, stage: st.stage, objective: st.objective, play: r,
      at: c ? [+c.x.toFixed(1), +c.z.toFixed(1), +c.yaw.toFixed(2), +c.speed.toFixed(1)] : [+pp.x.toFixed(1), +pp.z.toFixed(1)], wanted: g.status().wanted,
      near: c ? g.nearby(c.x, c.z, 16).cars.map((o) => [o.id, o.type, +o.x.toFixed(1), +o.z.toFixed(1), +o.yaw.toFixed(2), +o.speed.toFixed(1), o.mission]) : null, peds: c ? g.nearby(c.x, c.z, 10).peds.length : null }));
    break;
  }
  const st = M();
  const ok = st.phase === 'result' && !!st.result?.ok;
  const moneyAfter = g.money();
  // let the result card time out so the next contact is clean
  for (let k = 0; k < 6 * 60 && M().phase === 'result'; k++) g.step(1);
  const log = g.missionLog().slice(logFrom);
  return { mission: id, ok, attempts, failures, transitions: log.map((e) => e.event), moneyBefore, moneyAfter, gained: moneyAfter - moneyBefore,
    simSeconds: log.length ? +(log[log.length - 1].t - log[0].t).toFixed(1) : 0, realSeconds: +((performance.now() - t0) / 1000).toFixed(1),
    progress: g.missions().progress, ending: g.missions().ending, owned: g.missions().owned, beat };
}
window.__probe = { runMission };
if (new URLSearchParams(location.search).has('trace')) window.__trace = [];
})()`;
