import { balance, spend } from './wallet.js';
import { emit } from '../core/events.js';
import { shopModifier } from './factions.js';
import { canAdd } from './inventory.js';

const CATALOG = {
  clothing: [
    { id: 'cap', name: 'Dock Cap', price: 25, stock: 6 },
    { id: 'windbreaker', name: 'Windbreaker', price: 60, stock: 4 },
    { id: 'boots', name: 'Work Boots', price: 75, stock: 4 },
    { id: 'jacket', name: 'Denim Jacket', price: 90, stock: 3 },
  ],
  hardware: [
    { id: 'spraycan', name: 'Spray Can', price: 15, stock: 8 },
    { id: 'crowbar', name: 'Crowbar', price: 45, stock: 3 },
    { id: 'cutters', name: 'Bolt Cutters', price: 120, stock: 2 },
    { id: 'toolbox', name: 'Toolbox', price: 160, stock: 2 },
  ],
};

const remaining = new Map();
for (const [shopId, list] of Object.entries(CATALOG)) {
  for (const item of list) remaining.set(`${shopId}:${item.id}`, item.stock);
}

function find(shopId, itemId) {
  const list = CATALOG[shopId];
  if (!list) return null;
  return list.find((it) => it.id === itemId) ?? null;
}

// New game: every shelf back to its opening stock.
export function restock() {
  for (const [shopId, list] of Object.entries(CATALOG)) for (const item of list) remaining.set(`${shopId}:${item.id}`, item.stock);
}

export function shops() {
  return Object.keys(CATALOG);
}

export function items(shopId) {
  const list = CATALOG[shopId];
  if (!list) return [];
  const mod = shopModifier(shopId);
  return list.map((it) => ({ id: it.id, name: it.name, price: mod === null ? null : Math.round(it.price * mod), stock: remaining.get(`${shopId}:${it.id}`) }));
}

export function stock(shopId, itemId) {
  if (!find(shopId, itemId)) return 0;
  return remaining.get(`${shopId}:${itemId}`);
}

export function buy(shopId, itemId) {
  const item = find(shopId, itemId);
  if (!item) return false;
  const key = `${shopId}:${itemId}`;
  const left = remaining.get(key);
  if (left <= 0) return false;
  const mod = shopModifier(shopId);
  if (mod === null) return false;                 // hostile district: the shop refuses
  const price = Math.round(item.price * mod);
  if (!canAdd(itemId, 1)) return false;           // PASS 16: no room in the bag -> no sale (was: charged, item lost)
  if (!spend(price, `shop:${key}`)) return false;
  remaining.set(key, left - 1);
  emit('shop:bought', { shop: shopId, itemId, name: item.name, price, stock: left - 1, balance: balance() });
  return true;
}
