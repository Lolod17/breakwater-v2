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
  const Side = await import('../game/src/missions/side.js');
  const { TAXI_FARE } = Side;

  const started = [], completed = [], failed = [], money = [];
  on('side:started', (p) => started.push(p));
  on('side:completed', (p) => completed.push(p));
  on('side:failed', (p) => failed.push(p));
  on('money:changed', (p) => money.push(p));

  const start0 = wallet.balance();
  assert.equal(start0, 250, 'fresh wallet starts at $250');
  assert.deepEqual(Side.state(), { activity: null, phase: 'idle', target: null, timer: null, reward: 0 }, 'fresh side state is idle');
  Side.update(1, { x: 0, z: 0 });
  assert.equal(started.length + completed.length + failed.length, 0, 'update while idle does nothing');

  // ---- starting during a story mission is refused (guard wired to missions.phase in main.js)
  Side.setStoryGuard(() => true);
  assert.equal(Side.storyActive(), true);
  for (const kind of ['taxi', 'delivery', 'race']) {
    assert.equal(Side.start(kind), false, `${kind} must be refused while a story mission is active`);
  }
  assert.equal(new Side.Taxi().start(), false, 'a standalone activity must also refuse during a story mission');
  assert.deepEqual(Side.state(), { activity: null, phase: 'idle', target: null, timer: null, reward: 0 }, 'refused starts change nothing');
  assert.equal(started.length, 0, 'refused starts emit nothing');
  assert.equal(wallet.balance(), start0, 'refused starts pay nothing');
  assert.equal(store.get(SAVE_KEY), undefined, 'refused starts do not write the save');
  Side.setStoryGuard(() => false);

  // ---- each activity exposes start / update / cancel / state on its own
  for (const [Cls, phase] of [[Side.Taxi, 'pickup'], [Side.Delivery, 'collect'], [Side.StreetRace, 'racing']]) {
    const a = new Cls();
    assert.equal(a.start(), true, `${a.id} starts standalone`);
    assert.deepEqual(Object.keys(a.state()).sort(), ['phase', 'reward', 'target', 'timer'], `${a.id} state shape`);
    assert.equal(a.state().phase, phase);
    assert.ok(a.state().target, `${a.id} has a target while running`);
    a.update(0.1, { x: 9999, z: 9999 });
    assert.equal(a.state().phase, phase, `${a.id} holds phase far from the target`);
    assert.equal(a.cancel(), true, `${a.id} cancel reports it was running`);
    assert.equal(a.state().phase, 'idle');
    assert.equal(a.state().reward, 0);
    assert.equal(a.cancel(), false, 'cancel while idle is a no-op');
  }
  assert.equal(wallet.balance(), start0, 'cancelled activities pay nothing');

  const taxiFare = (meters, seconds) => Math.max(1, Math.round(TAXI_FARE.flag + TAXI_FARE.perMeter * meters + TAXI_FARE.perSecond * seconds));
  const driveTaxi = (dropX, dt) => {
    const pickup = { x: 0, z: 0, r: 6 }, dropoff = { x: dropX, z: 0, r: 6 };
    assert.equal(Side.start('taxi', { pickup, dropoff, limit: 600 }), true);
    assert.equal(Side.state().phase, 'pickup');
    Side.update(0.5, { x: -40, z: 0 });
    assert.equal(Side.state().phase, 'pickup', 'approaching the pickup does not board early');
    assert.equal(Side.state().timer, 599.5);
    Side.update(0.5, { x: 0, z: 0 });
    assert.equal(Side.state().phase, 'dropoff', 'reaching the pickup boards the passenger');
    assert.deepEqual(Side.state().target, dropoff);
    let meters = 0, seconds = 0, prev = { x: 0, z: 0 }, mid = null;
    for (let x = 8; x <= dropX; x += 8) {
      const p = { x, z: 0 };
      meters += Math.hypot(p.x - prev.x, p.z - prev.z);
      seconds += dt;
      prev = p;
      Side.update(dt, p);
      if (x === 80) mid = Side.state().reward;
    }
    return { meters, seconds, mid, fare: taxiFare(meters, seconds) };
  };

  // ---- taxi: completion pays the metered fare (distance + time)
  let before = wallet.balance();
  const a = driveTaxi(240, 0.5);
  assert.equal(a.mid, taxiFare(80, 5), 'the fare estimate runs while driving');
  let s = Side.state();
  assert.equal(s.phase, 'done');
  assert.equal(s.reward, a.fare);
  assert.equal(s.target, null);
  assert.equal(wallet.balance() - before, a.fare, 'taxi completion pays exactly the metered fare');
  assert.equal(completed.at(-1).reward, a.fare);
  assert.equal(completed.at(-1).activity, 'taxi');
  assert.equal(completed.at(-1).balance, wallet.balance());
  assert.equal(completed.at(-1).meters, 240);
  assert.equal(completed.at(-1).seconds, 15);
  const fareShort = a.fare;
  Side.update(5, { x: 240, z: 0 });
  assert.equal(wallet.balance() - before, fareShort, 'updates after completion pay nothing more');

  // ---- a longer trip pays more (distance), a slower trip pays more (time)
  before = wallet.balance();
  const b = driveTaxi(480, 0.5);
  assert.equal(wallet.balance() - before, b.fare);
  assert.ok(b.fare > fareShort, 'a longer trip pays a higher fare');
  before = wallet.balance();
  const c = driveTaxi(240, 1);
  assert.equal(wallet.balance() - before, c.fare);
  assert.ok(c.fare > fareShort, 'a slower trip pays a higher fare (time component)');

  // ---- taxi: timeout fails and pays nothing (before and after pickup)
  before = wallet.balance();
  assert.equal(Side.start('taxi', { pickup: { x: 0, z: 0, r: 6 }, dropoff: { x: 240, z: 0, r: 6 }, limit: 5 }), true);
  Side.update(6, { x: 500, z: 500 });
  s = Side.state();
  assert.equal(s.phase, 'failed');
  assert.equal(s.reward, 0);
  assert.equal(wallet.balance(), before, 'taxi timeout before pickup pays nothing');
  assert.equal(failed.at(-1).reason, 'Out of time');

  before = wallet.balance();
  assert.equal(Side.start('taxi', { pickup: { x: 0, z: 0, r: 6 }, dropoff: { x: 240, z: 0, r: 6 }, limit: 10 }), true);
  Side.update(0.5, { x: 0, z: 0 });
  Side.update(20, { x: 0, z: 0 });
  assert.equal(Side.state().phase, 'failed', 'stalling with the passenger runs the clock out');
  assert.equal(wallet.balance(), before, 'taxi timeout after pickup pays nothing');

  // ---- delivery: collect, then deliver before the timer
  const collect = { x: 0, z: 0, r: 6 }, drop = { x: 120, z: 0, r: 6 };
  before = wallet.balance();
  assert.equal(Side.start('delivery', { collect, dropoff: drop, limit: 30, reward: 120 }), true);
  s = Side.state();
  assert.equal(s.phase, 'collect');
  assert.equal(s.timer, null, 'no delivery clock until the package is collected');
  assert.deepEqual(s.target, collect);
  Side.update(0.5, collect);
  s = Side.state();
  assert.equal(s.phase, 'deliver');
  assert.equal(s.timer, 30);
  assert.deepEqual(s.target, drop);
  for (let x = 10; x <= 120; x += 10) Side.update(1, { x, z: 0 });
  s = Side.state();
  assert.equal(s.phase, 'done');
  assert.equal(s.reward, 120);
  assert.equal(wallet.balance() - before, 120, 'delivery completion pays the reward');
  assert.equal(completed.at(-1).activity, 'delivery');
  assert.equal(completed.at(-1).secondsLeft, 18);

  before = wallet.balance();
  assert.equal(Side.start('delivery', { collect, dropoff: drop, limit: 30, reward: 120 }), true);
  Side.update(0.5, collect);
  Side.update(31, { x: 60, z: 0 });
  s = Side.state();
  assert.equal(s.phase, 'failed', 'delivery past the timer fails');
  assert.equal(s.reward, 0);
  assert.equal(wallet.balance(), before, 'delivery timeout pays nothing');
  assert.equal(failed.at(-1).reason, 'Out of time');

  // ---- street race: checkpoints in order, finish under the rival time
  const cps = [{ x: 0, z: 0, r: 6 }, { x: 80, z: 0, r: 6 }, { x: 80, z: 80, r: 6 }, { x: 0, z: 80, r: 6 }];
  before = wallet.balance();
  assert.equal(Side.start('race', { checkpoints: cps, rivalTime: 40, reward: 250 }), true);
  s = Side.state();
  assert.equal(s.phase, 'racing');
  assert.equal(s.timer, 40);
  Side.update(1, cps[2]);
  assert.deepEqual(Side.state().target, cps[0], 'a later checkpoint out of order does not count');
  Side.update(1, cps[3]);
  assert.deepEqual(Side.state().target, cps[0], 'the finish out of order does not count');
  for (const p of cps) Side.update(1, p);
  s = Side.state();
  assert.equal(s.phase, 'done');
  assert.equal(s.reward, 250);
  assert.equal(wallet.balance() - before, 250, 'race completion pays the reward');
  assert.equal(completed.at(-1).activity, 'race');
  assert.equal(completed.at(-1).finishTime, 6);
  assert.ok(completed.at(-1).finishTime <= completed.at(-1).rivalTime, 'finish time beats the rival');

  before = wallet.balance();
  assert.equal(Side.start('race', { checkpoints: cps, rivalTime: 40, reward: 250 }), true);
  Side.update(1, cps[0]);
  Side.update(41, cps[0]);
  s = Side.state();
  assert.equal(s.phase, 'failed', 'the rival time running out fails the race');
  assert.equal(s.reward, 0);
  assert.equal(wallet.balance(), before, 'race timeout pays nothing');
  assert.equal(failed.at(-1).reason, 'The rival finished first');

  // ---- one activity at a time; cancel pays nothing and frees the slot
  before = wallet.balance();
  const saveBefore = store.get(SAVE_KEY);
  assert.equal(Side.start('taxi'), true);
  assert.equal(Side.start('delivery'), false, 'a second activity is refused while one is running');
  assert.equal(Side.start('race'), false);
  assert.equal(Side.start('bogus'), false, 'unknown kinds are refused');
  assert.equal(store.get(SAVE_KEY), saveBefore, 'refused starts do not write the save');
  assert.equal(Side.cancel(), true);
  assert.deepEqual(Side.state(), { activity: 'taxi', phase: 'idle', target: null, timer: null, reward: 0 });
  assert.equal(wallet.balance(), before, 'cancel pays nothing');
  assert.equal(Side.cancel(), false);
  assert.equal(Side.start('delivery'), true, 'the slot is free after a cancel');
  assert.equal(Side.cancel(), true);

  // ---- event and money accounting across the whole probe
  assert.equal(started.length, 14, 'one side:started per accepted start');
  assert.equal(completed.length, 5, 'one side:completed per success');
  assert.equal(failed.length, 4, 'one side:failed per timeout');
  assert.deepEqual(money.map((e) => e.reason), ['side:taxi', 'side:taxi', 'side:taxi', 'side:delivery', 'side:race'], 'only completions touch the wallet');
  assert.deepEqual(money.map((e) => e.delta), [fareShort, b.fare, c.fare, 120, 250]);
  const expectedBalance = start0 + fareShort + b.fare + c.fare + 120 + 250;
  assert.equal(wallet.balance(), expectedBalance);
  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.equal(saved.money, expectedBalance, 'side earnings persist through the existing save key');

  // ---- PASS 16: the three spots in the city and the routes a spot starts
  const { buildLayout } = await import('../game/src/world/layout.js');
  const layout = buildLayout();
  const onStreet = (p) => layout.intersections.some((i) => Math.hypot(i.x - p.x, i.z - p.z) < 1)
    || [...new Set(layout.intersections.map((i) => i.x))].some((c) => Math.abs(p.x - c) <= 6 || Math.abs(p.z - c) <= 6);
  assert.deepEqual(Side.SPOTS.map((s) => s.kind).sort(), ['delivery', 'race', 'taxi'], 'one spot per job');
  for (const sp of Side.SPOTS) {
    assert.ok(onStreet(sp) && layout.walkable(sp.x, sp.z), `${sp.label} is on a street a car can reach`);
    assert.equal(Side.spotAt(sp.x, sp.z)?.kind, sp.kind, `spotAt finds ${sp.label}`);
    assert.equal(Side.spotAt(sp.x + sp.r + 0.5, sp.z), null, `just outside ${sp.label}: nothing`);
  }
  assert.equal(Side.SPOTS.find((s) => s.kind === 'delivery').needsCar, false, 'the courier job can start on foot');
  const isNode = (p) => layout.intersections.some((i) => i.x === p.x && i.z === p.z);
  for (let n = 0; n < 6; n++) {
    const t = Side.routeFor('taxi', n), d = Side.routeFor('delivery', n), r = Side.routeFor('race', n);
    assert.deepEqual(Side.routeFor('taxi', n), t, 'routes are deterministic per job number');
    assert.ok(isNode(t.pickup) && isNode(t.dropoff) && Math.hypot(t.pickup.x - t.dropoff.x, t.pickup.z - t.dropoff.z) >= 180 && t.limit > 40, `taxi route ${n} runs between intersections`);
    assert.ok(isNode(d.dropoff) && d.reward > 90 && d.limit > 25, `delivery route ${n}`);
    assert.ok(r.checkpoints.length >= 4 && r.checkpoints.slice(0, -1).every(isNode), `race route ${n} runs over intersections`);
  }
  assert.notDeepEqual(Side.routeFor('taxi', 0), Side.routeFor('taxi', 1), 'the next job takes another route');
  const spotStarts = started.length;
  assert.equal(Side.startSpot(null), false);
  assert.equal(Side.startSpot(Side.SPOTS.find((s) => s.kind === 'delivery')), true, 'a spot starts its job');
  assert.equal(Side.state().activity, 'delivery');
  assert.equal(started.length, spotStarts + 1);
  Side.cancel();

  console.log(JSON.stringify({
    spots: Side.SPOTS.map((s) => s.label),
    taxi: { short: fareShort, long: b.fare, slow: c.fare, formula: 'flag + perMeter*meters + perSecond*seconds' },
    delivery: { reward: 120, secondsLeft: 18 },
    race: { reward: 250, finishTime: 6, rivalTime: 40 },
    timeouts: { taxi: 2, delivery: 1, race: 1, paid: 0 },
    storyRefused: true, cancelPaysNothing: true,
    events: { started: started.length, completed: completed.length, failed: failed.length, money: money.length },
    balance: wallet.balance(), savedMoney: saved.money, pass: true,
  }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
