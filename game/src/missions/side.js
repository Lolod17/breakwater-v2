import { earn, balance } from '../econ/wallet.js';
import { emit } from '../core/events.js';

export const TAXI_FARE = { flag: 4, perMeter: 0.06, perSecond: 0.12 };

const DEFAULTS = {
  taxi: { pickup: { x: -120, z: -160, r: 8 }, dropoff: { x: 160, z: -120, r: 8 }, limit: 240 },
  delivery: { collect: { x: -120, z: 160, r: 8 }, dropoff: { x: 200, z: 120, r: 8 }, limit: 90, reward: 120 },
  race: {
    checkpoints: [{ x: 40, z: 40 }, { x: 120, z: 40 }, { x: 120, z: 120 }, { x: 40, z: 120 }, { x: 40, z: 40 }],
    rivalTime: 50, reward: 250,
  },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPos = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
const near = (pos, t) => validPos(pos) && dist(pos, t) < t.r;
const point = (p, r = 8) => ({ x: p.x, z: p.z, r: Number.isFinite(p?.r) && p.r > 0 ? p.r : r });
const positive = (n, fallback) => (Number.isFinite(n) && n > 0 ? n : fallback);

let storyGuard = () => false;
export function setStoryGuard(fn) { storyGuard = typeof fn === 'function' ? fn : () => false; }
export function storyActive() { return !!storyGuard(); }

class Activity {
  constructor(id) {
    this.id = id;
    this.phase = 'idle';
    this.timer = null;
    this.reward = 0;
  }

  get running() { return this.phase !== 'idle' && this.phase !== 'done' && this.phase !== 'failed'; }

  start(opts = {}) {
    if (this.running || storyGuard()) return false;
    this._reset(opts);
    emit('side:started', { activity: this.id, target: this.target() });
    return true;
  }

  update(dt, playerPos) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this._step(dt, playerPos);
  }

  cancel() {
    const was = this.running;
    this.phase = 'idle';
    this.timer = null;
    this.reward = 0;
    return was;
  }

  state() { return { phase: this.phase, target: this.target(), timer: this.timer, reward: this.reward }; }

  target() { return null; }

  _complete(reward, extra = {}) {
    const t = this.target();                        // where it finished (decides the faction)
    this.phase = 'done';
    this.timer = null;
    this.reward = reward;
    earn(reward, `side:${this.id}`);
    emit('side:completed', { activity: this.id, reward, balance: balance(), at: t ? { x: t.x, z: t.z } : null, ...extra });
  }

  _fail(reason) {
    this.phase = 'failed';
    this.timer = null;
    this.reward = 0;
    emit('side:failed', { activity: this.id, reason });
  }
}

export class Taxi extends Activity {
  constructor() { super('taxi'); }

  _reset(opts) {
    const d = DEFAULTS.taxi;
    this.pickup = point(opts.pickup ?? d.pickup);
    this.dropoff = point(opts.dropoff ?? d.dropoff);
    this.limit = positive(opts.limit, d.limit);
    this.phase = 'pickup';
    this.timer = this.limit;
    this.meters = 0;
    this.seconds = 0;
    this.prev = null;
    this.reward = TAXI_FARE.flag;
  }

  target() {
    if (this.phase === 'pickup') return { ...this.pickup };
    if (this.phase === 'dropoff') return { ...this.dropoff };
    return null;
  }

  _fare() { return Math.max(1, Math.round(TAXI_FARE.flag + TAXI_FARE.perMeter * this.meters + TAXI_FARE.perSecond * this.seconds)); }

  _step(dt, pos) {
    this.timer -= dt;
    if (this.phase === 'pickup') {
      if (this.timer <= 0) return this._fail('Out of time');
      if (near(pos, this.pickup)) {
        this.phase = 'dropoff';
        this.meters = 0;
        this.seconds = 0;
        this.prev = validPos(pos) ? { x: pos.x, z: pos.z } : null;
      }
      return;
    }
    this.seconds += dt;
    if (validPos(pos)) {
      if (this.prev) this.meters += dist(pos, this.prev);
      this.prev = { x: pos.x, z: pos.z };
    }
    this.reward = this._fare();
    if (this.timer <= 0) return this._fail('Out of time');
    if (near(pos, this.dropoff)) {
      this._complete(this._fare(), { meters: +this.meters.toFixed(2), seconds: +this.seconds.toFixed(2) });
    }
  }
}

export class Delivery extends Activity {
  constructor() { super('delivery'); }

  _reset(opts) {
    const d = DEFAULTS.delivery;
    this.collect = point(opts.collect ?? d.collect);
    this.dropoff = point(opts.dropoff ?? d.dropoff);
    this.limit = positive(opts.limit, d.limit);
    this.payout = Math.round(positive(opts.reward, d.reward));
    this.phase = 'collect';
    this.timer = null;
    this.reward = this.payout;
  }

  target() {
    if (this.phase === 'collect') return { ...this.collect };
    if (this.phase === 'deliver') return { ...this.dropoff };
    return null;
  }

  _step(dt, pos) {
    if (this.phase === 'collect') {
      if (near(pos, this.collect)) { this.phase = 'deliver'; this.timer = this.limit; }
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) return this._fail('Out of time');
    if (near(pos, this.dropoff)) this._complete(this.payout, { secondsLeft: +this.timer.toFixed(2) });
  }
}

export class StreetRace extends Activity {
  constructor() { super('race'); }

  _reset(opts) {
    const d = DEFAULTS.race;
    const list = Array.isArray(opts.checkpoints) && opts.checkpoints.length >= 2 ? opts.checkpoints : d.checkpoints;
    this.checkpoints = list.map((p) => point(p, 9));
    this.rivalTime = positive(opts.rivalTime, d.rivalTime);
    this.payout = Math.round(positive(opts.reward, d.reward));
    this.index = 0;
    this.elapsed = 0;
    this.phase = 'racing';
    this.timer = this.rivalTime;
    this.reward = this.payout;
  }

  target() {
    if (this.phase !== 'racing' || this.index >= this.checkpoints.length) return null;
    return { ...this.checkpoints[this.index] };
  }

  _step(dt, pos) {
    this.elapsed += dt;
    this.timer -= dt;
    if (this.timer <= 0) return this._fail('The rival finished first');
    if (near(pos, this.checkpoints[this.index])) {
      this.index++;
      if (this.index >= this.checkpoints.length) {
        this._complete(this.payout, { finishTime: +this.elapsed.toFixed(2), rivalTime: this.rivalTime });
      }
    }
  }
}

const TITLES = { taxi: 'TAXI', delivery: 'DELIVERY', race: 'STREET RACE' };

// ---- PASS 16: where side jobs start in the city ---------------------------------
// Three spots on the street grid, each away from the story contacts and doors.
// Drive (taxi, race) or walk (delivery) onto one and press E. Routes are picked
// from street intersections; the same job number always gives the same route.
export const SPOTS = [
  { kind: 'taxi', label: 'TAXI RANK', x: 40, z: 176, r: 6, needsCar: true },
  { kind: 'delivery', label: 'COURIER DEPOT', x: -120, z: 100, r: 5, needsCar: false },
  { kind: 'race', label: 'STREET RACE', x: -40, z: 72, r: 6, needsCar: true },
];
const GRID = [-200, -120, -40, 40, 120, 200];
const NODES = GRID.flatMap((x) => GRID.map((z) => ({ x, z })));
const pickNode = (from, lo, hi, n) => {
  const ok = NODES.filter((p) => { const d = dist(p, from); return d >= lo && d <= hi; });
  return ok[n % ok.length];
};
let jobs = 0;
export function spotAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return SPOTS.find((s) => Math.hypot(s.x - x, s.z - z) < s.r) ?? null;
}
// Start options for a job begun at a spot (deterministic per job number).
export function routeFor(kind, n = jobs) {
  const spot = SPOTS.find((s) => s.kind === kind);
  if (kind === 'taxi') {
    const pickup = pickNode(spot, 60, 170, n * 7 + 3);
    const dropoff = pickNode(pickup, 180, 330, n * 5 + 1);
    return { pickup: { ...pickup, r: 8 }, dropoff: { ...dropoff, r: 8 }, limit: Math.round(40 + (dist(spot, pickup) + dist(pickup, dropoff)) / 7) };
  }
  if (kind === 'delivery') {
    const dropoff = pickNode(spot, 160, 300, n * 3 + 2);
    return { collect: { x: spot.x, z: spot.z, r: 8 }, dropoff: { ...dropoff, r: 8 }, limit: Math.round(25 + dist(spot, dropoff) / 6), reward: 90 + Math.round(dist(spot, dropoff) / 3) };
  }
  // a lap of the block west of the avenue, back to the start line
  return { checkpoints: [{ x: -40, z: 40 }, { x: 40, z: 40 }, { x: 40, z: -40 }, { x: -40, z: -40 }, { x: -40, z: 40 }, { x: -40, z: 72 }], rivalTime: 46, reward: 250 };
}
export function startAt(spot) {
  if (!spot) return false;
  const ok = side.start(spot.kind, routeFor(spot.kind, jobs));
  if (ok) jobs++;
  return ok;
}

export class Side {
  constructor() {
    this.taxi = new Taxi();
    this.delivery = new Delivery();
    this.race = new StreetRace();
    this.current = null;
  }

  byKind(kind) { return { taxi: this.taxi, delivery: this.delivery, race: this.race }[kind] ?? null; }

  running() { return !!(this.current && this.current.running); }

  start(kind, opts) {
    const a = this.byKind(kind);
    if (!a || this.running() || storyGuard()) return false;
    if (!a.start(opts)) return false;
    this.current = a;
    return true;
  }

  update(dt, playerPos) { if (this.running()) this.current.update(dt, playerPos); }

  cancel() {
    if (!this.running()) return false;
    this.current.cancel();
    return true;
  }

  state() {
    const a = this.current;
    return { activity: a?.id ?? null, ...(a ? a.state() : { phase: 'idle', target: null, timer: null, reward: 0 }) };
  }

  waypoint() {
    if (!this.running()) return null;
    const t = this.current.target();
    return t ? { x: t.x, z: t.z, r: t.r, kind: 'objective' } : null;
  }

  objective() {
    const a = this.current;
    if (!a || !a.running) return '';
    if (a.id === 'taxi') return a.phase === 'pickup' ? 'Pick up the passenger at the yellow marker' : 'Drive the passenger to the drop-off. The fare runs on distance and time';
    if (a.id === 'delivery') return a.phase === 'collect' ? 'Collect the package at the yellow marker' : 'Deliver the package before the timer runs out';
    return `Checkpoint ${a.index + 1}/${a.checkpoints.length}. Beat the rival's ${a.rivalTime}s`;
  }

  hud() {
    if (!this.running()) return null;
    return { line: '', phase: 'active', title: TITLES[this.current.id], objective: this.objective(),
      meter: null, timer: this.current.timer, briefing: null, result: null, choice: null };
  }
}

export const side = new Side();
export const startSpot = (spot) => startAt(spot);
export const start = (kind, opts) => side.start(kind, opts);
export const update = (dt, playerPos) => side.update(dt, playerPos);
export const cancel = () => side.cancel();
export const state = () => side.state();
export const running = () => side.running();
export const waypoint = () => side.waypoint();
export const hud = () => side.hud();
