// PASS 16: core/achievements.js — every achievement unlocks from its real game event,
// once, persists in the save's achievements section, and ignores look-alike events.
// Fails if the list is empty or any achievement cannot be unlocked by its event.
//   node tools/probe_achievements.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const { on, emit } = await import('../game/src/core/events.js');
  const { readSave, collectSave, restoreSections } = await import('../game/src/save.js');
  const A = await import('../game/src/core/achievements.js');

  const all = A.list();
  assert.ok(all.length >= 10, `at least 10 achievements (got ${all.length})`);
  assert.ok(all.every((a) => !a.unlocked && a.title && a.text), 'all locked at start, each with a title and text');

  const got = [];
  on('achievement:unlocked', (p) => got.push(p.id));

  // look-alikes that must NOT unlock anything
  emit('wanted:changed', { level: 5, from: 0, cause: 'forced' });           // a tool / sleep force is not a crime
  emit('wanted:changed', { level: 2, from: 1, cause: 'shot' });            // two stars is not three
  emit('mission:passed', undefined);                                        // malformed payloads do not throw
  emit('garage:changed', { reason: 'buy' });
  emit('collectible:found', { found: 3, total: 12 });
  assert.deepEqual(got, ['finders-keepers'], `only the real matches unlocked (got ${got})`);

  // every remaining achievement from the event the game emits for it
  const fire = [
    ['side:completed', { activity: 'taxi' }], ['side:completed', { activity: 'delivery' }], ['side:completed', { activity: 'race' }],
    ['mission:passed', { id: 'finale', ending: 'deal', first: true }], ['collectible:found', { found: 12, total: 12 }],
    ['shop:bought', { shop: 'clothing', itemId: 'cap' }], ['garage:changed', { reason: 'custom' }],
    ['wanted:changed', { level: 3, from: 2, cause: 'shot' }], ['interior:slept', {}],
    ['money:changed', { balance: 12000, delta: 500, reason: 'test' }],
    ['faction:changed', { faction: 'dockers', rep: 30, delta: 10, standing: 'friendly', previous: 'neutral' }],
    ['faction:changed', { faction: 'midtown', rep: -30, delta: -10, standing: 'hostile', previous: 'neutral' }],
  ];
  for (const [e, p] of fire) emit(e, p);
  assert.deepEqual(new Set(got), new Set(all.map((a) => a.id)), 'every achievement is reachable from its event');
  assert.equal(got.length, all.length, 'each unlocked exactly once');
  for (const [e, p] of fire) emit(e, p);
  assert.equal(got.length, all.length, 'repeats unlock nothing');
  assert.equal(A.unlock('not-a-thing'), false);

  const saved = readSave();
  assert.ok(saved.data, 'unlocks wrote the save');
  assert.deepEqual(new Set(saved.data.achievements.unlocked), new Set(all.map((a) => a.id)), 'unlocks persist');
  const snap = collectSave();
  A.reset();
  assert.equal(A.count(), 0, 'new game: none unlocked');
  restoreSections(snap);
  assert.equal(A.count(), all.length, 'restore brings them back');

  console.log(JSON.stringify({ achievements: all.length, unlockedByEvents: got.length, lookAlikesIgnored: true, persisted: true, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
