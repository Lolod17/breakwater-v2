import { RNG } from '../rng.js';
import * as Time from './time.js';
import { emit } from '../core/events.js';
import { registerSection } from '../save.js';

const STATES = ['clear', 'overcast', 'rain', 'fog'];
const DEFAULT_SEED = 1337;
const BLEND_RATE = 0.15;
const WET_RATE = 0.02;
const DRY_RATE = 0.004;
const MIN_HOURS = 2;
const MAX_HOURS = 5;
const ODDS = [['clear', 0.38], ['overcast', 0.27], ['rain', 0.22], ['fog', 0.13]];
const DAY_MINUTES = 24 * 60;

function oneHot(state) {
  const w = {};
  for (const s of STATES) w[s] = s === state ? 1 : 0;
  return w;
}

function stamp() {
  return Time.hour() * 60 + Time.minutes();
}

let rng = new RNG(DEFAULT_SEED).fork('weather');
let blend = oneHot('clear');
let goal = oneHot('clear');
let wet = 0;
let dominant = 'clear';
let clock = 0;
let lastStamp = stamp();

function span() {
  return rng.float(MIN_HOURS, MAX_HOURS) * 60;
}

let nextAt = span();

function goalState() {
  return STATES.find((s) => goal[s] === 1);
}

function pickState() {
  return rng.weighted(ODDS.filter(([s]) => s !== goalState()));
}

function syncDominant() {
  let best = STATES[0];
  for (const s of STATES) if (blend[s] > blend[best]) best = s;
  if (best !== dominant) {
    const from = dominant;
    dominant = best;
    emit('weather:changed', { state: best, from });
  }
}

export function init(seed = DEFAULT_SEED) {
  rng = new RNG(seed >>> 0).fork('weather');
  blend = oneHot('clear');
  goal = oneHot('clear');
  wet = 0;
  dominant = 'clear';
  clock = 0;
  lastStamp = stamp();
  nextAt = span();
  return current();
}

export function set(state) {
  if (!STATES.includes(state)) return false;
  goal = oneHot(state);
  return true;
}

// PASS 16 tool / sleep hook: jump straight to a state (no blend), optionally with a wetness.
export function snap(state, wetness) {
  if (!set(state)) return false;
  blend = oneHot(state);
  if (Number.isFinite(wetness)) wet = Math.min(1, Math.max(0, wetness));
  syncDominant();
  return true;
}

export function update(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const now = stamp();
  let delta = now - lastStamp;
  if (delta < 0) delta += DAY_MINUTES;
  lastStamp = now;
  clock += delta;
  while (clock >= nextAt) {
    goal = oneHot(pickState());
    nextAt += span();
  }
  const k = 1 - Math.exp(-BLEND_RATE * dt);
  let sum = 0;
  for (const s of STATES) {
    blend[s] += (goal[s] - blend[s]) * k;
    sum += blend[s];
  }
  for (const s of STATES) blend[s] /= sum;
  wet = Math.min(1, Math.max(0, wet + dt * (WET_RATE * blend.rain - DRY_RATE * (1 - blend.rain))));
  syncDominant();
}

export function current() {
  return dominant;
}

export function weights() {
  return { ...blend };
}

export function target() {
  return { ...goal };
}

export function wetness() {
  return wet;
}

// Full state, including the RNG stream position, so a loaded save picks up the
// same schedule it would have had without the reload.
export function serialize() {
  return { seed: rng.seed, state: goalState(), wetness: wet, clock, nextAt, rngState: rng.state() };
}

export function restore(data) {
  rng = new RNG(data.seed);
  rng.loadState(data.rngState);
  blend = oneHot(data.state);
  goal = oneHot(data.state);
  wet = data.wetness;
  clock = data.clock;
  nextAt = data.nextAt;
  dominant = data.state;
  lastStamp = stamp();
}

registerSection('weather', { serialize, restore });
