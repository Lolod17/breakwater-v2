// PASS 13 — factions and reputation probe (Node, no browser).
// Event hooks move rep (real Wanted for crimes; side/story payloads as their
// emitters send them), standing thresholds, shop price by standing, hostile
// refusal, save/reload identity, and probe_shop still exiting 0.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on, emit } = await import('../game/src/core/events.js');
  const save = await import('../game/src/save.js');
  const F = await import('../game/src/econ/factions.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const shop = await import('../game/src/econ/shop.js');
  const { Wanted } = await import('../game/src/police/wanted.js');
  const Life = await import('../game/src/world/life.js');

  const changed = [];
  on('faction:changed', (p) => changed.push(p));

  // ---- shape --------------------------------------------------------------
  assert.ok(F.FACTIONS.length >= 3, 'at least three factions');
  for (const f of F.FACTIONS) {
    assert.equal(F.rep(f), 0, `${f} starts at 0`);
    assert.equal(F.standing(f), 'neutral', `${f} starts neutral`);
    assert.ok(F.districtOf(f), `${f} owns a district`);
  }
  const DOCKS = { x: 0, z: 170 }, MID = { x: 0, z: 40 }, NORTH = { x: 0, z: -120 };
  assert.equal(F.factionAt(DOCKS.x, DOCKS.z), 'dockers');
  assert.equal(F.factionAt(MID.x, MID.z), 'midtown');
  assert.equal(F.factionAt(NORTH.x, NORTH.z), 'northside');

  // ---- change / clamp / unknown --------------------------------------------
  assert.equal(F.change('nobody', 10, 'x'), null, 'unknown faction ignored');
  assert.equal(F.change('dockers', NaN, 'x'), null, 'non-finite delta ignored');
  assert.equal(changed.length, 0, 'ignored changes emit nothing');
  assert.equal(F.change('dockers', 250, 'test'), 100, 'clamps at 100');
  assert.equal(F.change('dockers', 5, 'test'), null, 'no-op at the cap emits nothing');
  assert.equal(F.change('dockers', -500, 'test'), -100, 'clamps at -100');
  assert.equal(changed.length, 2);
  assert.deepEqual(
    { f: changed[1].faction, rep: changed[1].rep, delta: changed[1].delta, standing: changed[1].standing, previous: changed[1].previous, reason: changed[1].reason },
    { f: 'dockers', rep: -100, delta: -200, standing: 'hostile', previous: 'allied', reason: 'test' },
    'faction:changed payload');
  F.reset();
  changed.length = 0;

  // ---- standing thresholds -------------------------------------------------
  const setRep = (f, v) => { F.change(f, v - F.rep(f), 'set'); assert.equal(F.rep(f), v); };
  const table = [[-100, 'hostile'], [-26, 'hostile'], [-25, 'neutral'], [0, 'neutral'], [24, 'neutral'],
    [25, 'friendly'], [69, 'friendly'], [70, 'allied'], [100, 'allied']];
  for (const [v, s] of table) { setRep('midtown', v); assert.equal(F.standing('midtown'), s, `rep ${v} -> ${s}`); }
  F.reset();
  changed.length = 0;

  // ---- event hooks ---------------------------------------------------------
  // side activity in a district raises that district's faction
  emit('side:completed', { activity: 'taxi', reward: 40, at: { x: MID.x, z: MID.z } });
  assert.equal(F.rep('midtown'), F.SIDE_REP, 'side job in midtown raises midtown');
  emit('side:completed', { activity: 'delivery', reward: 40, at: { x: NORTH.x, z: NORTH.z } });
  assert.equal(F.rep('northside'), F.SIDE_REP, 'side job in northside raises northside');
  emit('side:completed', { activity: 'race', reward: 40, at: null });
  assert.equal(F.rep('dockers'), 0, 'side job with no location changes nothing');

  // real Wanted: crimes in the docks lower dockers per star gained
  const w = new Wanted();
  w.crime('pedestrian', DOCKS, 0);                 // 0 -> 1 star
  assert.equal(w.level, 1);
  assert.equal(F.rep('dockers'), -F.WANTED_REP, 'one star lowers the owning faction');
  w.crime('pedestrian', DOCKS, 5);                 // 19 -> 38 heat: 1 -> 2
  w.crime('pedestrian', DOCKS, 10);                // 38 -> 57: 2 -> 3
  assert.equal(w.level, 3);
  assert.equal(F.rep('dockers'), -3 * F.WANTED_REP, 'each star gained charges the faction');
  const midBefore = F.rep('midtown');
  w.force(5, MID);                                 // forced (tool/sleep) is not a crime
  assert.equal(F.rep('midtown'), midBefore, 'forced wanted does not touch rep');
  emit('wanted:changed', { level: 1, from: 2, x: MID.x, z: MID.z, cause: 'shot' });
  assert.equal(F.rep('midtown'), midBefore, 'wanted falling does not touch rep');

  // story missions: fixed grant on first pass only
  const before = F.all();
  emit('mission:passed', { id: 'cargo', index: 1, first: true, ending: null });
  assert.equal(F.rep('dockers'), before.dockers + F.STORY_REP.cargo.dockers, 'story grant (+)');
  assert.equal(F.rep('northside'), before.northside + F.STORY_REP.cargo.northside, 'story grant (-)');
  const afterCargo = F.all();
  emit('mission:passed', { id: 'cargo', index: 1, first: false, ending: null });
  assert.deepEqual(F.all(), afterCargo, 'replaying a mission grants nothing');
  emit('mission:passed', undefined);
  emit('side:completed', undefined);
  emit('wanted:changed', undefined);
  assert.deepEqual(F.all(), afterCargo, 'malformed payloads do not throw or change rep');
  const reasons = changed.map((c) => c.reason);
  assert.ok(reasons.includes('side:taxi') && reasons.includes('wanted:3') && reasons.includes('story:cargo'), 'reasons recorded');
  const hookEvents = changed.length;

  // ---- prices by standing (hardware shop trades in the dockers district) ---
  assert.equal(F.SHOP_FACTION.hardware, 'dockers');
  const base = 45;                                  // crowbar list price
  const crowbar = () => shop.items('hardware').find((i) => i.id === 'crowbar').price;
  const prices = {};
  for (const [v, s] of [[0, 'neutral'], [30, 'friendly'], [80, 'allied'], [-60, 'hostile']]) {
    setRep('dockers', v);
    assert.equal(F.standing('dockers'), s);
    prices[s] = crowbar();
  }
  assert.equal(prices.neutral, base);
  assert.ok(prices.friendly < prices.neutral, 'friendly is cheaper');
  assert.ok(prices.allied < prices.friendly, 'allied is cheaper still');
  assert.equal(prices.hostile, null, 'hostile lists no price');
  assert.equal(F.priceModifier('dockers'), null);
  assert.equal(F.priceModifier('nobody'), 1, 'unknown faction trades at list');

  // hostile refuses: no money, no stock, no event
  const bought = [];
  on('shop:bought', (p) => bought.push(p));
  const bal = wallet.balance(), stockBefore = shop.stock('hardware', 'crowbar');
  assert.equal(shop.buy('hardware', 'crowbar'), false, 'hostile shop refuses');
  assert.equal(wallet.balance(), bal, 'hostile refusal charges nothing');
  assert.equal(shop.stock('hardware', 'crowbar'), stockBefore, 'hostile refusal leaves stock untouched');
  assert.equal(bought.length, 0, 'hostile refusal emits no shop:bought');
  // other district unaffected; friendly buy charges the discounted price
  assert.equal(shop.items('clothing').find((i) => i.id === 'cap').price, 25, 'midtown shop unaffected by dockers');
  setRep('dockers', 30);
  assert.equal(shop.buy('hardware', 'crowbar'), true, 'friendly shop sells');
  assert.equal(wallet.balance(), bal - prices.friendly, 'charged the friendly price');
  assert.equal(bought[0].price, prices.friendly);

  // ---- save and reload -----------------------------------------------------
  setRep('northside', -40);
  const snapshot = F.all();
  const saved = save.readSave();
  assert.ok(saved.data, 'save is valid');
  assert.deepEqual(saved.data.factions, snapshot, 'every change is persisted');
  assert.deepEqual(save.collectSave().factions, snapshot, 'collectSave serializes the ledger');
  assert.deepEqual(Life.factionRep(), snapshot, 'life.js mirror kept in sync');
  // restore path: wipe in memory, then restoreSections from disk
  F.restore({});
  assert.deepEqual(F.all(), { dockers: 0, midtown: 0, northside: 0 });
  save.restoreSections(save.readSave().data);
  assert.deepEqual(F.all(), snapshot, 'restoreSections brings it back identical');
  // fresh module instance reading the same storage (a page reload)
  const F2 = await import('../game/src/econ/factions.js?reload=1');
  assert.deepEqual(F2.all(), snapshot, 'reloaded module reads identical rep');
  for (const f of F.FACTIONS) assert.equal(F2.standing(f), F.standing(f));
  // corrupted values are rejected by the save validator
  assert.ok(save.validate({ ...saved.data, factions: { dockers: 500 } }).error, 'out-of-range rep rejected');

  // ---- probe_shop still exits 0 -------------------------------------------
  const shopProbe = spawnSync(process.execPath, [fileURLToPath(new URL('./probe_shop.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(shopProbe.status, 0, `probe_shop exit ${shopProbe.status}: ${shopProbe.stderr.trim()}`);

  console.log(JSON.stringify({
    factions: F.FACTIONS, thresholds: F.THRESHOLDS, hookEvents, afterHooks: afterCargo,
    prices, refused: true, saved: snapshot, probeShop: 0, pass: true,
  }));
  process.exit(0);
} catch (e) {
  // AssertionError carries actual/expected; surface them so a failure is diagnosable from the JSON alone.
  const detail = e instanceof assert.AssertionError ? { actual: e.actual, expected: e.expected } : { stack: e.stack };
  console.error(JSON.stringify({ pass: false, failed: e.message, ...detail }));
  process.exit(1);
}
