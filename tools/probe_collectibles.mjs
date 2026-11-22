// PASS 16: econ/collectibles.js — seeded harbour tags (twenty since PASS 15). Fails if the list is empty,
// a tag is off the pavement / on a door or side spot, a pickup pays twice or not at all,
// or found tags do not survive a save round trip.
//   node tools/probe_collectibles.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on } = await import('../game/src/core/events.js');
  const { readSave, collectSave, restoreSections } = await import('../game/src/save.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const C = await import('../game/src/econ/collectibles.js');
  const { buildLayout } = await import('../game/src/world/layout.js');
  const { CITY } = await import('../game/src/config.js');
  const { doors } = await import('../game/src/world/doors.js');
  const { SPOTS } = await import('../game/src/missions/side.js');

  const tags = C.list();
  assert.equal(tags.length, C.TOTAL, `${C.TOTAL} tags placed (got ${tags.length})`);
  assert.ok(C.TOTAL >= 20, 'at least twenty tags');
  assert.equal(new Set(tags.map((t) => t.id)).size, tags.length, 'unique ids');
  const layout = buildLayout();
  for (const t of tags) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.z), `${t.id} finite`);
    assert.equal(layout.groundHeight(t.x, t.z), CITY.kerbH, `${t.id} is on raised pavement / the jetty`);
    assert.ok(layout.walkable(t.x, t.z), `${t.id} walkable`);
    for (const d of [...doors(), ...SPOTS]) assert.ok(Math.hypot(d.x - t.x, d.z - t.z) >= 4, `${t.id} clear of ${d.id ?? d.label}`);
    for (const o of tags) if (o !== t) assert.ok(Math.hypot(o.x - t.x, o.z - t.z) > 20, `${t.id} and ${o.id} are spread out`);
    assert.equal(t.found, false, `${t.id} starts unfound`);
  }
  assert.deepEqual(C.init(1337).map((t) => [t.x, t.z]), tags.map((t) => [t.x, t.z]), 'same seed, same spots');
  assert.notDeepEqual(C.init(9001).map((t) => [t.x, t.z]), tags.map((t) => [t.x, t.z]), 'another seed moves them');
  C.init(1337);

  const events = [];
  on('collectible:found', (p) => events.push(p));
  const t0 = tags[3];
  const start = wallet.balance();
  assert.equal(C.collectAt(t0.x + C.PICK_RADIUS + 0.3, t0.z), null, 'out of reach: nothing');
  assert.equal(wallet.balance(), start);
  const got = C.collectAt(t0.x + 1, t0.z);
  assert.ok(got && got.id === t0.id, 'within reach: collected');
  assert.equal(wallet.balance(), start + C.REWARD, `pays $${C.REWARD}`);
  assert.equal(C.collectAt(t0.x, t0.z), null, 'a found tag cannot be collected again');
  assert.equal(wallet.balance(), start + C.REWARD, 'and pays only once');
  assert.deepEqual(events, [{ id: t0.id, found: 1, total: C.TOTAL, reward: C.REWARD }], 'one event with the count');
  assert.equal(C.list().find((t) => t.id === t0.id).found, true);
  assert.equal(C.collectAt(NaN, 0), null);

  const saved = readSave();
  assert.ok(saved.data, 'the pickup wrote the save');
  assert.deepEqual(saved.data.collectibles, { found: [t0.id] }, 'found ids persist in the collectibles section');
  assert.equal(saved.data.wallet.money, start + C.REWARD, 'the reward persists in the wallet section');

  for (const t of tags) C.collectAt(t.x, t.z);
  assert.equal(C.foundCount(), C.TOTAL, 'all of them can be found');
  assert.equal(events.at(-1).found, C.TOTAL);
  assert.equal(wallet.balance(), start + C.TOTAL * C.REWARD);

  const snap = collectSave();
  C.reset();
  assert.equal(C.foundCount(), 0, 'new game: none found');
  restoreSections(snap);
  assert.equal(C.foundCount(), C.TOTAL, 'restore brings them back');
  restoreSections({ ...snap, collectibles: { found: ['tag-01', 'nope'] } });
  assert.deepEqual(C.list().filter((t) => t.found).map((t) => t.id), ['tag-01'], 'unknown ids in a save are ignored');

  console.log(JSON.stringify({ tags: tags.length, sample: tags.slice(0, 3).map(({ id, x, z }) => ({ id, x, z })), reward: C.REWARD, paidOnce: true, events: events.length, persisted: true, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
