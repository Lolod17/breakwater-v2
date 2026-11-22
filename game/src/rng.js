// Seeded randomness. Every generator in the game forks a named stream from the
// master seed, so adding a new consumer never shifts the numbers of another.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a;
  next.loadState = (s) => { a = s >>> 0; };
  return next;
}

export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }
  float(min = 0, max = 1) { return min + (max - min) * this.next(); }
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p) { return this.next() < p; }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  weighted(entries) {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [value, w] of entries) { r -= w; if (r <= 0) return value; }
    return entries[entries.length - 1][0];
  }
  fork(label) { return new RNG(hashString(label) ^ Math.imul(this.seed, 2654435761)); }
  // Stream position, for persistence (save v2 weather).
  state() { return this.next.state(); }
  loadState(s) { this.next.loadState(s); }
}

export function seedFromURL(fallback = 1337) {
  const p = new URLSearchParams(location.search).get('seed');
  const n = p == null ? NaN : Number(p);
  return Number.isFinite(n) ? n >>> 0 : fallback;
}
