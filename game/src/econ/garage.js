import { readSave, patchSection, registerSection } from '../save.js';
import { emit } from '../core/events.js';
import { spend } from './wallet.js';
import { VEHICLE_TYPES } from '../vehicles/vehicleTypes.js';
import { CUSTOM_KEYS, defaultCustom, isOption, optionPrice, PAINT_PRICE } from './customs.js';

export const SLOT_CAP = 6;
export const MAX_LEVEL = 3;
export const UPGRADE_PARTS = ['engine', 'brakes', 'grip', 'suspension'];

const PAINT = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_-]{1,32}$/i;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isLevel = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_LEVEL;

function validVehicle(v) {
  if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id)) return false;
  if (typeof v.typeId !== 'string' || !Object.hasOwn(VEHICLE_TYPES, v.typeId)) return false;
  if (typeof v.colour !== 'string' || !PAINT.test(v.colour)) return false;
  if (typeof v.stored !== 'boolean') return false;
  if (!isObj(v.upgrades)) return false;
  // PASS 10c: cosmetic parts; absent in older saves (factory defaults then)
  if (v.custom !== undefined && (!isObj(v.custom) || !CUSTOM_KEYS.every((k) => v.custom[k] === undefined || isOption(k, v.custom[k])))) return false;
  return UPGRADE_PARTS.every((p) => isLevel(v.upgrades[p]));
}
const cleanCustom = (c) => { const d = defaultCustom(); for (const k of CUSTOM_KEYS) if (c && c[k] !== undefined) d[k] = c[k]; return d; };

function cleanVehicle(v) {
  return { id: v.id, typeId: v.typeId, colour: v.colour.toLowerCase(),
    upgrades: { engine: v.upgrades.engine, brakes: v.upgrades.brakes, grip: v.upgrades.grip, suspension: v.upgrades.suspension },
    stored: v.stored, custom: cleanCustom(v.custom) };
}

function defaults() { return { vehicles: [], nextId: 1, active: null }; }
function validate(v) {
  if (!isObj(v) || !Array.isArray(v.vehicles) || v.vehicles.length > 256) return 'vehicles';
  const seen = new Set();
  for (const c of v.vehicles) {
    if (!validVehicle(c) || seen.has(c.id)) return 'vehicles';
    seen.add(c.id);
  }
  if (!Number.isInteger(v.nextId) || v.nextId < 1 || v.nextId > 1e9) return 'nextId';
  if (v.active !== undefined && v.active !== null && !seen.has(v.active)) return 'active';
  return null;
}
function clean(v) { return { vehicles: v.vehicles.map(cleanVehicle), nextId: v.nextId, active: v.active ?? null }; }

let vehicles = [];
let nextId = 1;
let activeId = null;      // PASS 10c: the garage vehicle that is the player's car on the street

function serialize() { return clean({ vehicles, nextId, active: activeId }); }
function restore(data) {
  vehicles = data.vehicles.map(cleanVehicle);
  nextId = data.nextId;
  activeId = data.active ?? null;
  for (const v of vehicles) {
    const n = Number(v.id.startsWith('car_') ? v.id.slice(4) : NaN);
    if (Number.isInteger(n) && n >= nextId) nextId = n + 1;
  }
}
registerSection('garage_vehicles', { defaults, validate, clean, serialize, restore });

const saved = readSave();
if (saved.data) restore(saved.data.garage_vehicles);

function persist() {
  return patchSection('garage_vehicles', serialize());
}

function find(id) {
  return vehicles.find((v) => v.id === id) ?? null;
}

function changed(reason, v, extra) {
  emit('garage:changed', { reason, id: v.id, vehicle: cleanVehicle(v), vehicles: list(), ...extra });
}

export function list() {
  return vehicles.map(cleanVehicle);
}

export function get(id) {
  const v = find(id);
  return v ? cleanVehicle(v) : null;
}

export function storedCount() {
  return vehicles.filter((v) => v.stored).length;
}

export function buy(typeId, price, colour) {
  if (typeof typeId !== 'string' || !Object.hasOwn(VEHICLE_TYPES, typeId)) return null;
  const paint = colour ?? VEHICLE_TYPES[typeId].paints[0];
  if (typeof paint !== 'string' || !PAINT.test(paint)) return null;
  if (!spend(price, `garage:buy:${typeId}`)) return null;
  const v = { id: `car_${nextId++}`, typeId, colour: paint.toLowerCase(),
    upgrades: { engine: 0, brakes: 0, grip: 0, suspension: 0 }, stored: false };
  vehicles.push(v);
  persist();
  changed('buy', v);
  return cleanVehicle(v);
}

export function store(vehicle) {
  const id = typeof vehicle === 'string' ? vehicle : vehicle?.id;
  const v = find(id);
  if (!v || v.stored) return false;
  if (storedCount() >= SLOT_CAP) return false;
  v.stored = true;
  persist();
  changed('store', v);
  return true;
}

export function retrieve(id) {
  const v = find(id);
  if (!v || !v.stored) return null;
  v.stored = false;
  persist();
  changed('retrieve', v);
  return cleanVehicle(v);
}

const round4 = (n) => Math.round(n * 10000) / 10000;

export function handlingFor(id) {
  const v = find(id);
  if (!v) return null;
  const u = v.upgrades;
  return {
    accel: round4(1 + 0.12 * u.engine),
    topSpeed: round4(1 + 0.06 * u.engine),
    brake: round4(1 + 0.15 * u.brakes + 0.02 * u.suspension),
    grip: round4(1 + 0.1 * u.grip + 0.04 * u.suspension),
  };
}

export function upgrade(id, part, level, price) {
  const v = find(id);
  if (!v || !UPGRADE_PARTS.includes(part)) return null;
  if (!Number.isInteger(level) || level <= v.upgrades[part] || level > MAX_LEVEL) return null;
  if (!spend(price, `garage:upgrade:${id}:${part}`)) return null;
  v.upgrades[part] = level;
  persist();
  changed('upgrade', v, { part, level, handling: handlingFor(id) });
  return handlingFor(id);
}

// ---- PASS 10c: cosmetics -------------------------------------------------------

// Register a car the player already has (stolen, or won in a mission) without a
// purchase: the garage only customises cars it knows. Returns the clean record.
export function adopt(typeId, colour) {
  if (typeof typeId !== 'string' || !Object.hasOwn(VEHICLE_TYPES, typeId)) return null;
  if (typeof colour !== 'string' || !PAINT.test(colour)) return null;
  const v = { id: `car_${nextId++}`, typeId, colour: colour.toLowerCase(),
    upgrades: { engine: 0, brakes: 0, grip: 0, suspension: 0 }, stored: false, custom: defaultCustom() };
  vehicles.push(v);
  persist();
  changed('adopt', v);
  return cleanVehicle(v);
}

export function setActive(id) {
  if (id !== null && !find(id)) return false;
  activeId = id;
  persist();
  return true;
}
export function active() { return activeId; }

// Price of one cosmetic choice: 'colour' takes a paint hex, every other key an option id.
export function customPrice(key, value) {
  if (key === 'colour') return typeof value === 'string' && PAINT.test(value) ? PAINT_PRICE(value.toLowerCase()) : null;
  return isOption(key, value) ? optionPrice(key, value) : null;
}

// Install one cosmetic option, paying its catalogue price through wallet.spend
// (factory options are free). Re-installing what is fitted is refused.
export function customise(id, key, value) {
  const v = find(id);
  if (!v) return null;
  const price = customPrice(key, value);
  if (price === null) return null;
  const val = key === 'colour' ? value.toLowerCase() : value;
  if ((key === 'colour' ? v.colour : cleanCustom(v.custom)[key]) === val) return null;
  if (price > 0 && !spend(price, `garage:custom:${id}:${key}`)) return null;
  if (key === 'colour') v.colour = val;
  else v.custom = { ...cleanCustom(v.custom), [key]: val };
  persist();
  changed('custom', v, { key, value: val, price });
  return cleanVehicle(v);
}

// New game: forget every car (the save is cleared by the caller).
export function reset() {
  vehicles = [];
  nextId = 1;
  activeId = null;
}
