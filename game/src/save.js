// Versioned save (schema v2) in localStorage. The canonical object is
//   { version: 2, player, wallet, inventory, garage, factions, collectibles,
//     achievements, missions, clock, weather }
// plus a derived v1 mirror (v, money, mission, ending, checkpoint, wanted,
// owned; inventory is shared) so PASS 5 readers and tools keep understanding
// the file. The mirror is never trusted on read: it is recomputed from the
// sections, and the sections are the only authority.
//
// Systems plug in through registerSection(key, { defaults, validate, serialize,
// restore }): collectSave() gathers every registered serialize(), validate()
// checks every registered section, restoreSections() applies them. A new
// system never needs an edit here.
//
// Anything malformed (bad JSON, unknown version, wrong types, values out of
// range) is rejected as a whole and the game starts fresh instead of crashing.
// Every successful write rotates the previous good save into a backup slot; a
// rejected load never touches that backup.
import { VEHICLE_TYPES } from './vehicles/vehicleTypes.js';
import { CITY } from './config.js';
import { hashString } from './rng.js';

export const SAVE_KEY = 'breakwater.save';
export const BACKUP_KEY = 'breakwater.save.bak';
export const SAVE_VERSION = 2;
export const MISSION_COUNT = 5;

const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isNum = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (s) => typeof s === 'string' && /^[a-z0-9_-]{1,32}$/i.test(s);
const DAY_MINUTES = 24 * 60;
const WEATHER_STATES = ['clear', 'overcast', 'rain', 'fog'];
const PAINT = /^#[0-9a-f]{6}$/i;

function ownedValid(o) {
  return o === null || (isObj(o) && Object.hasOwn(VEHICLE_TYPES, o.type) && typeof o.paint === 'string' && PAINT.test(o.paint));
}
function inventoryValid(v) {
  if (!Array.isArray(v) || v.length > 12) return false;
  return v.every((s) => isObj(s) && isId(s.id) && isInt(s.count, 1, 99));
}
function idListSpec(field) {
  return {
    defaults: () => ({ [field]: [] }),
    validate: (v) => {
      if (!isObj(v) || !Array.isArray(v[field]) || v[field].length > 256) return field;
      const seen = new Set();
      for (const id of v[field]) {
        if (!isId(id) || seen.has(id)) return field;
        seen.add(id);
      }
      return null;
    },
    clean: (v) => ({ [field]: [...v[field]] }),
  };
}

// The v2 schema: defaults, a validator (error string | null) and a normalizer
// per section. Modules attach serialize/restore hooks (and may override these)
// through registerSection; entirely new keys bring their own defaults/validate.
const CORE = {
  player: {
    defaults: () => ({ checkpoint: { x: 32.2, z: 150, yaw: 0 }, wanted: 0 }),
    validate: (v) => {
      if (!isObj(v)) return 'not an object';
      const b = CITY.bounds, c = v.checkpoint;
      if (!isObj(c) || !isNum(c.x, b.x0, b.x1) || !isNum(c.z, b.z0, b.z1) || !isNum(c.yaw, -10, 10)) return 'checkpoint';
      if (!isNum(v.wanted, 0, 100)) return 'wanted';
      return null;
    },
    clean: (v) => ({ checkpoint: { x: v.checkpoint.x, z: v.checkpoint.z, yaw: v.checkpoint.yaw }, wanted: v.wanted }),
  },
  wallet: {
    defaults: () => ({ money: 250 }),
    validate: (v) => (isObj(v) && isInt(v.money, 0, 10_000_000) ? null : 'money'),
    clean: (v) => ({ money: v.money }),
  },
  inventory: {
    defaults: () => [],
    validate: (v) => (inventoryValid(v) ? null : 'slots'),
    clean: (v) => v.map((s) => ({ id: s.id, count: s.count })),
  },
  garage: {
    defaults: () => ({ owned: null }),
    validate: (v) => (isObj(v) && ownedValid(v.owned) ? null : 'owned'),
    clean: (v) => ({ owned: v.owned && { type: v.owned.type, paint: v.owned.paint.toLowerCase() } }),
  },
  factions: {
    defaults: () => ({}),
    validate: (v) => {
      if (!isObj(v)) return 'not an object';
      const keys = Object.keys(v);
      if (keys.length > 32) return 'too many';
      for (const k of keys) if (!isId(k) || !isNum(v[k], -100, 100)) return 'standing';
      return null;
    },
    clean: (v) => ({ ...v }),
  },
  collectibles: idListSpec('found'),
  achievements: idListSpec('unlocked'),
  missions: {
    defaults: () => ({ progress: 0, ending: null }),
    validate: (v) => {
      if (!isObj(v) || !isInt(v.progress, 0, MISSION_COUNT)) return 'progress';
      if (v.ending !== null && v.ending !== 'press' && v.ending !== 'deal') return 'ending';
      if (v.ending && v.progress < MISSION_COUNT) return 'ending before the last mission';
      return null;
    },
    clean: (v) => ({ progress: v.progress, ending: v.ending }),
  },
  clock: {
    defaults: () => ({ minutes: 19 * 60 + 20 }),
    validate: (v) => (!isObj(v) || !isNum(v.minutes, 0, DAY_MINUTES - 1e-9) ? 'minutes' : v.day !== undefined && !isInt(v.day, 1, 99999) ? 'day' : null),
    clean: (v) => (v.day === undefined ? { minutes: v.minutes } : { minutes: v.minutes, day: v.day }),
  },
  weather: {
    defaults: () => ({ seed: 1337, state: 'clear', wetness: 0, clock: 0, nextAt: 180,
      rngState: (hashString('weather') ^ Math.imul(1337, 2654435761)) >>> 0 }),
    validate: (v) => {
      if (!isObj(v)) return 'not an object';
      if (!isInt(v.seed, 0, 0xffffffff)) return 'seed';
      if (!WEATHER_STATES.includes(v.state)) return 'state';
      if (!isNum(v.wetness, 0, 1)) return 'wetness';
      if (!isNum(v.clock, 0, 1e9) || !isNum(v.nextAt, 0, 1e9) || v.nextAt <= v.clock) return 'schedule';
      if (!isInt(v.rngState, 0, 0xffffffff)) return 'rngState';
      return null;
    },
    clean: (v) => ({ seed: v.seed, state: v.state, wetness: v.wetness, clock: v.clock, nextAt: v.nextAt, rngState: v.rngState }),
  },
};

const registry = new Map();
const specOf = (key) => registry.get(key) ?? CORE[key];
const sectionKeys = () => Object.keys(CORE).concat([...registry.keys()].filter((k) => !Object.hasOwn(CORE, k)));

// A system registers its own persistence. Core sections keep their schema
// defaults/validator unless overridden; a brand-new key must supply both.
export function registerSection(key, spec = {}) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/i.test(key)) throw new Error(`invalid section key: ${String(key)}`);
  const base = CORE[key];
  if (!base && (typeof spec.defaults !== 'function' || typeof spec.validate !== 'function')) {
    throw new Error(`section "${key}" must provide defaults() and validate()`);
  }
  registry.set(key, { ...(registry.get(key) ?? base ?? {}), ...spec });
  return true;
}

// The v1 mirror, derived from the sections (never read back as authority).
const MIRROR_KEYS = ['v', 'money', 'mission', 'ending', 'checkpoint', 'wanted', 'owned'];
function mirrorOf(d) {
  return { v: 1, money: d.wallet.money, mission: d.missions.progress, ending: d.missions.ending,
    checkpoint: d.player.checkpoint, wanted: d.player.wanted, owned: d.garage.owned, inventory: d.inventory };
}
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
  }
  return false;
}
// Writers may hand back a save whose mirror is stale (one section was patched);
// the mirror is output-only, so it is stripped before validation and re-derived.
function withoutMirror(raw) {
  if (!isObj(raw) || raw.version === undefined) return raw;
  const copy = { ...raw };
  for (const k of MIRROR_KEYS) delete copy[k];
  return copy;
}

// Returns { data } for a valid v2 save, or { error } explaining the rejection.
// Absent sections fall back to their defaults; present sections must validate.
export function validate(raw) {
  if (!isObj(raw)) return { error: 'not an object' };
  if (raw.version !== SAVE_VERSION) return { error: `unsupported version ${JSON.stringify(raw.version)}` };
  const data = { version: SAVE_VERSION };
  for (const key of sectionKeys()) {
    const spec = specOf(key);
    if (raw[key] === undefined) { data[key] = spec.defaults(); continue; }
    const err = spec.validate(raw[key]);
    if (err) return { error: `${key}: ${err}` };
    data[key] = spec.clean ? spec.clean(raw[key]) : raw[key];
  }
  const mirror = mirrorOf(data);
  const present = MIRROR_KEYS.filter((k) => raw[k] !== undefined);
  if (present.length) {
    if (present.length !== MIRROR_KEYS.length) return { error: 'incomplete legacy mirror' };
    for (const k of MIRROR_KEYS) {
      if (!sameJson(raw[k], mirror[k])) return { error: `mirror ${k} does not match the sections` };
    }
  }
  Object.assign(data, mirror);
  return { data };
}

// A PASS 5 / v1 save becomes v2 with sensible defaults for the new sections.
// Unknown versions (past or future) are refused, not crashed.
export function migrate(old) {
  if (!isObj(old)) return { error: 'not an object' };
  if (old.version !== undefined) return validate(old);
  if (old.v !== 1) return { error: `unsupported version ${JSON.stringify(old.v)}` };
  if (!isInt(old.money, 0, 10_000_000)) return { error: 'money' };
  if (!isInt(old.mission, 0, MISSION_COUNT)) return { error: 'mission' };
  if (old.ending !== null && old.ending !== 'press' && old.ending !== 'deal') return { error: 'ending' };
  if (old.ending && old.mission < MISSION_COUNT) return { error: 'ending before the last mission' };
  const b = CITY.bounds, c = old.checkpoint;
  if (!isObj(c) || !isNum(c.x, b.x0, b.x1) || !isNum(c.z, b.z0, b.z1) || !isNum(c.yaw, -10, 10)) return { error: 'checkpoint' };
  if (!isNum(old.wanted, 0, 100)) return { error: 'wanted' };
  if (!ownedValid(old.owned)) return { error: 'owned vehicle' };
  const inv = old.inventory === undefined ? [] : old.inventory;
  if (!inventoryValid(inv)) return { error: 'inventory' };
  const o = old.owned;
  const fromV1 = {
    player: { checkpoint: { x: c.x, z: c.z, yaw: c.yaw }, wanted: old.wanted },
    wallet: { money: old.money },
    inventory: inv.map((s) => ({ id: s.id, count: s.count })),
    garage: { owned: o && { type: o.type, paint: o.paint.toLowerCase() } },
    missions: { progress: old.mission, ending: old.ending },
  };
  const data = { version: SAVE_VERSION };
  for (const key of sectionKeys()) data[key] = key in fromV1 ? fromV1[key] : specOf(key).defaults();
  Object.assign(data, mirrorOf(data));
  return { data };
}

// v1 in, v2 out; anything else goes straight to the v2 validator.
function parseAny(raw) {
  if (isObj(raw) && raw.version === undefined && raw.v === 1) return migrate(raw);
  return validate(raw);
}
export const validateSave = parseAny;

// Gather a fresh v2 save from every registered system (overrides win).
export function collectSave(overrides = {}) {
  const data = { version: SAVE_VERSION };
  for (const key of sectionKeys()) {
    const spec = specOf(key);
    data[key] = Object.hasOwn(overrides, key) ? overrides[key] : (spec.serialize ? spec.serialize() : spec.defaults());
  }
  return data;
}

// Hand every section back to the system that registered it.
export function restoreSections(data) {
  if (!isObj(data)) return;
  for (const key of sectionKeys()) {
    const spec = specOf(key);
    if (spec.restore && data[key] !== undefined) spec.restore(data[key]);
  }
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// { data } | { error } | { none: true } for the backup slot.
export function readBackup() {
  const s = storage();
  if (!s) return { none: true };
  let text;
  try { text = s.getItem(BACKUP_KEY); } catch { return { none: true }; }
  if (text === null) return { none: true };
  let raw;
  try { raw = JSON.parse(text); } catch { return { error: 'unreadable JSON' }; }
  return parseAny(raw);
}

function withBackup(result) {
  const b = readBackup();
  return b.data ? { ...result, backup: b.data } : result;
}

// { data } | { error, backup? } | { none: true }. A rejected load keeps the
// previous good save in the backup slot and reports it for recovery.
export function readSave() {
  const s = storage();
  if (!s) return { none: true };
  let text;
  try { text = s.getItem(SAVE_KEY); } catch { return { none: true }; }
  if (text === null) return { none: true };
  let raw;
  try { raw = JSON.parse(text); } catch { return withBackup({ error: 'unreadable JSON' }); }
  const checked = parseAny(raw);
  return checked.error ? withBackup(checked) : checked;
}

export function writeSave(input) {
  const checked = parseAny(withoutMirror(input));
  if (checked.error) return { error: checked.error };
  const s = storage();
  if (!s) return { error: 'no storage' };
  const text = JSON.stringify(checked.data);
  try {
    const prev = s.getItem(SAVE_KEY);
    if (prev !== null && prev !== text) {
      let prevRaw = null;
      try { prevRaw = JSON.parse(prev); } catch { /* damaged main: keep the older backup */ }
      if (prevRaw !== null && !parseAny(prevRaw).error) s.setItem(BACKUP_KEY, prev);
    }
    s.setItem(SAVE_KEY, text);
  } catch (e) { return { error: String(e?.message ?? e) }; }
  return { ok: true, data: checked.data };
}

// Replace one section of the current save (or a fresh one) and write it back.
export function patchSection(key, value) {
  const current = readSave();
  const base = current.data ?? collectSave();
  return writeSave({ ...base, [key]: value });
}

export function clearSave() {
  try {
    const s = storage();
    s?.removeItem(SAVE_KEY);
    s?.removeItem(BACKUP_KEY);
  } catch { /* storage unavailable */ }
}
