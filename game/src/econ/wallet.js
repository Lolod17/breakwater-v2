import { readSave, patchSection, registerSection } from '../save.js';
import { emit } from '../core/events.js';

const START_BALANCE = 250;
const MAX_BALANCE = 10_000_000;

function loadBalance() {
  const save = readSave();
  return save.data ? save.data.wallet.money : START_BALANCE;
}

let money = loadBalance();

function serialize() { return { money }; }
function restore(data) { money = data.money; }
registerSection('wallet', { serialize, restore });

function persist() {
  return patchSection('wallet', serialize());
}

function validAmount(amount) {
  return Number.isFinite(amount) && amount > 0;
}

// New game: back to the opening balance (no event: the HUD reads life.money).
export function reset() { money = START_BALANCE; }

export function balance() {
  return money;
}

export function earn(amount, reason) {
  if (!validAmount(amount)) return false;
  const delta = Math.min(MAX_BALANCE - money, Math.round(amount));
  if (delta <= 0) return false;
  money += delta;
  persist();
  emit('money:changed', { balance: money, delta, reason: reason ?? null });
  return true;
}

export function spend(amount, reason) {
  if (!validAmount(amount)) return false;
  const cost = Math.round(amount);
  if (cost > money) return false;
  money -= cost;
  persist();
  emit('money:changed', { balance: money, delta: -cost, reason: reason ?? null });
  return true;
}
