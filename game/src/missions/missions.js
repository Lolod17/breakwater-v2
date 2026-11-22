// Mission director: five story missions on top of the live systems (cars,
// traffic AI, police and wanted, the money counter). Each mission has a contact
// marker that opens a briefing, a list of stages with an objective and a
// waypoint, success and failure checks every fixed step, a retry, and a reward
// paid into life.money. Every transition goes into `log` for tools/probe_missions.mjs.
//
// Phases: idle (contact marker shown) -> briefing -> active -> result (passed /
// failed, E to retry) -> idle.  THE LAST ROUTE ends in a choice between two endings.
import { TrafficDriver, laneSpot } from '../vehicles/traffic.js';
import { CITY } from '../config.js';
import { STORY } from './story.js';
import { registerSection } from '../save.js';
import { emit } from '../core/events.js';

const S = CITY.streets;
const node = (x, z) => ({ i: S.indexOf(x), j: S.indexOf(z), x, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const P = (x, z, r = 8) => ({ x, z, r });

// Follow a fixed list of grid nodes, then wander.
function routeDriver(v, rng, route, opts) {
  const d = new TrafficDriver(v, rng, node(...route[0]), node(...route[1]), opts);
  d.chooseTurn = (options, leg) => {
    const k = route.findIndex(([x, z]) => x === leg.to.x && z === leg.to.z);
    const next = k >= 0 ? route[k + 1] : null;
    return next ? options.find(([i, j]) => S[i] === next[0] && S[j] === next[1]) : undefined;
  };
  return d;
}

// A hunter car turns back along its street when the target is clearly behind it
// (same rule as a police unit's three-point turn in police.js wantTurnabout).
function hunterTurnabout(c, goal, leg) {
  if (c.mission.turnCool > 0 || !c.mission.hp) return false;
  const f = (p) => p.x * leg.dx + p.z * leg.dz;
  const side = leg.dx ? Math.abs(goal.z - leg.from.z) : Math.abs(goal.x - leg.from.x);
  const carF = f(c), goalF = f(goal), aF = f(leg.from), bF = f(leg.to);
  const manhattan = (n) => Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z);
  const onStreet = side < 9 && goalF > Math.min(aF, bF) - 6 && goalF < Math.max(aF, bF) + 6;
  if (onStreet && goalF - carF > -14) return false;
  const forward = onStreet ? (bF - carF) + 2 * Math.abs(bF - aF) + (bF - goalF) : (bF - carF) + manhattan(leg.to);
  const back = 16 + (onStreet ? carF - goalF : (carF - aF) + manhattan(leg.from));
  if (back >= forward - 12) return false;
  c.mission.turnCool = 7;
  return true;
}

// Close-quarters ram driver for Halden's hunters: within ~30 m of the courier a hunter
// leaves the lanes and drives straight at the car (pure pursuit on the target), backs
// off after each hit to gather speed for the next, and backs out when wedged. Same
// controls as every AI car (v.ctrl), stepped by the vehicle manager.
class RamDriver {
  constructor(v, target) { this.v = v; this.target = target; this.back = 0; this.stuck = 0; this.cruise = 14; this.targetV = 14; }
  backOff(seconds = 0.9) { this.back = seconds; }
  update(dt) {
    const v = this.v, c = v.ctrl, t = this.target, ty = v.type;
    const s = Math.sin(v.yaw), co = Math.cos(v.yaw), dx = t.x - v.x, dz = t.z - v.z;
    const df = dx * s + dz * co, dl = dx * co - dz * s;
    const ld = Math.max(4, Math.hypot(dx, dz));
    const want = Math.atan2(2 * ty.wheelbase * Math.sin(Math.atan2(dl, df)), ld);
    const steer = Math.max(-1, Math.min(1, -want / (ty.steerLock / (1 + v.speed / 13))));
    c.handbrake = false; c.horn = false;
    if (this.back > 0) {
      this.back -= dt;
      c.throttle = 0; c.brake = v.fwd > 0.6 ? 1 : 0.8; c.steer = -steer;   // S reverses once stopped
      return;
    }
    c.steer = steer;
    const vt = df < 0 ? 5 : this.cruise;      // target behind: tight turn at low speed
    if (v.fwd < vt) { c.throttle = 1; c.brake = 0; } else { c.throttle = 0; c.brake = 0.3; }
    this.stuck = v.speed < 0.5 ? this.stuck + dt : 0;
    if (this.stuck > 1.5) { this.stuck = 0; this.backOff(1.1); }
  }
}

// --- the five missions --------------------------------------------------------
// contact: where the mission is picked up; park: kerbside slot for a parked car
// near it (mission ride or the player's owned car after a reload).
const MARKET = P(-120, -160), DEPOT = P(-120, 160), WAREHOUSE = P(160, -120), YARD = P(200, 120, 10);
const GATE = P(165, 200, 10), JETTY = P(-60, 200, 10);
const TERMINAL = P(200, 200, 16);   // the container terminal entrance at the dock-road corner
const WATCH = [{ x: -60, z: -124.85, r: 28 }, { x: 60, z: -124.85, r: 28 }];
const WATCH_LIMIT = 12;    // m/s (43 km/h) inside a watch zone

export const MISSIONS = [
  { // 1 THE PICKUP: take a car, collect the package at the old market, bring it to the depot.
    id: 'pickup', reward: 300, contact: { x: 32.2, z: 138, yaw: 0 }, park: { x: 35.15, z: 126, yaw: 0 },
    timeLimit: 240,
    stages: [
      { text: () => 'Take a car (F near a car)', tick: (m) => m.inCar() },
      { text: () => 'Collect the package at the old market', wp: () => MARKET,
        enter: (m, d) => { d.package = { x: -113.4, z: -160, y: CITY.kerbH }; },
        tick: (m, d) => {
          if (!m.near(MARKET, MARKET.r) || m.speed() > 6) return;
          d.package = null; m.say(STORY.missions[0].collected); return true;
        } },
      { text: () => 'Deliver the package to the courier depot', wp: () => DEPOT, tick: (m) => m.near(DEPOT, DEPOT.r) && m.speed() < 6 },
    ],
  },
  { // 2 HOT CARGO: drive the van along Customs Row past two watch posts; arrive with no heat.
    id: 'cargo', reward: 450, contact: { x: -112.2, z: 172, yaw: Math.PI }, park: { x: -115.15, z: 196, yaw: Math.PI },
    setup: (m, d) => {
      d.van = m.ride('van', -115.15, 184, Math.PI, '#f2f2ee');
      d.posts = WATCH.map((w) => ({ ...w, car: m.prop('police', w.x, w.z, -Math.PI / 2), tripped: false }));
      d.checkpoints = [P(-120, -120, 10), P(0, -120, 9), P(120, -120, 10)];
    },
    always: (m, d) => {
      if (d.stage >= 1 && m.g.driving.vehicle !== d.van && dist(m.focus(), d.van) > 50) return 'You abandoned the cargo';
      if (m.g.driving.vehicle !== d.van) return;
      for (const w of d.posts) {
        if (w.tripped || dist(d.van, w) > w.r || d.van.speed <= WATCH_LIMIT) continue;
        w.tripped = true;
        m.g.wanted.force(Math.max(2, m.g.wanted.level), d.van);
        m.event('watch-post-tripped');
        m.say(STORY.missions[1].tripped);
      }
    },
    stages: [
      { text: () => 'Get in the cargo van', wp: (m, d) => ({ x: d.van.x, z: d.van.z, r: 3.5 }), tick: (m, d) => m.g.driving.vehicle === d.van },
      ...[0, 1, 2].map((k) => ({ text: () => `Follow the cargo route on Customs Row (${k + 1}/3). Under 40 km/h at watch posts`,
        wp: (m, d) => d.checkpoints[k], tick: (m, d) => m.g.driving.vehicle === d.van && m.near(d.checkpoints[k], d.checkpoints[k].r) })),
      { text: (m) => m.g.wanted.level ? 'Lose the police before the drop' : 'Deliver the cargo to the Halden warehouse', wp: () => WAREHOUSE,
        tick: (m, d) => m.g.driving.vehicle === d.van && m.near(WAREHOUSE, WAREHOUSE.r) && !m.g.wanted.level && d.van.speed < 6 },
    ],
  },
  { // 3 NO WITNESSES: chase the clerk's sedan, stop it, take the drive before it wipes.
    id: 'witness', reward: 600, contact: { x: 112.2, z: -108, yaw: 0 }, park: { x: 115.15, z: -84, yaw: 0 },
    setup: (m, d) => { d.car = m.ride('sports', 115.15, -96, 0, '#ffb000'); d.nerve = 100; d.far = 0; },
    always: (m, d) => {
      if (!d.target) return;
      if (d.stage === 1) {
        const f = m.focus();
        const gap = dist(f, d.target);
        if (gap < 11 && m.inCar() && m.g.driving.vehicle.speed > 3) d.nerve -= 7 * m.dt;   // tailgating rattles them
        // the clerk idles at the kerb until the courier closes in (or 25 s pass), then runs
        if (!d.fleeing && (gap < 30 || d.stageT > 30)) { d.fleeing = true; d.target.driver.cruise = 8.5; m.event('clerk-flees'); m.say(STORY.missions[2].spotted); }
        d.target.driver && d.fleeing && (d.target.driver.cruise = gap < 20 ? 11 : 8.5);
        d.far = gap > 150 ? d.far + m.dt : 0;
        if (d.far > 5) return 'You lost the clerk';
        if (dist(d.target, TERMINAL) < TERMINAL.r) return 'The clerk vanished into the port';
      }
    },
    stages: [
      { text: () => 'Get in a car', tick: (m) => m.inCar(),
        // the clerk sets off once the courier is mobile
      },
      { text: (m, d) => d.fleeing ? 'Chase the grey sedan. Ram it or tailgate it until it stops' : 'Find the clerk\'s grey sedan at the red marker', wp: (m, d) => ({ x: d.target.x, z: d.target.z, r: 3, kind: 'target', moving: true }),
        enter: (m, d) => {
          const s = laneSpot(node(120, -40), node(120, 40), 0.12);
          d.target = m.prop('sedan', s.x, s.z, s.yaw, '#8a8f96');
          d.target.mission.hostile = true;
          // a long way round to the port: north, west a block, north, back east, north to the gate
          d.target.driver = routeDriver(d.target, m.rng.fork('clerk'), [[120, -40], [120, 40], [40, 40], [40, 120], [120, 120], [120, 200], [200, 200]], { cruise: 0 });   // obeys signals: a red light is the courier's chance
          d.target.wake();
        },
        meter: (m, d) => ({ label: 'NERVE', value: Math.max(0, d.nerve) / 100 }),
        tick: (m, d) => d.nerve <= 0 },
      { text: (m) => m.inCar() ? 'Get out (F) and take the drive from the sedan' : 'Take the drive from the sedan',
        wp: (m, d) => ({ x: d.target.x, z: d.target.z, r: 3, kind: 'target' }), limit: 45, limitReason: 'The drive wiped itself',
        enter: (m, d) => { d.target.driver = null; d.target.mission.stopped = true; m.say(STORY.missions[2].stopped); },
        tick: (m, d) => !m.g.driving.driving && m.g.driving.state === 'foot' && dist(m.g.player.pos, d.target) < 3.4 },
    ],
    onPair: (m, d, other, speed) => {
      if (other === d.target && d.stage === 1 && speed > 2.5) { d.nerve -= Math.min(45, speed * 6); m.event(`ram:${speed.toFixed(1)}`); }
    },
  },
  { // 4 THE ESCORT: lead the truck through the industrial blocks; stop the ambush crews.
    id: 'escort', reward: 800, contact: { x: 47.8, z: 47.8, yaw: Math.PI / 2 }, park: { x: 92, z: 44.85, yaw: Math.PI / 2 },
    setup: (m, d) => {
      d.car = m.ride('suv', 74, 44.85, Math.PI / 2, '#2f4f6f');
      const s = laneSpot(node(40, 40), node(120, 40), 0.1);
      d.truck = m.prop('truck', s.x, s.z, s.yaw, '#2e6b3a');
      d.truck.mission.hp = 100;
      d.truck.driver = routeDriver(d.truck, m.rng.fork('truck'), [[40, 40], [120, 40], [120, 120], [200, 120]], { cruise: 0, ignoreSignals: true });
      d.truck.wake();
      d.crews = []; d.waves = 0;
    },
    always: (m, d) => {
      const t = d.truck;
      if (t.mission.hp <= 0) return 'The truck was wrecked';
      if (d.stage === 1 && dist(m.focus(), t) > 110) return 'You left the truck behind';
      if (d.stage !== 1) return;
      const to = t.driver?.leg?.to;
      // Wave 1: a crew comes up from behind and overtakes anything between it and the
      // truck. Wave 2: a crew head-on in the opposite lane. Each backs off for 4 s after a hit.
      const wave = (n, [from, toN, u, route, overtakes]) => {
        if (d.waves >= n) return;
        d.waves = n;
        const s = laneSpot(node(...from), node(...toN), u);
        const c = m.prop('sedan', s.x, s.z, s.yaw, '#14161a');
        Object.assign(c.mission, { hostile: true, crew: true, hp: 60, cool: 0 });
        c.driver = routeDriver(c, m.rng.fork(`crew-${d.crews.length}`), route, { cruise: 15, ignoreSignals: true });
        c.driver.canOvertake = overtakes;
        c.driver.ramTarget = t;
        c.wake();
        d.crews.push(c);
        m.event(`ambush-wave-${n}`);
        m.say([STORY.missions[3].ambush[n - 1]]);
      };
      if (to && to.x === 120 && to.z === 120) wave(1, [[40, 40], [120, 40], 0.1, [[40, 40], [120, 40], [120, 120], [200, 120]], true]);
      if (to && to.x === 200 && to.z === 120) wave(2, [[200, 120], [120, 120], 0.05, [[200, 120], [120, 120], [120, 40]], false]);
      for (const c of d.crews) {
        if (!c.mission.hp || !c.driver) continue;
        c.driver.ramTarget = m.time > c.mission.cool ? t : null;
        if (dist(c, t) > 140) { c.mission.hp = 0; c.driver = null; m.remove(c); m.event('crew-escaped'); }
      }
    },
    stages: [
      { text: () => 'Get in the car and pull up to the truck', wp: (m, d) => ({ x: d.truck.x, z: d.truck.z, r: 6 }),
        tick: (m, d) => m.inCar() && dist(m.g.driving.vehicle, d.truck) < 30,
        // go: the truck pulls out
      },
      { text: (m, d) => d.crews.some((c) => c.mission.hp > 0 && c.driver) ? 'Stop the ambush crew! Ram them off the truck' : 'Escort the truck to the Halden yard',
        wp: () => YARD, enter: (m, d) => { d.truck.driver.cruise = 9; },
        meter: (m, d) => ({ label: 'TRUCK', value: Math.max(0, d.truck.mission.hp) / 100 }),
        tick: (m, d) => dist(d.truck, YARD) < 18 },
    ],
    onPair: (m, d, other, speed, a, b) => {
      const crew = d.crews.includes(a) ? a : d.crews.includes(b) ? b : null;
      if (!crew || !crew.mission.hp) return;
      const hit = a === crew ? b : a;
      if (hit === d.truck && speed > 2) {
        crew.mission.cool = m.time + 4;
        d.truck.mission.hp = Math.max(0, d.truck.mission.hp - Math.min(34, speed * 3));
        m.event(`truck-hit:${Math.round(d.truck.mission.hp)}`);
      } else if (hit === m.g.driving.vehicle && m.g.driving.driving && speed > 3) {
        crew.mission.hp = Math.max(0, crew.mission.hp - speed * 9);
        if (!crew.mission.hp) { crew.driver = null; m.event('crew-disabled'); }
      }
    },
  },
  { // 5 THE LAST ROUTE: port gate (ledger, wanted 3 + two Halden hunter cars), survive to the jetty, choose an ending.
    id: 'finale', reward: 0, contact: { x: 192.2, z: 132, yaw: 0 }, park: { x: 195.15, z: 156, yaw: 0 },
    setup: (m, d) => { d.car = m.ride('sports', 195.15, 144, 0, '#c8102e'); d.crews = []; d.ledger = 100; },
    always: (m, d) => {
      if (d.stage !== 1) return;
      if (d.ledger <= 0) return 'Halden\'s crew took the ledger';
      const pv = m.inCar() ? m.g.driving.vehicle : null;
      for (const c of d.crews) {
        if (!c.mission.hp || !c.driver) continue;
        const gap = dist(c, m.focus());
        // close in: ram mode (straight at the courier's car); fall back to the lanes once it gets away
        if (pv && gap < 28 && !(c.driver instanceof RamDriver)) { c.mission.lanes = c.driver; c.driver = new RamDriver(c, pv); }
        else if (c.driver instanceof RamDriver && (!pv || gap > 45)) c.driver = c.mission.lanes;
        if (c.driver instanceof RamDriver) continue;
        c.driver.ramTarget = pv && m.time > c.mission.cool ? pv : null;
        c.mission.turnCool -= m.dt;
        if (gap > 170) { c.mission.hp = 0; c.driver = null; m.remove(c); m.event('hunter-shaken'); }
      }
    },
    stages: [
      { text: () => 'Reach the port gate. Locker nine', wp: () => GATE, tick: (m) => m.near(GATE, GATE.r),
        exit: (m, d) => {
          m.say(STORY.missions[4].gate);
          m.g.wanted.force(Math.max(3, m.g.wanted.level), m.focus()); m.event('wanted-3');
          // Halden's hunters: one up the dock road behind the courier, one coming up the x = 40 street ahead
          for (const [k, a, b, u] of [[0, [200, 120], [200, 200], 0.45], [1, [40, 120], [40, 200], 0.3]]) {
            const s = laneSpot(node(...a), node(...b), u);
            const c = m.prop('sedan', s.x, s.z, s.yaw, '#14161a');
            Object.assign(c.mission, { hostile: true, crew: true, hp: 60, cool: 0, turnCool: 0, rams: 0 });
            c.driver = new TrafficDriver(c, m.rng.fork(`hunter-${k}`), node(...a), node(...b), { cruise: 14, ignoreSignals: true });
            c.driver.canOvertake = true;
            c.driver.wantTurnabout = (leg) => hunterTurnabout(c, m.focus(), leg);
            // at each junction take the exit that closes the Manhattan distance to the courier
            c.driver.chooseTurn = (options) => {
              const f = m.focus(), cost = ([i, j]) => Math.abs(S[i] - f.x) + Math.abs(S[j] - f.z);
              return options.reduce((best, o) => (cost(o) < cost(best) ? o : best));
            };
            c.wake();
            d.crews.push(c);
          }
          m.event('hunters-2');
        } },
      { text: (m, d) => d.crews.some((c) => c.mission.hp > 0 && c.driver) ? 'Halden\'s hunters are on you. Get the ledger to the harbour jetty' : 'Get the ledger to the harbour jetty',
        wp: () => JETTY,
        meter: (m, d) => ({ label: 'LEDGER', value: Math.max(0, d.ledger) / 100 }),
        tick: (m) => m.near(JETTY, JETTY.r) },
    ],
    onPair: (m, d, other, speed, a, b) => {
      const crew = d.crews.includes(a) ? a : d.crews.includes(b) ? b : null;
      if (!crew || !crew.mission.hp || d.stage !== 1) return;
      const hit = a === crew ? b : a;
      if (hit !== m.g.driving.vehicle || !m.g.driving.driving || speed < 2) return;
      // who was moving into whom: the faster car along the contact did the ramming
      const pv = m.g.driving.vehicle;
      if (crew.speed >= pv.speed) {
        if (m.time < crew.mission.cool) return;
        crew.mission.cool = m.time + 4;
        if (crew.driver instanceof RamDriver) crew.driver.backOff(1.2);
        d.ledger = Math.max(0, d.ledger - Math.min(20, speed * 3));
        m.event(`rammed:${Math.round(d.ledger)}`);
        // four hits and a hunter has done its job (and its front end): it pulls away
        if (++crew.mission.rams >= 4 && d.ledger > 0) { crew.mission.hp = 0; crew.driver = crew.mission.lanes ?? crew.driver; crew.driver.ramTarget = null; crew.driver.cruise = 9; crew.mission.hostile = false; m.event('hunter-spent'); }
      } else {
        crew.mission.hp = Math.max(0, crew.mission.hp - speed * 9);
        if (!crew.mission.hp) { crew.driver = null; m.event('hunter-disabled'); }
      }
    },
    choice: true,
  },
];

export class Missions {
  // g: { world, vehicles, driving, player, wanted, life, chase, crowd, rng, marker, onSaved }
  constructor(g) {
    this.g = g;
    this.rng = g.rng;
    this.progress = 0;        // index of the next mission (5 = story complete)
    this.ending = null;
    this.owned = null;        // { type, paint } of the player's car (set when a mission ends in a car)
    this.log = [];
    this.time = 0;
    this.dt = 0;
    this.lines = [];
    this.reset();
    registerSection('missions', {
      serialize: () => ({ progress: this.progress, ending: this.ending }),
      restore: (d) => { this.progress = d.progress; this.ending = d.ending; },
    });
  }

  // Drop the active mission and every entity reference (the fleet has been rebuilt or is about to be).
  reset() {
    this.time = 0;            // mission clock restarts with the world (log timestamps do not depend on boot frames)
    this.phase = 'idle';
    this.cur = null;
    this.result = null;
    this.lines.length = 0;
    this.line = null;
    this.entities = [];
    this.declined = -1;
    this.g.marker.reset();
  }

  get contactIndex() { return Math.min(this.progress, MISSIONS.length - 1); }
  get contact() { return MISSIONS[this.contactIndex].contact; }
  checkpoint() { const c = this.contact; return { x: c.x, z: c.z, yaw: c.yaw }; }
  parkSpot() { return MISSIONS[this.contactIndex].park; }

  // ---- helpers used by the mission definitions
  inCar() { return this.g.driving.driving; }
  focus() { return this.g.driving.driving ? this.g.driving.vehicle : this.g.player.pos; }
  speed() { return this.g.driving.driving ? this.g.driving.vehicle.speed : this.g.player.speed; }
  near(p, r) { return dist(this.focus(), p) < r; }
  say(lines, seconds = 3.6) { for (const text of lines) this.lines.push({ text, t: seconds }); }
  event(name) { this.log.push({ t: +this.time.toFixed(2), mission: this.cur?.def.id ?? null, event: name }); }

  _spawn(type, x, z, yaw, paint) {
    const v = this.g.vehicles.spawn(type, x, z, yaw, null, paint ? { paint } : {});
    v.mission = { id: this.cur.def.id };
    this.entities.push(v);
    return v;
  }
  // A car for the player to use; it stays in the city (as an ordinary parked car) after the mission.
  ride(type, x, z, yaw, paint) { const v = this._spawn(type, x, z, yaw, paint); v.mission.ride = true; return v; }
  // A mission-owned car (target, truck, crews, watch posts); removed when the mission ends.
  prop(type, x, z, yaw, paint) { return this._spawn(type, x, z, yaw, paint); }
  remove(v) {
    if (v === this.g.driving.vehicle) return;
    this._drop(v);
    this.entities = this.entities.filter((e) => e !== v);
  }
  _drop(v) {
    const V = this.g.vehicles.vehicles, i = V.indexOf(v);
    if (i >= 0) V.splice(i, 1);
    if (this.g.vehicles.playerVehicle === v) this.g.vehicles.playerVehicle = null;
  }
  // Mission over: props go, the ride stays only if the player is sitting in it.
  _cleanup() {
    for (const v of [...this.entities]) {
      if (v === this.g.driving.vehicle) { v.mission = null; v.fromMission = this.cur.def.id; continue; }
      this.remove(v);
    }
    this.entities = [];
    this.g.marker.showPackage(null);
    this.g.vehicles.refill(this.focus());
  }

  begin(index, retry = false) {
    this._cleanup();
    const def = MISSIONS[index];
    // a car the courier was sitting in when an earlier attempt ended stays in the city; on a
    // retry or replay it would sit exactly where setup() spawns this attempt's car, so it goes
    for (const v of this.g.vehicles.vehicles.filter((o) => o.fromMission === def.id && o !== this.g.driving.vehicle)) this._drop(v);
    const d = { stage: 0, t: 0, stageT: 0 };
    this.cur = { def, index, d };
    this.phase = 'active';
    this.result = null;
    this.event(retry ? 'retry' : 'started');
    def.setup?.(this, d);
    this._enter();
  }

  _enter() {
    const { def, d } = this.cur;
    d.stageT = 0;
    def.stages[d.stage].enter?.(this, d);
    this.event(`objective:${d.stage}`);
  }

  _advance() {
    const { def, d } = this.cur;
    def.stages[d.stage].exit?.(this, d);
    d.stage++;
    if (d.stage < def.stages.length) { this._enter(); return; }
    if (def.choice) { this.phase = 'choice'; this.event('choice'); this.g.wanted.reset(); return; }
    this._succeed();
  }

  _succeed(reward = this.cur.def.reward, ending = null) {
    const { def, index } = this.cur;
    const first = index >= this.progress;
    const paid = first ? reward : 0;
    this.g.life.money += paid;
    if (first) this.progress = index + 1;
    if (ending) this.ending = ending;
    const v = this.g.driving.driving ? this.g.driving.vehicle : null;
    if (v && v.type.name !== 'police') {
      this.owned = { type: v.type.name, paint: '#' + v.paint.getHexString() };
      for (const o of this.g.vehicles.vehicles) o.owned = o === v;     // one owned car, the same one a reload restores
    }
    const lines = ending ? STORY.endings[ending].lines : STORY.missions[index].success;
    this.say(lines, 4.2);
    this.result = { ok: true, title: ending ? STORY.endings[ending].title : 'MISSION PASSED', detail: `${STORY.missions[index].title}${paid ? `  +$${paid}` : ''}`, t: 5 };
    this.event(`success:+${paid}`);
    emit('mission:passed', { id: def.id, index, first, ending });
    this._cleanup();
    this.phase = 'result';
    this.cur = { def, index, done: true };
    this.g.onSaved?.('mission');
  }

  fail(reason) {
    if (this.phase !== 'active' && this.phase !== 'choice') return;
    this.event(`fail:${reason}`);
    this.result = { ok: false, title: 'MISSION FAILED', detail: reason, t: 9, index: this.cur.index };
    this._cleanup();
    this.cur = { def: this.cur.def, index: this.cur.index, done: true };
    this.phase = 'result';
  }

  retry() {
    const index = this.result?.index;
    if (index === undefined) return false;
    const c = MISSIONS[index].contact, g = this.g;
    g.driving.reset();
    g.player.spawn(c.x, c.z, c.yaw);
    g.chase.snap(g.player.pos, c.yaw);
    g.wanted.reset();
    this.begin(index, true);
    return true;
  }

  choose(which) {
    if (this.phase !== 'choice') return false;
    const opt = STORY.missions[4].choice[which];
    this.event(`ending:${which}`);
    this._succeed(opt.reward, which);
    return true;
  }

  onPair(a, b, speed) {
    if (this.phase !== 'active' || this.cur?.done) return;
    const { def, d } = this.cur;
    if (!def.onPair) return;
    const pv = this.g.driving.driving ? this.g.driving.vehicle : null;
    const other = a === pv ? b : b === pv ? a : null;
    // one hit per pair per 0.4 s (the solver can report a contact on consecutive substeps)
    const key = `${a.id}:${b.id}`;
    d.hits ??= {};
    if ((d.hits[key] ?? -1) > this.time) return;
    d.hits[key] = this.time + 0.4;
    def.onPair(this, d, other, speed, a, b);
  }

  // Is a collision with this car a reportable crime? Hostile mission cars are not.
  exempt(v) { return !!v?.mission?.hostile; }

  update(dt, input) {
    this.time += dt; this.dt = dt;
    if (this.line) { this.line.t -= dt; if (this.line.t <= 0) this.line = null; }
    if (!this.line && this.lines.length) this.line = this.lines.shift();
    const g = this.g;
    if (this.phase === 'idle') {
      if (g.life.incident) return;
      const c = this.contact;
      const d = dist(this.focus(), c);
      if (this.declined >= 0 && d > 10) this.declined = -1;
      if (this.declined < 0 && d < (this.inCar() ? 6.5 : 3.2) && this.speed() < 3) {
        this.phase = 'briefing';
        this.event(`briefing:${MISSIONS[this.contactIndex].id}`);
      }
      return;
    }
    if (this.phase === 'briefing') {
      if (input.tap('KeyE')) this.begin(this.contactIndex);
      else if (dist(this.focus(), this.contact) > 9 || g.life.incident) { this.phase = 'idle'; this.declined = this.contactIndex; }
      return;
    }
    if (this.phase === 'result') {
      if (g.life.incident) return;
      this.result.t -= dt;
      if (!this.result.ok && input.tap('KeyE')) { this.retry(); return; }
      if (this.result.t <= 0) {
        const failed = !this.result.ok;
        this.phase = 'idle'; this.result = null; this.cur = null;
        this.declined = this.contactIndex;     // don't reopen the briefing under the player's feet
        if (failed) g.onSaved?.('failed');
      }
      return;
    }
    if (this.phase === 'choice') {
      if (input.tap('Digit1', 'Numpad1')) this.choose('press');
      else if (input.tap('Digit2', 'Numpad2')) this.choose('deal');
      return;
    }
    // active
    const { def, d } = this.cur;
    if (g.life.incident) { this.fail(g.life.incident.title === 'ARRESTED' ? 'You were arrested' : 'You flatlined'); return; }
    d.t += dt; d.stageT += dt;
    const st = def.stages[d.stage];
    const why = def.always?.(this, d);
    if (typeof why === 'string') { this.fail(why); return; }
    if (def.timeLimit && d.stage > 0 && d.t > def.timeLimit) { this.fail('Out of time'); return; }
    if (st.limit && d.stageT > st.limit) { this.fail(st.limitReason); return; }
    const r = st.tick(this, d);
    if (typeof r === 'string') this.fail(r);
    else if (r) this._advance();
  }

  // Current waypoint for the world beam and the minimap.
  waypoint() {
    if (this.phase === 'idle' || this.phase === 'briefing') {
      const c = this.contact;
      return { x: c.x, z: c.z, r: 2.4, kind: 'contact', y: this.g.world.groundHeight(c.x, c.z) };
    }
    if (this.phase !== 'active') return null;
    const { def, d } = this.cur;
    const wp = def.stages[d.stage].wp?.(this, d);
    return wp ? { kind: 'objective', ...wp, y: wp.kind === 'target' ? 0 : this.g.world.groundHeight(wp.x, wp.z) } : null;
  }

  render(time) {
    this.g.marker.set(this.waypoint(), time);
    this.g.marker.showPackage(this.phase === 'active' ? this.cur.d.package : null, time);
  }

  // Minimap marks: waypoint, mission cars and watch zones.
  marks() {
    const out = [];
    const wp = this.waypoint();
    if (wp) out.push({ x: wp.x, z: wp.z, kind: wp.kind, pin: true });
    if (this.phase === 'active') {
      const d = this.cur.d;
      for (const w of d.posts ?? []) out.push({ x: w.x, z: w.z, kind: 'zone', r: w.r, hot: w.tripped });
      if (d.truck) out.push({ x: d.truck.x, z: d.truck.z, kind: 'ally' });
      for (const c of d.crews ?? []) if (c.mission?.hp) out.push({ x: c.x, z: c.z, kind: 'hostile' });
      if (d.target) out.push({ x: d.target.x, z: d.target.z, kind: 'target' });
    }
    return out;
  }

  hud() {
    const def = this.cur?.def, idx = this.cur?.index ?? this.contactIndex;
    const out = { line: this.line?.text ?? '', phase: this.phase, title: '', objective: '', meter: null, timer: null, briefing: null, result: this.result, choice: null };
    if (this.phase === 'idle') {
      out.title = this.progress >= MISSIONS.length ? 'STORY COMPLETE' : `NEXT · ${STORY.missions[idx].title}`;
      out.objective = this.progress >= MISSIONS.length ? `Ending: ${STORY.endings[this.ending]?.title ?? '-'}. Replay THE LAST ROUTE at the red marker` : 'Meet the contact at the red marker';
    } else if (this.phase === 'briefing') {
      const m = STORY.missions[idx];
      const replay = idx < this.progress;
      out.briefing = { n: idx + 1, title: m.title, lines: m.brief, reward: replay ? 'Replay, no payout' : MISSIONS[idx].reward ? `$${MISSIONS[idx].reward}` : '$500 / $2500' };
    } else if (this.phase === 'active') {
      const d = this.cur.d, st = def.stages[d.stage];
      out.title = STORY.missions[idx].title;
      out.objective = st.text(this, d);
      out.meter = st.meter?.(this, d) ?? null;
      const limit = st.limit ? st.limit - d.stageT : def.timeLimit && d.stage > 0 ? def.timeLimit - d.t : null;
      out.timer = limit === null ? null : Math.max(0, limit);
    } else if (this.phase === 'choice') {
      const c = STORY.missions[4].choice;
      out.title = STORY.missions[4].title;
      out.choice = { prompt: c.prompt, options: [c.press, c.deal] };
    }
    return out;
  }

  // Tool view of the current state.
  status() {
    const d = this.cur?.d;
    return { phase: this.phase, progress: this.progress, ending: this.ending, owned: this.owned, mission: this.cur?.def.id ?? null,
      stage: d?.stage ?? null, entities: this.entities.length, result: this.result && { ok: this.result.ok, title: this.result.title, detail: this.result.detail },
      truckHp: d?.truck?.mission?.hp ?? null, nerve: d?.nerve ?? null, ledger: d?.ledger ?? null, crews: d?.crews?.map((c) => c.mission?.hp ?? 0) ?? null,
      waypoint: this.waypoint(), objective: this.hud().objective };
  }
}
