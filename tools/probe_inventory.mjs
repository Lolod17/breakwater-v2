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
  const shop = await import('../game/src/econ/shop.js');
  const inv = await import('../game/src/econ/inventory.js');

  const events = [];
  on('inventory:changed', (p) => events.push(p));

  assert.deepEqual(inv.list(), [], 'fresh inventory is empty');

  assert.equal(inv.add('spraycan', 5), true, 'add must succeed');
  assert.equal(inv.add('spraycan', 7), true, 'second add must succeed');
  assert.deepEqual(inv.list(), [{ id: 'spraycan', count: 12 }], 'same id stacks into one slot');
  assert.equal(inv.has('spraycan', 12), true);
  assert.equal(inv.has('spraycan', 13), false);
  assert.equal(inv.has('spraycan'), true, 'has defaults to 1');
  assert.equal(inv.has('ghost'), false);

  assert.equal(inv.add('spraycan', 90), true, 'stack overflow must spill into a new slot');
  assert.deepEqual(inv.list(), [{ id: 'spraycan', count: 99 }, { id: 'spraycan', count: 3 }], 'max stack per item is 99');
  assert.equal(inv.add('crowbar', 2), true, 'unstackable items take one slot each');
  assert.deepEqual(inv.list().slice(2), [{ id: 'crowbar', count: 1 }, { id: 'crowbar', count: 1 }], 'crowbar max stack is 1');

  assert.equal(inv.remove('spraycan', 4), true, 'remove must succeed');
  assert.deepEqual(inv.list(), [{ id: 'spraycan', count: 98 }, { id: 'crowbar', count: 1 }, { id: 'crowbar', count: 1 }], 'remove empties the last slot first');
  assert.equal(inv.has('spraycan', 98), true);
  assert.equal(inv.has('spraycan', 99), false);

  const beforeRefuse = JSON.stringify(inv.list());
  const saveBeforeRefuse = store.get(SAVE_KEY);
  const eventsBeforeRefuse = events.length;
  assert.equal(inv.remove('spraycan', 99), false, 'over-remove must return false');
  assert.equal(inv.remove('ghost', 1), false, 'removing an absent item must return false');
  assert.equal(inv.add('spraycan', 0), false);
  assert.equal(inv.add('spraycan', -3), false);
  assert.equal(inv.add('spraycan', NaN), false);
  assert.equal(inv.add('', 1), false);
  assert.equal(inv.remove('spraycan', 0), false);
  assert.equal(JSON.stringify(inv.list()), beforeRefuse, 'refused operations must change nothing');
  assert.equal(store.get(SAVE_KEY), saveBeforeRefuse, 'refused operations must not write the save');
  assert.equal(events.length, eventsBeforeRefuse, 'refused operations must not emit');

  const copy = inv.list();
  copy[0].count = 1;
  copy.push({ id: 'fake', count: 1 });
  assert.equal(inv.list()[0].count, 98, 'list must return a copy');
  assert.equal(inv.list().length, 3);

  for (const id of ['cap', 'windbreaker', 'boots', 'jacket', 'rope', 'plank', 'bolt', 'wire', 'tape']) {
    assert.equal(inv.add(id, 1), true, `fill slot with ${id}`);
  }
  assert.equal(inv.list().length, 12, 'max slot count is 12');
  assert.equal(inv.add('rope', 1), true, 'stacking still works when all slots are used');
  assert.equal(inv.has('rope', 2), true);
  const fullState = JSON.stringify(inv.list());
  assert.equal(inv.add('nails', 1), false, 'a 13th slot must be refused');
  assert.equal(inv.add('crowbar', 1), false, 'unstackable item with no room must be refused');
  assert.equal(JSON.stringify(inv.list()), fullState, 'refused adds at capacity must change nothing');
  // PASS 16: a full bag must refuse the sale before any money moves (was: charged $45, crowbar dropped)
  const fullBalance = wallet.balance(), crowbarStock = shop.stock('hardware', 'crowbar'), evFull = events.length;
  assert.equal(inv.canAdd('crowbar', 1), false, 'canAdd reports no room for an unstackable item');
  assert.equal(inv.canAdd('spraycan', 1), true, 'canAdd allows topping up a stack');
  assert.equal(shop.buy('hardware', 'crowbar'), false, 'shop refuses when the bag is full');
  assert.equal(wallet.balance(), fullBalance, 'a refused full-bag sale charges nothing');
  assert.equal(shop.stock('hardware', 'crowbar'), crowbarStock, 'a refused full-bag sale keeps the stock');
  assert.equal(events.length, evFull, 'a refused full-bag sale emits nothing');
  assert.equal(inv.add('spraycan', 1), true, 'topping up an existing stack fits at capacity');
  assert.equal(inv.has('spraycan', 99), true);

  assert.equal(inv.remove('rope', 2), true, 'free one slot before buying');
  assert.equal(inv.list().length, 11);

  const start = wallet.balance();
  assert.equal(start, 250, 'fresh wallet starts at $250');
  const capStock = shop.stock('clothing', 'cap');
  assert.equal(shop.buy('clothing', 'cap'), true, 'cap buy must succeed');
  assert.equal(inv.has('cap', 2), true, 'bought cap must land in the inventory');
  assert.equal(shop.stock('clothing', 'cap'), capStock - 1);
  assert.equal(wallet.balance(), start - 25);

  const cuttersStock = shop.stock('hardware', 'cutters');
  assert.equal(shop.buy('hardware', 'cutters'), true, 'cutters buy must succeed');
  assert.equal(inv.has('cutters', 1), true, 'bought cutters must take the freed slot');
  assert.equal(shop.stock('hardware', 'cutters'), cuttersStock - 1);
  assert.equal(inv.list().length, 12);
  assert.equal(wallet.balance(), start - 25 - 120);

  const midSave = JSON.parse(store.get(SAVE_KEY));
  assert.deepEqual(midSave.inventory, inv.list(), 'wallet persists must keep the inventory in the same save');
  assert.equal(midSave.money, wallet.balance(), 'inventory persists must keep the money in the same save');
  assert.equal(midSave.v, 1);

  const brokeState = JSON.stringify(inv.list());
  const brokeBalance = wallet.balance();
  assert.equal(shop.buy('hardware', 'toolbox'), false, 'buy above balance must return false');
  assert.equal(JSON.stringify(inv.list()), brokeState, 'refused buy must not change the inventory');
  assert.equal(wallet.balance(), brokeBalance);

  assert.equal(inv.remove('cap', 2), true, 'remove the bought caps');
  assert.equal(inv.has('cap'), false);
  assert.equal(inv.list().length, 11);

  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.deepEqual(saved.inventory, inv.list(), 'inventory must persist through the existing save key');
  assert.equal(saved.money, wallet.balance());

  const reloaded = await import('../game/src/econ/inventory.js?reload=1');
  assert.deepEqual(reloaded.list(), inv.list(), 'inventory must be identical after reload');
  const walletReload = await import('../game/src/econ/wallet.js?reload=1');
  assert.equal(walletReload.balance(), wallet.balance(), 'wallet must be identical after reload');

  assert.equal(events.length, 20, 'only successful add/remove emit inventory:changed');
  assert.equal(events.at(-1).id, 'cap');
  assert.equal(events.at(-1).delta, -2);

  const total = inv.list().reduce((n, s) => n + s.count, 0);
  console.log(JSON.stringify({ slots: inv.list().length, items: total, bought: [['clothing', 'cap', 25], ['hardware', 'cutters', 120]], balance: wallet.balance(), savedItems: saved.inventory.reduce((n, s) => n + s.count, 0), reloadedIdentical: true, events: events.length, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
