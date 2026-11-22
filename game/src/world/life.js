// PASS 13b — living world, random encounters, NPC reactions (logic only).
// Seeded world events on a timer driven by env/time.js (the same minute-stamp
// scheme weather uses), short-lived encounters near the player, and pedestrian
// reactions as plain data. No meshes, no rendering: the crowd reads
// reactionFor()/playerState(), traffic can read activeEvents(). Money moves
// through econ/wallet.js; faction standing persists in the save's existing
// 'factions' section and routes through econ/factions.js when that module is
// attached (it does not exist yet, so standing is tracked here until it does).
import { RNG } from '../rng.js';
import * as Time from '../env/time.js';
import { CITY } from '../config.js';
import { emit } from '../core/events.js';
import { earn, balance } from '../econ/wallet.js';
import { registerSection, patchSection } from '../save.js';

const DAY_MINUTES = 24 * 60;
const DEFAULT_SEED = 1337;
const MAX_EVENTS = 4;
const GREET_REP = 10;
const AVOID_WANTED = 3;
const AVOID_RADIUS = 16;
const GREET_RADIUS = 9;
const OFFER_TTL = 30;
const RIDE_SECONDS = 12;
const MUGGING_REP = 10;

export const EVENT_KINDS = ['street_fight', 'car_breakdown', 'police_chase', 'market_crowd', 'quiet_streets'];
export const ENCOUNTER_KINDS = ['ride', 'mugging', 'wallet'];

// Faction districts as data: standing >= GREET_REP makes their walkers greet.
export const DISTRICTS = [
  { id: 'dockside', faction: 'dockers', x0: -212, x1: 212, z0: 120, z1: 225.6 },
  { id: 'midtown', faction: 'midtown', x0: -212, x1: 212, z0: -40, z1: 120 },
  { id: 'northside', faction: 'northside', x0: -212, x1: 212, z0: -212, z1: -40 },
];
export function districtAt(x, z) {
  return DISTRICTS.find((d) => x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) ?? null;
}

const isDay = (h) => h >= 7 && h < 19;
const isLateNight = (h) => h >= 0 && h < 5;
const stamp = () => Time.hour() * 60 + Time.minutes();

let seed = DEFAULT_SEED;
let rng = new RNG(seed).fork('life');
let encRng = new RNG(seed).fork('life:encounters');
let clock = 0;                       // game minutes since init (wrap-aware)
let lastStamp = stamp();
let nextAt = 0;
let elapsed = 0;                     // real seconds since init
let events = [];
let threats = [];                    // gunfire / crash reports, expire on dt
let nextEventId = 1;
let encounter = null;
let nextEncounterId = 1;
let encTimer = 0;
let rep = {};
let factionsApi = null;
const player = { x: 32.2, z: 150, wanted: 0, driving: false, speed: 0 };

export function serialize() { return { ...rep }; }
export function restore(data) { rep = { ...data }; }
registerSection('factions', { serialize, restore });

// When econ/factions.js lands, attach it here: adjust(faction, delta) then owns
// the standing (and its persistence); until then this module keeps the ledger.
export function attachFactions(api) { factionsApi = api && typeof api.adjust === 'function' ? api : null; }
export function factionRep() { return { ...rep }; }

function adjustRep(faction, delta) {
  rep[faction] = Math.max(-100, Math.min(100, (rep[faction] ?? 0) + delta));
  if (factionsApi) factionsApi.adjust(faction, delta);
  else patchSection('factions', serialize());
  return rep[faction];
}

const span = () => rng.float(14, 32);           // game minutes between events

export function init(s = DEFAULT_SEED) {
  seed = s >>> 0;
  rng = new RNG(seed).fork('life');
  encRng = new RNG(seed).fork('life:encounters');
  events = [];
  threats = [];
  encounter = null;
  nextEventId = 1;
  nextEncounterId = 1;
  elapsed = 0;
  clock = 0;
  lastStamp = stamp();
  nextAt = span();
  encTimer = encRng.float(25, 55);
  rep = {};
  return snapshot();
}
export function reset() { return init(seed); }

export function setPlayer(ctx) {
  if (!ctx || !Number.isFinite(ctx.x) || !Number.isFinite(ctx.z)) return;
  player.x = ctx.x; player.z = ctx.z;
  player.wanted = Number.isFinite(ctx.wanted) ? ctx.wanted : 0;
  player.driving = !!ctx.driving;
  player.speed = Number.isFinite(ctx.speed) ? ctx.speed : 0;
}

// ---- world events -----------------------------------------------------------

function streetPoint() {
  const S = CITY.streets;
  const axis = rng.pick(['x', 'z']);
  const c = rng.pick(S);
  const i = rng.int(0, S.length - 2);
  const along = S[i] + (S[i + 1] - S[i]) * rng.float(0.25, 0.75);
  return axis === 'x' ? { x: along, z: c, axis, c, a: S[i], b: S[i + 1] } : { x: c, z: along, axis, c, a: S[i], b: S[i + 1] };
}

function makeEvent(kind) {
  const h = Time.hour();
  const ev = { id: nextEventId++, kind, hour: h, x: 0, z: 0, radius: 0, duration: 0, left: 0 };
  if (kind === 'street_fight') {
    const S = CITY.streets;
    ev.x = rng.pick(S) + rng.sign() * 7.5;
    ev.z = rng.pick(S) + rng.sign() * 7.5;
    ev.radius = 13;
    ev.duration = ev.left = rng.float(18, 30);
  } else if (kind === 'car_breakdown') {
    const p = streetPoint();
    const lane = rng.sign() * 3;
    ev.x = p.axis === 'x' ? p.x : p.x + lane;
    ev.z = p.axis === 'x' ? p.z + lane : p.z;
    ev.axis = p.axis; ev.lane = lane; ev.slow = 0.4;
    ev.radius = 9;
    ev.duration = ev.left = rng.float(40, 70);
  } else if (kind === 'police_chase') {
    const S = CITY.streets;
    const axis = rng.pick(['x', 'z']);
    const c = rng.pick(S);
    const i = rng.int(0, S.length - 2);
    const dir = rng.sign();
    const from = { x: axis === 'x' ? S[i] : c, z: axis === 'x' ? c : S[i] };
    const to = { x: axis === 'x' ? S[i + 1] : c, z: axis === 'x' ? c : S[i + 1] };
    if (dir < 0) { const t = { ...from }; from.x = to.x; from.z = to.z; to.x = t.x; to.z = t.z; }
    ev.from = from; ev.to = to; ev.axis = axis;
    ev.speed = rng.float(15, 21);
    ev.yield = true;
    ev.radius = 16;
    ev.duration = ev.left = Math.hypot(to.x - from.x, to.z - from.z) / ev.speed;
    ev.x = from.x; ev.z = from.z;
  } else if (kind === 'market_crowd') {
    const p = streetPoint();
    ev.x = p.x; ev.z = p.z;
    ev.radius = 34; ev.crowd = 1.6;
    ev.duration = ev.left = rng.float(35, 70) * 20;   // game minutes -> seconds
  } else if (kind === 'quiet_streets') {
    ev.crowd = 0.35; ev.traffic = 0.45;
    ev.duration = ev.left = rng.float(45, 90) * 20;
  }
  return ev;
}

function publicEvent(ev) {
  const out = { id: ev.id, kind: ev.kind, x: +ev.x.toFixed(2), z: +ev.z.toFixed(2), radius: ev.radius,
    left: +ev.left.toFixed(2), duration: +ev.duration.toFixed(2), hour: ev.hour };
  if (ev.kind === 'car_breakdown') { out.axis = ev.axis; out.lane = ev.lane; out.slow = ev.slow; }
  if (ev.kind === 'police_chase') {
    out.from = { ...ev.from }; out.to = { ...ev.to }; out.speed = +ev.speed.toFixed(2); out.yield = true;
    out.progress = +Math.min(1, Math.max(0, 1 - ev.left / ev.duration)).toFixed(3);
  }
  if (ev.kind === 'market_crowd') out.crowd = ev.crowd;
  if (ev.kind === 'quiet_streets') { out.crowd = ev.crowd; out.traffic = ev.traffic; }
  return out;
}

function spawnEvent() {
  if (events.length >= MAX_EVENTS) return;
  const h = Time.hour();
  const ambient = events.some((e) => e.kind === 'market_crowd' || e.kind === 'quiet_streets');
  const kind = rng.weighted([
    ['street_fight', h >= 18 || h < 5 ? 3 : 1.4],
    ['car_breakdown', 2],
    ['police_chase', 1.6],
    ['market_crowd', isDay(h) && !ambient ? 2.2 : 0],
    ['quiet_streets', isLateNight(h) && !ambient ? 2.6 : 0],
  ].filter(([, w]) => w > 0));
  const ev = makeEvent(kind);
  events.push(ev);
  emit('life:event', { phase: 'start', ...publicEvent(ev) });
}

function endEvent(index, reason) {
  const ev = events[index];
  events.splice(index, 1);
  emit('life:event', { phase: 'end', reason, ...publicEvent(ev) });
}

export function activeEvents() { return events.map(publicEvent); }

// ---- gunfire / crash reports (threats for reactionFor) ----------------------

function report(kind, x, z, radius, duration) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  if (threats.length >= 8) threats.shift();
  threats.push({ kind, x, z, radius, left: duration });
}
export function reportGunfire(x, z, radius = 30, duration = 4) { report('gunfire', x, z, radius, duration); }
export function reportCrash(x, z, radius = 16, duration = 3) { report('crash', x, z, radius, duration); }

// ---- NPC reactions as data --------------------------------------------------

export function playerState() {
  const t = threats.map((a) => ({ kind: a.kind, x: a.x, z: a.z, radius: a.radius }));
  for (const ev of events) {
    if (ev.kind === 'street_fight') t.push({ kind: 'fight', x: ev.x, z: ev.z, radius: ev.radius });
    else if (ev.kind === 'police_chase') t.push({ kind: 'chase', x: ev.x, z: ev.z, radius: ev.radius });
  }
  return { x: player.x, z: player.z, wanted: player.wanted, driving: player.driving, speed: player.speed, threats: t, rep: { ...rep } };
}

const NONE = { kind: 'none', x: 0, z: 0, pace: 0 };
// Pure data: flee gunfire/crash/fights/chases, keep distance at high wanted,
// greet in a friendly faction district. The crowd applies it as behaviour.
export function reactionFor(npcPos, state) {
  if (!npcPos || !state || !Number.isFinite(npcPos.x) || !Number.isFinite(npcPos.z)) return NONE;
  let fx = 0, fz = 0, flee = false;
  for (const t of state.threats || []) {
    const dx = npcPos.x - t.x, dz = npcPos.z - t.z, d = Math.hypot(dx, dz);
    if (d < t.radius) { fx += dx / Math.max(0.01, d); fz += dz / Math.max(0.01, d); flee = true; }
  }
  if (flee) {
    const l = Math.hypot(fx, fz) || 1;
    return { kind: 'flee', x: fx / l, z: fz / l, pace: 3.25 };
  }
  const dp = Math.hypot(state.x - npcPos.x, state.z - npcPos.z);
  if ((state.wanted || 0) >= AVOID_WANTED && dp < AVOID_RADIUS) {
    return { kind: 'avoid', x: (npcPos.x - state.x) / Math.max(0.01, dp), z: (npcPos.z - state.z) / Math.max(0.01, dp), pace: 2.3 };
  }
  if (!state.driving && (state.wanted || 0) === 0 && dp > 0.8 && dp < GREET_RADIUS && (state.speed || 0) < 2.5) {
    const d = districtAt(npcPos.x, npcPos.z);
    if (d && (state.rep?.[d.faction] ?? 0) >= GREET_REP) return { kind: 'greet', x: state.x, z: state.z, pace: 0 };
  }
  return NONE;
}

// ---- random encounters ------------------------------------------------------

export function encounterState() {
  if (!encounter) return null;
  const e = encounter;
  return { id: e.id, kind: e.kind, phase: e.phase, x: +e.x.toFixed(2), z: +e.z.toFixed(2),
    ttl: +Math.max(0, e.ttl).toFixed(2), amount: e.amount, faction: e.faction,
    rideLeft: +Math.max(0, e.rideLeft).toFixed(2), outcome: e.outcome, paid: e.paid ?? 0, repDelta: e.repDelta ?? 0 };
}

export function offer(kind, at) {
  if (!ENCOUNTER_KINDS.includes(kind)) return null;
  if (encounter && (encounter.phase === 'offered' || encounter.phase === 'accepted')) return null;
  const base = at && Number.isFinite(at.x) && Number.isFinite(at.z) ? at : player;
  const ang = encRng.float(0, Math.PI * 2), r = encRng.float(4, 9);
  const x = base.x + Math.cos(ang) * r, z = base.z + Math.sin(ang) * r;
  const amount = kind === 'ride' ? encRng.int(25, 60) : kind === 'wallet' ? encRng.int(15, 55) : 0;
  encounter = { id: nextEncounterId++, kind, phase: 'offered', x, z, ttl: OFFER_TTL, amount,
    faction: districtAt(x, z)?.faction ?? 'dockers', rideLeft: kind === 'ride' ? RIDE_SECONDS : 0, outcome: null };
  emit('encounter:offered', { id: encounter.id, kind, x: +x.toFixed(2), z: +z.toFixed(2), ttl: OFFER_TTL, amount, faction: encounter.faction });
  return encounterState();
}
// Tool hook: stage a specific encounter (the random timer uses offer() too).
export function forceOffer(kind, at) { return offer(kind, at); }

function resolveEncounter(outcome) {
  const e = encounter;
  if (!e || e.phase === 'resolved') return;
  let amount = 0, repDelta = 0;
  if (outcome === 'paid') { amount = e.amount; earn(amount, `life:${e.kind}`); }
  else if (outcome === 'stopped') { repDelta = MUGGING_REP; adjustRep(e.faction, MUGGING_REP); }
  e.phase = 'resolved'; e.outcome = outcome; e.paid = amount; e.repDelta = repDelta; e.ttl = 0; e.rideLeft = 0;
  encTimer = encRng.float(45, 90);
  emit('encounter:resolved', { id: e.id, kind: e.kind, outcome, amount, rep: repDelta, faction: e.faction, balance: balance() });
}

export function accept(id) {
  const e = encounter;
  if (!e || e.phase !== 'offered' || (id != null && id !== e.id)) return false;
  e.phase = 'accepted';
  if (e.kind !== 'ride') resolveEncounter(e.kind === 'mugging' ? 'stopped' : 'paid');
  return true;
}

export function ignore(id) {
  const e = encounter;
  if (!e || e.phase !== 'offered' || (id != null && id !== e.id)) return false;
  resolveEncounter('ignored');
  return true;
}

function stepEncounter(dt) {
  const e = encounter;
  if (e && e.phase === 'offered') {
    e.ttl -= dt;
    if (e.ttl <= 0) resolveEncounter('expired');
    return;
  }
  if (e && e.phase === 'accepted') {
    if (e.kind === 'ride') {
      e.rideLeft -= dt;
      if (e.rideLeft <= 0) resolveEncounter('paid');
    }
    return;
  }
  encTimer -= dt;
  if (encTimer > 0 || player.wanted >= AVOID_WANTED) return;
  encTimer = encRng.float(45, 90);
  offer(encRng.weighted([['ride', 0.4], ['mugging', 0.3], ['wallet', 0.3]]));
}

// ---- tick -------------------------------------------------------------------

export function update(dt, ctx) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  if (ctx) setPlayer(ctx);
  elapsed += dt;
  const now = stamp();
  let delta = now - lastStamp;
  if (delta < 0) delta += DAY_MINUTES;
  lastStamp = now;
  clock += delta;
  let guard = 0;
  while (clock >= nextAt && guard++ < 4) { spawnEvent(); nextAt += span(); }
  if (clock >= nextAt) nextAt = clock + span();   // a big time jump skips ahead, no burst
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    ev.left -= dt;
    if (ev.kind === 'police_chase') {
      const t = Math.min(1, Math.max(0, 1 - ev.left / ev.duration));
      ev.x = ev.from.x + (ev.to.x - ev.from.x) * t;
      ev.z = ev.from.z + (ev.to.z - ev.from.z) * t;
    }
    const windowClosed = (ev.kind === 'market_crowd' && !isDay(Time.hour())) || (ev.kind === 'quiet_streets' && !isLateNight(Time.hour()));
    if (ev.left <= 0) endEvent(i, 'expired');
    else if (windowClosed) endEvent(i, 'window');
  }
  for (let i = threats.length - 1; i >= 0; i--) {
    threats[i].left -= dt;
    if (threats[i].left <= 0) threats.splice(i, 1);
  }
  stepEncounter(dt);
}

export function snapshot() {
  return { hour: Time.hour(), minutes: Time.minutes(), elapsed: +elapsed.toFixed(2),
    events: activeEvents(), encounter: encounterState(), rep: factionRep(),
    threats: threats.map((t) => ({ kind: t.kind, x: t.x, z: t.z, radius: t.radius, left: +t.left.toFixed(2) })),
    nextEventIn: +Math.max(0, nextAt - clock).toFixed(2) };
}
