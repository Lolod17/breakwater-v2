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
  const { readSave } = await import('../game/src/save.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const garage = await import('../game/src/econ/garage.js');

  const events = [];
  on('garage:changed', (p) => events.push(p));
  const expectEvents = (n, why) => assert.equal(events.length, n, why);

  assert.deepEqual(garage.list(), [], 'fresh garage is empty');
  assert.equal(garage.storedCount(), 0);
  assert.equal(wallet.balance(), 250, 'fresh wallet starts at $250');
  assert.equal(wallet.earn(5000, 'probe:garage-fund'), true);

  const car = garage.buy('sedan', 400);
  assert.ok(car, 'buy must succeed with funds');
  assert.equal(car.id, 'car_1');
  assert.equal(car.typeId, 'sedan');
  assert.equal(car.colour, '#9fa6ad', 'default colour is the type palette first paint');
  assert.deepEqual(car.upgrades, { engine: 0, brakes: 0, grip: 0, suspension: 0 });
  assert.equal(car.stored, false);
  assert.equal(wallet.balance(), 4850, 'buy pays through wallet.spend');
  assert.deepEqual(garage.handlingFor(car.id), { accel: 1, topSpeed: 1, brake: 1, grip: 1 }, 'stock handling is all 1x');
  expectEvents(1, 'buy emits garage:changed');
  assert.equal(events[0].reason, 'buy');
  assert.equal(events[0].vehicle.id, 'car_1');

  const balanceAfterBuy = wallet.balance();
  assert.equal(garage.buy('tank', 10), null, 'unknown type refused');
  assert.equal(garage.buy('sedan', 0), null, 'zero price refused');
  assert.equal(garage.buy('sedan', -5), null, 'negative price refused');
  assert.equal(garage.buy('vortex', balanceAfterBuy + 1), null, 'buy above balance must return null');
  assert.equal(wallet.balance(), balanceAfterBuy, 'refused buy must not change balance');
  assert.equal(garage.list().length, 1, 'refused buy must not add a vehicle');
  expectEvents(1, 'refused buys emit nothing');

  assert.equal(garage.store(car), true, 'store accepts the vehicle object');
  assert.equal(garage.get(car.id).stored, true);
  assert.equal(garage.store(car.id), false, 'storing an already-stored vehicle is refused');
  const out = garage.retrieve(car.id);
  assert.ok(out && out.stored === false, 'retrieve returns the vehicle out of storage');
  assert.equal(garage.retrieve(car.id), null, 'retrieving an unstored vehicle is refused');
  expectEvents(3, 'store + retrieve emit, repeats do not');

  const fleet = [];
  for (let i = 0; i < garage.SLOT_CAP; i++) {
    const v = garage.buy('sedan', 10);
    assert.ok(v, 'fleet buy must succeed');
    fleet.push(v.id);
    assert.equal(garage.store(v.id), true, `store slot ${i + 1}`);
  }
  assert.equal(garage.storedCount(), garage.SLOT_CAP, 'garage is full');
  assert.equal(wallet.balance(), 4790);
  const extra = garage.buy('sedan', 10);
  assert.ok(extra, 'ownership is not limited by storage slots');
  assert.equal(garage.store(extra.id), false, 'store beyond the slot cap is refused');
  assert.equal(garage.get(extra.id).stored, false, 'refused store changes nothing');
  assert.ok(garage.retrieve(fleet[0]), 'free a slot');
  assert.equal(garage.store(extra.id), true, 'store succeeds once a slot frees up');
  assert.equal(garage.storedCount(), garage.SLOT_CAP);
  expectEvents(18, 'every successful fleet op emitted once');

  assert.deepEqual(garage.upgrade(car.id, 'engine', 2, 150), { accel: 1.24, topSpeed: 1.12, brake: 1, grip: 1 }, 'engine upgrade raises accel and top speed');
  assert.equal(wallet.balance(), 4630, 'upgrade pays through wallet.spend');
  garage.upgrade(car.id, 'brakes', 1, 100);
  garage.upgrade(car.id, 'grip', 3, 200);
  const handling = garage.upgrade(car.id, 'suspension', 2, 120);
  assert.deepEqual(handling, { accel: 1.24, topSpeed: 1.12, brake: 1.19, grip: 1.38 }, 'suspension adds brake and grip');
  assert.deepEqual(garage.handlingFor(car.id), handling, 'handlingFor reads the upgrades');
  assert.deepEqual(garage.handlingFor(fleet[0]), { accel: 1, topSpeed: 1, brake: 1, grip: 1 }, 'other vehicles unaffected');
  assert.equal(garage.handlingFor('nope'), null);
  assert.equal(wallet.balance(), 4210);
  expectEvents(22, 'four upgrades emitted');
  assert.equal(events[21].reason, 'upgrade');
  assert.equal(events[21].part, 'suspension');
  assert.equal(events[21].level, 2);
  assert.deepEqual(events[21].handling, handling);

  const beforeRefused = wallet.balance();
  assert.equal(garage.upgrade(car.id, 'turbo', 1, 10), null, 'unknown part refused');
  assert.equal(garage.upgrade(car.id, 'engine', 4, 10), null, 'level above max refused');
  assert.equal(garage.upgrade(car.id, 'engine', 1, 10), null, 'downgrade refused');
  assert.equal(garage.upgrade(car.id, 'engine', 2.5, 10), null, 'fractional level refused');
  assert.equal(garage.upgrade(car.id, 'engine', 3, beforeRefused + 1), null, 'upgrade above balance refused');
  assert.equal(garage.upgrade('nope', 'engine', 1, 10), null, 'unknown vehicle refused');
  assert.equal(wallet.balance(), beforeRefused, 'refused upgrades must not change balance');
  assert.deepEqual(garage.handlingFor(car.id), handling, 'refused upgrades must not change handling');
  expectEvents(22, 'refused upgrades emit nothing');

  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.equal(saved.version, 2, 'persists through the existing v2 save');
  assert.equal(saved.v, 1, 'v1 mirror kept');
  assert.equal(saved.money, wallet.balance());
  assert.equal(saved.garage_vehicles.vehicles.length, 8);
  assert.equal(saved.garage_vehicles.nextId, 9);

  const beforeList = garage.list();
  const beforeBalance = wallet.balance();
  const reloaded = await import('../game/src/econ/garage.js?reload=1');
  assert.deepEqual(reloaded.list(), beforeList, 'garage identical after reload');
  assert.deepEqual(reloaded.handlingFor(car.id), handling, 'handling identical after reload');
  assert.equal(reloaded.storedCount(), garage.SLOT_CAP, 'storage state identical after reload');
  const walletReload = await import('../game/src/econ/wallet.js?reload=1');
  assert.equal(walletReload.balance(), beforeBalance, 'balance identical after reload');

  const ninth = reloaded.buy('sedan', 10);
  assert.equal(ninth.id, 'car_9', 'id counter survives the reload');
  assert.equal(wallet.balance(), beforeBalance - 10);
  assert.deepEqual(readSave().data.garage_vehicles.vehicles, reloaded.list(), 'save round trips the fleet');

  console.log(JSON.stringify({ bought: beforeList.length + 1, slotCap: garage.SLOT_CAP, refusedShort: true, handling, balance: wallet.balance(), events: events.length, reloadedIdentical: true, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
