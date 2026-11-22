import { registerSection } from '../save.js';

const DAY_MINUTES = 24 * 60;
const SECONDS_PER_MINUTE = 20;
const START_MINUTES = 19 * 60 + 20;

let total = START_MINUTES;
let day = 1;   // PASS 7: day counter for the HUD and the title's Continue row (wraps past midnight)

export function serialize() { return { minutes: total, day }; }
export function restore(data) { total = data.minutes; day = Number.isInteger(data.day) && data.day >= 1 ? data.day : 1; }
export function reset() { total = START_MINUTES; day = 1; }
export function dayNumber() { return day; }
export function totalMinutes() { return total; }
registerSection('clock', { serialize, restore });

export function advance(seconds) {
  if (!Number.isFinite(seconds)) return;
  total += seconds / SECONDS_PER_MINUTE;
  while (total >= DAY_MINUTES) { total -= DAY_MINUTES; day++; }
  if (total < 0) total += DAY_MINUTES;
}

export function hour() {
  return Math.floor(total / 60) % 24;
}

export function minutes() {
  return Math.floor(total % 60);
}
