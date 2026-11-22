import assert from 'node:assert/strict';
import { SAVE_KEY } from '../game/src/save.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on } = await import('../game/src/core/events.js');
  const wallet = await import('../game/src/econ/wallet.js');

  const events = [];
  on('money:changed', (p) => events.push(p));

  const start = wallet.balance();
  assert.equal(start, 250, 'fresh wallet starts at $250');

  assert.equal(wallet.earn(150, 'probe:earn'), true, 'earn must succeed');
  assert.equal(wallet.balance(), start + 150, 'earn must credit the balance');

  assert.equal(wallet.spend(40, 'probe:spend'), true, 'spend must succeed');
  const afterSpend = wallet.balance();
  assert.equal(afterSpend, start + 110, 'spend must debit the balance');

  const refused = wallet.spend(afterSpend + 1, 'probe:overdraft');
  assert.equal(refused, false, 'overdraft must return false');
  assert.equal(wallet.balance(), afterSpend, 'overdraft must change nothing');
  assert.equal(events.length, 2, 'only successful earn/spend emit money:changed');
  assert.deepEqual(events.map((e) => e.reason), ['probe:earn', 'probe:spend']);
  assert.equal(events[1].balance, afterSpend);

  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.equal(saved.money, afterSpend, 'balance must persist through the existing save key');
  assert.equal(saved.v, 1);

  const reloaded = await import('../game/src/econ/wallet.js?reload=1');
  assert.equal(reloaded.balance(), afterSpend, 'balance must be identical after reload');

  console.log(JSON.stringify({ start, earned: 150, spent: 40, overdraftRefused: refused === false, events: events.length, savedMoney: saved.money, reloadedBalance: reloaded.balance(), pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
