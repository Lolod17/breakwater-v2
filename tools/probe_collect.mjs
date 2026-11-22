// PASS 15 probe: collectibles, achievements and radio state (logic only, no browser).
//   node tools/probe_collect.mjs
// 1. collectibles: >= 20 spots, all on walkable pavement / jetty; collect(id) twice counts once
//    (one collectible:found, one reward); progress() matches; unknown ids do nothing.
// 2. achievements: >= 10; unlocked() grows only from emitted game events (money, missions,
//    side jobs, collectibles, factions, wanted); repeats unlock nothing.
// 3. radio: >= 4 named stations with tracks; next()/prev() cycle every station and wrap;
//    current() reports it; the radio is on only between vehicle:entered and vehicle:exited.
// 4. save path: the save written to storage, reset, then reloaded gives identical
//    collectibles / achievements sections and identical progress() / unlocked().
// Prints one JSON line; exit 1 on any failure.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on, emit } = await import('../game/src/core/events.js');
  const save = await import('../game/src/save.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const C = await import('../game/src/econ/collectibles.js');
  const A = await import('../game/src/core/achievements.js');
  const { Radio, STATIONS } = await import('../game/src/audio/radio.js');
  const { buildLayout } = await import('../game/src/world/layout.js');

  // ---- 1. collectibles
  const tags = C.list();
  assert.ok(tags.length >= 20, `>= 20 collectibles (got ${tags.length})`);
  const layout = buildLayout();
  for (const t of tags) assert.ok(layout.walkable(t.x, t.z), `${t.id} on a walkable spot`);
  const found = [];
  on('collectible:found', (p) => found.push(p));
  const money0 = wallet.balance();
  const id = tags[5].id;
  const first = C.collect(id), second = C.collect(id);
  assert.ok(first && first.id === id, 'first collect succeeds');
  assert.equal(second, null, 'second collect of the same id returns null');
  assert.equal(found.length, 1, 'collectible:found emitted once');
  assert.equal(wallet.balance(), money0 + C.REWARD, 'reward paid once');
  assert.equal(C.collect('tag-nope'), null, 'unknown id ignored');
  let pr = C.progress();
  assert.equal(pr.found, 1); assert.equal(pr.total, tags.length); assert.deepEqual(pr.ids, [id]);
  C.collectAt(tags[0].x, tags[0].z);   // walking through one also counts
  C.collect(tags[0].id);               // ...and collecting it again by id does not
  assert.equal(C.progress().found, 2, 'collectAt and collect share the once-only rule');

  // ---- 2. achievements (only from emitted events)
  assert.ok(A.list().length >= 10, `>= 10 achievements (got ${A.list().length})`);
  const unlockedEv = [];
  on('achievement:unlocked', (p) => unlockedEv.push(p.id));
  // the collectible pickups above already fired finders-keepers through the real event
  assert.deepEqual(A.unlocked().map((a) => a.id), ['finders-keepers'], 'collectible event unlocked finders-keepers');
  const events = [
    ['side:completed', { activity: 'taxi' }],
    ['mission:passed', { id: 'pickup' }],
    ['wanted:changed', { level: 3, from: 2, cause: 'shot' }],
    ['faction:changed', { faction: 'dockers', rep: 30, delta: 10, standing: 'friendly', previous: 'neutral' }],
  ];
  for (const [e, p] of events) emit(e, p);
  wallet.earn(1000, 'probe');   // money:changed from the real wallet
  const want = ['finders-keepers', 'first-fare', 'on-the-books', 'most-wanted', 'good-standing', 'first-grand'];
  assert.deepEqual(A.unlocked().map((a) => a.id), want, `unlocked from events (got ${A.unlocked().map((a) => a.id)})`);
  for (const [e, p] of events) emit(e, p);
  wallet.earn(1, 'probe');
  assert.equal(A.unlocked().length, want.length, 'repeated events unlock nothing new');
  assert.deepEqual(unlockedEv, want.slice(1), 'achievement:unlocked emitted once each');

  // ---- 3. radio
  assert.ok(STATIONS.length >= 4, `>= 4 stations (got ${STATIONS.length})`);
  assert.ok(STATIONS.every((s) => s.name && s.tracks.length >= 1), 'every station named with a playlist');
  const radio = new Radio({ ctx: null });   // no AudioContext in node: state only
  radio.update(true);
  assert.equal(radio.current().on, false, 'off before vehicle:entered');
  emit('vehicle:entered', { type: 'sedan' });
  radio.update(true);
  assert.equal(radio.current().on, true, 'on in a vehicle');
  const seen = [radio.current().station];
  for (let i = 0; i < STATIONS.length; i++) { radio.next(); seen.push(radio.current().station); }
  assert.deepEqual(seen, [...STATIONS.map((s) => s.name), 'RADIO OFF'], 'next() cycles every station then OFF');
  radio.next();
  assert.equal(radio.current().station, STATIONS[0].name, 'next() wraps to the first');
  radio.prev();
  assert.equal(radio.current().station, 'RADIO OFF', 'prev() goes back');
  radio.prev();
  assert.equal(radio.current().station, STATIONS.at(-1).name);
  radio.update(true);
  assert.equal(radio.current().on, true);
  emit('vehicle:exited', {});
  assert.equal(radio.current().on, false, 'off at vehicle:exited');
  radio.update(true);
  assert.equal(radio.current().on, false, 'stays off on foot even if asked');

  // ---- 4. save and reload identical
  const written = save.readSave();
  assert.ok(written.data, 'a save was written through the save path');
  const before = { c: written.data.collectibles, a: written.data.achievements, progress: C.progress(), unlocked: A.unlocked() };
  assert.deepEqual(before.c.found.slice().sort(), C.progress().ids.slice().sort(), 'save holds the found ids');
  C.reset(); A.reset();
  assert.equal(C.progress().found, 0); assert.equal(A.unlocked().length, 0);
  save.restoreSections(save.readSave().data);
  const after = save.collectSave();
  assert.deepEqual(after.collectibles, before.c, 'collectibles section identical after reload');
  assert.deepEqual(after.achievements, before.a, 'achievements section identical after reload');
  assert.deepEqual(C.progress(), before.progress, 'progress() identical after reload');
  assert.deepEqual(A.unlocked(), before.unlocked, 'unlocked() identical after reload');

  console.log(JSON.stringify({ collectibles: tags.length, found: C.progress().found, collectTwiceCountsOnce: true,
    achievements: A.list().length, unlockedFromEvents: A.unlocked().map((a) => a.id),
    stations: STATIONS.length, radioCycled: seen, saveReloadIdentical: true, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
