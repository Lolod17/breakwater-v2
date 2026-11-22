// PASS 14b: stealth. Two levels, both 0..1:
//   noise      - what the player is doing right now (standing 0, crouch-walk
//                0.06 ... sprint 0.6, a moving car more) plus decaying bangs
//                (gunfire 1, crashes, melee hits).
//   visibility - daylight from env/time.js (full by day, 0.4 at night with a
//                ramp at dusk and dawn), times the weather blend from
//                env/weather.js (fog 0.5, rain 0.75, overcast 0.9), times
//                posture (crouched 0.65).
// A crime only reaches the wanted level when it is reported: either it is loud
// enough to be heard (noise >= NOISE_REPORT) or the player is visible enough
// (visibility >= VISIBILITY_REPORT) and a witness - a police officer or
// cruiser, or a bystander who calls it in - has a clear line of sight within
// SIGHT_RANGE x visibility metres.
// C toggles crouch on foot (crouched = walk speed, no sprint).
import * as Time from '../env/time.js';
import * as Weather from '../env/weather.js';

export const CROUCH_KEY = 'KeyC';
export const NOISE_REPORT = 0.7;
export const VISIBILITY_REPORT = 0.35;
export const SIGHT_RANGE = 45;

// The bang a crime itself makes (firearm shots use the weapon's own noise).
export const CRIME_NOISE = { shot: 1, collision: 0.75, cruiser: 0.8, pedestrian: 0.35, assault: 0.25 };
const MOVE_NOISE = { still: 0, crouch: 0.06, walk: 0.12, jog: 0.3, sprint: 0.6 };
const WEATHER_SIGHT = { clear: 1, overcast: 0.9, rain: 0.75, fog: 0.5 };
const NIGHT_LIGHT = 0.4;
const CROUCHED = 0.65;
const BANG_DECAY = 0.45;          // noise units per second

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// 1 by day, NIGHT_LIGHT at night, linear through dawn (05-07) and dusk (18-21).
export function daylight(hours = Time.totalMinutes() / 60) {
  const h = ((hours % 24) + 24) % 24;
  if (h >= 7 && h <= 18) return 1;
  if (h >= 21 || h <= 5) return NIGHT_LIGHT;
  const k = h < 12 ? (h - 5) / 2 : 1 - (h - 18) / 3;
  return NIGHT_LIGHT + (1 - NIGHT_LIGHT) * k;
}

export function weatherSight(weights = Weather.weights()) {
  let total = 0, sum = 0;
  for (const [state, w] of Object.entries(weights)) { total += w; sum += w * (WEATHER_SIGHT[state] ?? 1); }
  return total > 0 ? sum / total : 1;
}

export class Stealth {
  constructor() { this.reset(); }

  reset() {
    this.crouched = false;
    this.base = 0;        // movement noise this step
    this.bangLevel = 0;   // decaying impulse
    this.gait = 'still';
    this.driving = false;
  }

  get noise() { return Math.max(this.base, this.bangLevel); }

  toggleCrouch(allowed = true) {
    this.crouched = allowed && !this.crouched;
    return this.crouched;
  }

  // A loud moment (0..1): gunfire, a crash, a melee hit.
  bang(level) {
    if (Number.isFinite(level)) this.bangLevel = Math.max(this.bangLevel, clamp01(level));
  }

  // foot: { speed, sprint } of the walking player; car: { speed } while driving.
  update(dt, { foot = null, car = null } = {}) {
    this.bangLevel = Math.max(0, this.bangLevel - BANG_DECAY * dt);
    this.driving = !!car;
    if (car) {
      this.crouched = false;
      this.gait = 'car';
      this.base = clamp01(0.18 + Math.abs(car.speed) / 40);
    } else if (foot) {
      const s = foot.speed;
      this.gait = s < 0.3 ? 'still' : this.crouched ? 'crouch' : foot.sprint > 0.5 || s > 5.6 ? 'sprint' : s > 2.4 ? 'jog' : 'walk';
      this.base = MOVE_NOISE[this.gait];
    } else {
      this.gait = 'still';
      this.base = 0;
    }
  }

  visibility() {
    const posture = this.crouched && !this.driving ? CROUCHED : 1;
    return clamp01(daylight() * weatherSight() * posture);
  }

  // Would this crime be reported? `crimeNoise` is the bang the act makes;
  // `witness(range)` answers whether anyone with a clear sightline is within range.
  report(crimeNoise, witness) {
    this.bang(crimeNoise);
    const noise = this.noise, visibility = this.visibility();
    const heard = noise >= NOISE_REPORT;
    const seen = visibility >= VISIBILITY_REPORT && !!witness?.(SIGHT_RANGE * visibility);
    return { report: heard || seen, heard, seen, noise: +noise.toFixed(3), visibility: +visibility.toFixed(3) };
  }

  status() {
    return { crouched: this.crouched, gait: this.gait, noise: +this.noise.toFixed(3), visibility: +this.visibility().toFixed(3),
      daylight: +daylight().toFixed(3), weather: +weatherSight().toFixed(3), sightRange: +(SIGHT_RANGE * this.visibility()).toFixed(1) };
  }
}
