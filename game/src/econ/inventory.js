import { readSave, patchSection, registerSection } from '../save.js';
import { on, emit } from '../core/events.js';

const MAX_SLOTS = 12;
const DEFAULT_MAX_STACK = 99;
const MAX_STACK = { crowbar: 1, cutters: 1, toolbox: 1 };

function maxStack(id) {
  return MAX_STACK[id] ?? DEFAULT_MAX_STACK;
}

function loadSlots() {
  const save = readSave();
  return save.data ? save.data.inventory.map((s) => ({ id: s.id, count: s.count })) : [];
}

let slots = loadSlots();

function serialize() { return slots.map((s) => ({ id: s.id, count: s.count })); }
function restore(data) { slots = data.map((s) => ({ id: s.id, count: s.count })); }
registerSection('inventory', { serialize, restore });

function persist() {
  return patchSection('inventory', serialize());
}

function validId(id) {
  return typeof id === 'string' && /^[a-z0-9_-]{1,32}$/i.test(id);
}

function validCount(n) {
  return Number.isFinite(n) && n > 0 && Math.round(n) >= 1;
}

export function count(id) {
  let total = 0;
  for (const s of slots) if (s.id === id) total += s.count;
  return total;
}

export function list() {
  return slots.map((s) => ({ id: s.id, count: s.count }));
}

export function has(id, n = 1) {
  if (!validId(id) || !validCount(n)) return false;
  return count(id) >= Math.round(n);
}

function roomFor(id) {
  const stack = maxStack(id);
  let room = (MAX_SLOTS - slots.length) * stack;
  for (const s of slots) if (s.id === id) room += stack - s.count;
  return room;
}

// PASS 16: shops ask before charging, so a full bag never eats the money.
export function canAdd(id, n = 1) {
  return validId(id) && validCount(n) && Math.round(n) <= roomFor(id);
}

export function add(id, n) {
  if (!validId(id) || !validCount(n)) return false;
  const amount = Math.round(n);
  const stack = maxStack(id);
  if (amount > roomFor(id)) return false;
  let left = amount;
  for (const s of slots) {
    if (left <= 0) break;
    if (s.id !== id || s.count >= stack) continue;
    const take = Math.min(left, stack - s.count);
    s.count += take;
    left -= take;
  }
  while (left > 0) {
    const take = Math.min(left, stack);
    slots.push({ id, count: take });
    left -= take;
  }
  persist();
  emit('inventory:changed', { id, delta: amount, slots: list() });
  return true;
}

export function remove(id, n) {
  if (!validId(id) || !validCount(n)) return false;
  const amount = Math.round(n);
  if (count(id) < amount) return false;
  let left = amount;
  for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
    const s = slots[i];
    if (s.id !== id) continue;
    const take = Math.min(left, s.count);
    s.count -= take;
    left -= take;
    if (s.count === 0) slots.splice(i, 1);
  }
  persist();
  emit('inventory:changed', { id, delta: -amount, slots: list() });
  return true;
}

// New game: an empty bag (the caller clears the save).
export function reset() { slots = []; }

on('shop:bought', (p) => {
  add(p.itemId, 1);
});
