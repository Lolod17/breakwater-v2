// Traffic: AI drivers that follow the right-hand inner lane of the street grid,
// pick a turn at each junction, stop at red signals (the same cycle the signal
// lamps show), keep their distance from whatever is ahead and steer by pure
// pursuit. They drive through the same Vehicle dynamics as the player, so they
// brake, roll and collide the same way. Also places the parked cars.
import { CITY } from '../config.js';
import { signalCycle, signalOffset } from '../world/props.js';

const S = CITY.streets;
const N = S.length;
const LANE = 1.75;        // inner lane centre, right of the centre line
const KERB_LANE = 4.85;   // parked cars, tight to the kerb
const STOP = 11.4;        // stop line distance from a junction centre (front bumper)
const ENTRY = 10.5;
const CRUISE = 12.5, TURN_V = 6.2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const node = (i, j) => ({ i, j, x: S[i], z: S[j] });

function neighbours(i, j) {
  const out = [];
  if (i > 0) out.push([i - 1, j]);
  if (i < N - 1) out.push([i + 1, j]);
  if (j > 0) out.push([i, j - 1]);
  if (j < N - 1) out.push([i, j + 1]);
  return out;
}

function streetLeg(A, B) {
  const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
  const rx = -dz, rz = dx;                    // right of travel (three.js handedness)
  return {
    kind: 'street', from: A, to: B, dx, dz,
    pts: [[A.x + dx * ENTRY + rx * LANE, A.z + dz * ENTRY + rz * LANE], [B.x - dx * STOP + rx * LANE, B.z - dz * STOP + rz * LANE]],
  };
}

function turnLeg(prev, C, cut = false) {
  const B = prev.to;
  const ex = prev.pts[1][0], ez = prev.pts[1][1];
  const dx = Math.sign(C.x - B.x), dz = Math.sign(C.z - B.z);
  const rx = -dz, rz = dx;
  const xx = B.x + dx * ENTRY + rx * LANE, xz = B.z + dz * ENTRY + rz * LANE;
  // control point: where the two lane lines cross (midpoint when going straight)
  let cx, cz;
  if (prev.dx !== 0 && dz !== 0) { cx = xx; cz = ez; }
  else if (prev.dz !== 0 && dx !== 0) { cx = ex; cz = xz; }
  else { cx = (ex + xx) / 2; cz = (ez + xz) / 2; }
  if (cut) { cx = (cx + B.x) / 2; cz = (cz + B.z) / 2; }
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const u = k / 8, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    pts.push([w0 * ex + w1 * cx + w2 * xx, w0 * ez + w1 * cz + w2 * xz]);
  }
  const straight = prev.dx === dx && prev.dz === dz;
  // right of travel is (-dz, dx), so a left turn heads along (prev.dz, -prev.dx)
  const left = dx === prev.dz && dz === -prev.dx;
  return { kind: 'turn', from: B, to: C, dx, dz, pdx: prev.dx, pdz: prev.dz, pts, straight, left };
}

export class TrafficDriver {
  constructor(vehicle, rng, A, B, { cruise = CRUISE, ignoreSignals = false } = {}) {
    this.v = vehicle;
    this.cruise = cruise;
    this.ignoreSignals = ignoreSignals;
    this.rng = rng;
    this.leg = streetLeg(A, B);
    this.seg = 0;
    this.stuck = 0; this.reverse = 0;
    this.targetV = 0;
  }

  _nextLeg() {
    const L = this.leg;
    if (L.kind === 'street') {
      const B = L.to;
      const opts = neighbours(B.i, B.j).filter(([i, j]) => !(i === L.from.i && j === L.from.j));
      const [i, j] = this.chooseTurn?.(opts, L) ?? opts[this.rng.int(0, opts.length - 1)];
      this.leg = turnLeg(L, node(i, j), this.cutCorners);
    } else {
      this.leg = streetLeg(L.from, L.to);
    }
    this.seg = 0;
  }

  // Recovery: put the driver on the street lane nearest to the car.
  _reseat() {
    const v = this.v;
    let best = null, bd = Infinity;
    for (const [A, B] of allStreets()) {
      const L = streetLeg(A, B);
      const [a, b] = L.pts;
      const sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz;
      const u = clamp(((v.x - a[0]) * sx + (v.z - a[1]) * sz) / l2, 0, 1);
      const d = Math.hypot(v.x - (a[0] + sx * u), v.z - (a[1] + sz * u));
      if (d < bd) { bd = d; best = L; }
    }
    this.leg = best; this.seg = 0;
  }

  // Project onto the polyline, advance segments, return lookahead target and remaining distance.
  _track(ld) {
    const v = this.v;
    let P = this.leg.pts;
    for (let guard = 0; ; guard++) {
      // safety net: if the car ever ends up far off its path (shunted by a
      // crash), re-seat it on the nearest street lane instead of spinning
      if (guard > 64) { this._reseat(); P = this.leg.pts; guard = 0; }
      const a = P[this.seg], b = P[this.seg + 1];
      const sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz;
      const u = ((v.x - a[0]) * sx + (v.z - a[1]) * sz) / l2;
      if (u > 1 && this.seg < P.length - 2) { this.seg++; continue; }
      if (u > 1 && this.seg === P.length - 2) { this._nextLeg(); P = this.leg.pts; continue; }
      // walk forward ld metres from the projection
      let px = a[0] + sx * clamp(u, 0, 1), pz = a[1] + sz * clamp(u, 0, 1);
      let rem = ld, k = this.seg, tx = px, tz = pz;
      while (rem > 0) {
        const q = k + 1 < P.length ? P[k + 1] : null;
        if (!q) { const d = Math.hypot(sx, sz); tx += (sx / d) * rem; tz += (sz / d) * rem; break; }
        const d = Math.hypot(q[0] - tx, q[1] - tz);
        if (d >= rem) { tx += ((q[0] - tx) / d) * rem; tz += ((q[1] - tz) / d) * rem; rem = 0; }
        else { rem -= d; tx = q[0]; tz = q[1]; k++; }
      }
      let left = Math.hypot(b[0] - px, b[1] - pz);
      for (let m = this.seg + 1; m < P.length - 1; m++) left += Math.hypot(P[m + 1][0] - P[m][0], P[m + 1][1] - P[m][1]);
      return { tx, tz, left };
    }
  }

  // Three-point turn across the carriageway (police only): forward on full left
  // lock until the nose nears the far kerb, reverse on full right lock until the
  // tail nears the near kerb, then forward again until the car faces back down
  // the street, where it takes the opposite lane of the same street.
  startTurnabout() {
    const L = this.leg;
    if (L.kind !== 'street' || this.turnabout) return false;
    this.turnabout = { phase: 'brake', time: 0, d: [L.dx, L.dz], r: [-L.dz, L.dx], c: L.dx ? L.from.z : L.from.x, from: L.from, to: L.to };
    return true;
  }

  _turnabout(dt, vehicles = []) {
    const v = this.v, c = v.ctrl, ty = v.type, T = this.turnabout;
    T.time += dt;
    const hx = Math.sin(v.yaw), hz = Math.cos(v.yaw);
    const theta = Math.atan2(-(hx * T.r[0] + hz * T.r[1]), hx * T.d[0] + hz * T.d[1]); // left of travel = +
    // lateral position across the street (+ = original right side)
    const lat = (v.x * T.r[0] + v.z * T.r[1]) - T.c * (T.d[0] ? T.r[1] : T.r[0]);
    // Use the same collision circles the cruiser obstruction test uses.
    const hr = hx * T.r[0] + hz * T.r[1], R = ty.radius + 0.35;
    const circles = ty.circles.map(o => lat + hr * o);
    const nose = circles[circles.length - 1], tail = circles[0];
    const kerb = CITY.roadHalf;
    const vxl = v.vx * hx + v.vz * hz;
    // Is the end circle (front or back) about to touch another vehicle?
    const blocked = (offset) => {
      const x = v.x + hx * offset, z = v.z + hz * offset;
      for (const o of vehicles) {
        if (o === v || Math.abs(o.x - x) > 7 || Math.abs(o.z - z) > 7) continue;
        const os = Math.sin(o.yaw), oc = Math.cos(o.yaw);
        for (const k of o.type.circles) if (Math.hypot(o.x + os * k - x, o.z + oc * k - z) < ty.radius + o.type.radius + 0.4) return true;
      }
      return false;
    };
    c.handbrake = false;
    const done = () => {
      this.turnabout = null;
      this.leg = streetLeg(T.to, T.from); this.seg = 0;
      this.stuck = 0; this.reverse = 0;
    };
    if (T.time > 14 || Math.abs(theta) > 2.75) { done(); return; }
    if (T.phase === 'brake') {
      c.throttle = 0; c.steer = -1; c.brake = vxl > 0.05 ? 1 : 0;
      if (Math.abs(vxl) < 0.6) T.phase = 'fwd';
      return;
    }
    if (T.phase === 'fwd') {
      c.steer = -1; c.brake = 0;
      c.throttle = vxl < 1.4 ? 0.85 : vxl < 2.8 ? 0.4 : 0;
      T.stall = Math.abs(vxl) < 0.5 ? (T.stall ?? 0) + dt : 0;
      if (Math.abs(nose) + R > kerb || blocked(ty.circles[ty.circles.length - 1]) || T.stall > 2) { T.phase = 'stop'; T.next = 'rev'; T.stall = 0; }
      return;
    }
    if (T.phase === 'rev') {
      c.steer = 1; c.throttle = 0;
      c.brake = vxl > -1.4 ? 0.85 : vxl > -2.6 ? 0.4 : 0;
      T.stall = Math.abs(vxl) < 0.5 ? (T.stall ?? 0) + dt : 0;
      if (Math.abs(tail) + R > kerb || blocked(ty.circles[0]) || theta > 2.1 || T.stall > 2) { T.phase = 'stop'; T.next = 'fwd'; T.stall = 0; }
      return;
    }
    // stop: kill motion before swapping direction
    c.throttle = 0; c.steer = T.next === 'rev' ? 1 : -1;
    if (vxl > 0.15) c.brake = 1;
    else if (vxl < -0.15) { c.brake = 0; c.throttle = 1; }
    else { c.brake = 0; T.phase = T.next; }
  }

  update(dt, t, vehicles, pedestrian) {
    const v = this.v, c = v.ctrl, ty = v.type;
    const spd = v.speed;
    if (!this.turnabout && this.leg.kind === 'street' && this.wantTurnabout?.(this.leg)) this.startTurnabout();
    if (this.turnabout) { this._turnabout(dt, vehicles); return; }
    const ld = 4.5 + spd * 0.55;
    const { tx, tz, left } = this._track(ld);
    const s = Math.sin(v.yaw), co = Math.cos(v.yaw);

    // target speed: cruise, slow for the coming turn, stop for signals and traffic
    let vt = this.leg.kind === 'turn' ? (this.leg.straight ? this.cruise * 0.85 : TURN_V) : this.cruise;
    if (this.leg.kind === 'street') {
      vt = Math.min(vt, Math.sqrt(TURN_V * TURN_V + 2 * 2.8 * Math.max(0, left)));
      const B = this.leg.to;
      const st = signalCycle(t + signalOffset(B.i * N + B.j), this.leg.dx !== 0 ? 0 : 1);
      if (!this.ignoreSignals && (st === 0 || (st === 1 && left > (spd * spd) / 8 + 1.5))) {
        vt = Math.min(vt, Math.sqrt(2 * 3.2 * Math.max(0, left - 0.4)));
        if (left < 0.6) vt = 0;
      }
    }
    if (this.approach) vt = Math.min(vt, this.approach(v, s, co));
    // Left turns cross the oncoming carriageway: wait at the line while an
    // oncoming car (not itself turning left) is near or in the junction.
    if (this.leg.kind === 'turn' && this.leg.left && this.seg < 3 && !this.ignoreSignals) {
      const L = this.leg, B = L.from;
      for (const o of vehicles) {
        if (o === v || o.speed < 0.5 && !o.driver) continue;
        const ox = o.x - B.x, oz = o.z - B.z;
        const along = ox * L.pdx + oz * L.pdz;              // distance out along the oncoming approach (beyond the junction)
        const side = ox * -L.pdz + oz * L.pdx;              // right-of-travel offset (oncoming lanes are < 0)
        const heading = Math.sin(o.yaw) * L.pdx + Math.cos(o.yaw) * L.pdz;
        if (along < -4 || along > 30 || side > 0.5 || side < -6.5 || heading > -0.6) continue;
        if (o.driver?.leg?.kind === 'turn' && o.driver.leg.left) continue;
        if (along > 6 && o.speed < 1) continue;            // parked or queued, not coming
        vt = 0;
        break;
      }
    }
    // follow: anything inside a corridor ahead. An overtaking driver (police)
    // watches the opposite lane instead while it is passing.
    const leg = this.leg, street = leg.kind === 'street';
    const rX = street ? -leg.dz : 0, rZ = street ? leg.dx : 0;
    const latCar = street ? (v.x - leg.from.x) * rX + (v.z - leg.from.z) * rZ : 0;
    const corridor = (centre, range, back = 0, margin = 0.25) => {
      let lim = Infinity, who = null, off = 0;
      const scan = (ox, oz, oHalfW, oHalfL, o) => {
        const rx = ox - v.x, rz = oz - v.z;
        const df = rx * s + rz * co, dl = rx * co - rz * s;
        if (df <= -back || df > range || Math.abs(dl - centre) > ty.width / 2 + margin + oHalfW) return;
        // PASS 17d: a body alongside (behind our front bumper, outside our own width) is not in front of us.
        // It used to read as dead ahead (lim 0), so a car stopped against the flank froze the driver for good.
        if (!back && df < ty.length / 2 - 0.5 && Math.abs(dl) > ty.width / 2) return;
        const l = Math.sqrt(2 * 4 * Math.max(0, df - ty.length / 2 - oHalfL - 2.2));
        if (l < lim) { lim = l; who = o; off = dl - centre; }
      };
      for (const o of vehicles) {
        if (o === v || o === this.ramTarget || o === this.nudge?.car || Math.abs(o.x - v.x) > range + 6 || Math.abs(o.z - v.z) > range + 6) continue;
        // rotated bodies: scan each collision circle so a car lying across the road blocks every lane it covers
        const os = Math.sin(o.yaw), oc = Math.cos(o.yaw), R = o.type.radius;
        for (const k of o.type.circles) scan(o.x + os * k, o.z + oc * k, R, R, o);
      }
      if (pedestrian) scan(pedestrian.x, pedestrian.z, 0.4, 0.4, 'player');
      for (const p of this.v.managerPeds || []) scan(p.x, p.z, 0.38, 0.38, p);
      return { lim, who, off };
    };
    // Civilians pull towards the kerb and stop for a siren closing from behind
    // or head-on (the fugitive's own car and police never do).
    this.pullOver = false;
    if (!this.canOvertake && !this.ignoreSignals) {
      for (const o of vehicles) {
        // PASS 17d: only a cruiser that is actually moving: one stopped behind (itself held up, or out on
        // foot) used to keep the civilian waiting at the kerb for ever, and the jam behind it with it
        if (o === v || !o.policeUnit?.siren || o.speed < 1.5) continue;
        const rx = o.x - v.x, rz = o.z - v.z;
        if (rx * rx + rz * rz > 35 * 35) continue;
        const df = rx * s + rz * co, oh = Math.sin(o.yaw) * s + Math.cos(o.yaw) * co;
        if ((df < 0 && df > -25 && oh > 0.5) || (df > 0 && oh < -0.5)) { this.pullOver = true; break; }
      }
    }
    if (this.pullOver) {
      this.shiftGoal = street ? 1.1 : 0;
      // ease over, then wait; never stop inside a junction
      vt = Math.min(vt, !street ? 4 : Math.abs(latCar - (LANE + this.shiftGoal)) > 0.35 ? 2.5 : 0);
    } else if (!this.canOvertake) this.shiftGoal = 0;
    // Police pass whatever holds them up: first squeeze between traffic that has
    // pulled over on both sides (a lane ~1 m left of normal, tight margin), else
    // straddle the centre line. Back to the home lane once it is clear alongside.
    const PASSES = [[-1.0, 0.05], [-0.5 - LANE, 0.25]];   // [shift from the home lane, corridor margin]
    if (this.canOvertake) {
      if (!street || left < 6) this.shiftGoal = 0;
      else {
        const home = corridor(latCar - LANE, 28);
        const held = home.who?.type && !home.who.driver?.turnabout && home.lim < vt - 2;
        if (held) {
          const need = Math.min(vt, 12);
          const pass = PASSES.find(([shift, margin]) => corridor(latCar - (LANE + shift), 36, 0, margin).lim >= need);
          if (pass) this.shiftGoal = pass[0];
        } else if (this.shiftGoal && corridor(latCar - LANE, 9, ty.length + 1.5).lim >= vt) this.shiftGoal = 0;
      }
    }
    this.shift = (this.shift || 0) + clamp((this.shiftGoal || 0) - (this.shift || 0), -3.2 * dt, 3.2 * dt);
    const passing = this.canOvertake && this.shiftGoal ? PASSES.find(([shift]) => shift === this.shiftGoal) : null;
    const lane = passing ? corridor(latCar - (LANE + passing[0]), 34, 0, passing[1]) : corridor(0, 34);
    this.blocker = lane.lim < vt ? lane.who : null;
    let limit = lane.lim;
    // A pursuing cruiser held up by a civilian car for 1.5 s pushes through it
    // at walking pace (contact physics shoves the civilian aside).
    if (this.nudge) { this.nudge.t -= dt; if (this.nudge.t <= 0) this.nudge = null; else limit = Math.min(limit, 4); }
    const civilian = lane.who?.type && !lane.who.policeUnit ? lane.who : null;
    this.heldT = this.pursuit && civilian && spd < 1.5 && lane.lim < 2 ? (this.heldT || 0) + dt : 0;
    if (this.heldT > 1.5 && !this.nudge) { this.nudge = { car: civilian, t: 2.5 }; this.heldT = 0; }
    // Police creep past a stopped car that sits off to one side instead of freezing nose to nose.
    if (this.canOvertake && lane.who?.type && lane.who.speed < 0.5 && Math.abs(lane.off) > 1) limit = Math.max(limit, 1.6);
    vt = Math.min(vt, limit);
    // Deadlock breaker: drivers waiting on each other in a loop (two cars
    // nose to nose in a junction, or a longer ring). After 2.5 s at rest,
    // follow the chain of blockers; if it comes back here, one car in the loop
    // (the lowest id, once every car in the loop has been waiting) backs off.
    const b = this.blocker;
    this.waitT = b && b.type && spd < 0.3 ? (this.waitT || 0) + dt : 0;
    if (this.waitT > 2.5 && this.reverse <= 0) {
      const ring = [v];
      for (let o = b; o && o.type && ring.length < 7; o = o.driver?.blocker) {
        if (o === v) {
          if (ring.every(c => (c.driver?.waitT || 0) > 2.5) && v.id === Math.min(...ring.map(c => c.id))) {
            this.reverse = 1.6; this.straightBack = true; this.waitT = 0;
          }
          break;
        }
        ring.push(o);
      }
    }
    // PASS 17d: a chain that ends at a car with no AI driver (the player's, or a wreck) never closes into a
    // ring, so nobody in it ever yielded. A car held for 4 s by such a car at rest, standing head-on or
    // across its lane (not one it is queued behind), backs off and tries again.
    if (this.waitT > 4 && this.reverse <= 0 && !b.driver?.leg && b.speed < 0.3
      && Math.sin(b.yaw) * s + Math.cos(b.yaw) * co < 0.5) {
      this.reverse = 1.2; this.straightBack = true; this.waitT = 0;
    }
    this.targetV = vt;

    // pure pursuit steering (input + = right, wheel angle + = left)
    let rx = tx - v.x + rX * (this.shift || 0), rz = tz - v.z + rZ * (this.shift || 0);
    if (this.ramTarget && this.leg.kind === 'street') {
      const target = this.ramTarget, leg = this.leg;
      const dx = target.x - v.x, dz = target.z - v.z;
      const lateral = leg.dx ? target.z - leg.from.z : target.x - leg.from.x;
      const ahead = dx * s + dz * co;
      if (ahead > 0 && ahead < 24 && Math.abs(lateral) < 3.6 && left > 5) { rx = dx; rz = dz; }
    }
    const df = rx * s + rz * co, dl = rx * co - rz * s;
    const alpha = Math.atan2(dl, Math.max(0.1, df));
    const want = Math.atan2(2 * ty.wheelbase * Math.sin(alpha), ld);
    const lock = ty.steerLock / (1 + spd / 13);
    c.steer = clamp(-want / lock, -1, 1);
    c.handbrake = false;

    // un-stick after a crash: back up for a moment with opposite lock
    if (this.reverse > 0) {
      this.reverse -= dt;
      c.throttle = 0; c.brake = 0.7; c.steer = this.straightBack ? 0 : -c.steer;
      if (this.reverse <= 0) this.straightBack = false;
      return;
    }
    if (vt > 3 && spd < 0.4) { this.stuck += dt; if (this.stuck > 4) { this.stuck = 0; this.reverse = 1.4; } }
    else this.stuck = 0;

    const err = vt - Math.max(0, v.fwd);
    if (err > 0.3) { c.throttle = clamp(err * 0.3, 0.08, ty.name === 'truck' ? 1 : 0.75); c.brake = 0; }
    else if (err < -0.8 || vt < 0.2) { c.throttle = 0; c.brake = vt < 0.2 && v.fwd < 0.7 ? (v.fwd > 0.05 ? 1 : 0) : clamp(-err * 0.25, 0.1, 1); }
    else { c.throttle = 0; c.brake = 0; }
    if (vt < 0.2 && v.fwd <= 0.05) { c.brake = 0; c.throttle = 0; }
  }
}

// Spawn slots ------------------------------------------------------------------

// Street legs as [A, B] node pairs.
export function allStreets() {
  const out = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (const [a, b] of neighbours(i, j)) out.push([node(i, j), node(a, b)]);
  return out;
}

// Kerbside parking spot on street A->B at fraction u: x, z, yaw.
export function parkingSpot(A, B, u) {
  const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
  const rx = -dz, rz = dx;
  const a = 17 + u * (Math.abs(B.x - A.x + B.z - A.z) - 34);
  return { x: A.x + dx * a + rx * KERB_LANE, z: A.z + dz * a + rz * KERB_LANE, yaw: Math.atan2(dx, dz) };
}

// Lane position on street A->B at fraction u.
export function laneSpot(A, B, u) {
  const leg = streetLeg(A, B);
  const [p, q] = leg.pts;
  return { x: p[0] + (q[0] - p[0]) * u, z: p[1] + (q[1] - p[1]) * u, yaw: Math.atan2(leg.dx, leg.dz) };
}
