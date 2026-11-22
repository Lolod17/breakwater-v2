// PASS 9f save v2 probe — Node only, no browser:
//   node tools/probe_save2.mjs
// 1. a PASS 5 / v1 save migrates to schema v2 with sensible defaults;
// 2. the round trip is identical (data deep-equal and byte-stable storage text);
// 3. unknown future versions are refused, not crashed;
// 4. corrupted saves (wrong types, negative money, out-of-range values, bad JSON,
//    null, array) are rejected as a whole;
// 5. a rejected load keeps the previous good save in the backup slot, and the
//    backup can be written back as a recovery;
// 6. modules register their own serialize()/restore(): wallet, inventory, clock
//    and weather persist through collectSave()/restoreSections(), a reload of a
//    module reads the same state, and a brand-new section plugs in without any
//    edit to save.js.
// Pass: every assertion holds; one JSON line with pass: true, else exit 1.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const checks = {};
try {
  const { SAVE_KEY, BACKUP_KEY, SAVE_VERSION, migrate, validate, readSave, writeSave, readBackup,
    clearSave, collectSave, restoreSections, registerSection } = await import('../game/src/save.js');
  assert.equal(SAVE_KEY, 'breakwater.save');
  assert.equal(SAVE_VERSION, 2);

  const v1 = { v: 1, money: 550, mission: 1, ending: null, checkpoint: { x: -112.2, z: 172, yaw: Math.PI },
    wanted: 12.5, owned: { type: 'sedan', paint: '#C8102E' }, inventory: [{ id: 'spraycan', count: 3 }] };

  // 1. v1 -> v2 migration
  const m = migrate(v1);
  assert.ok(m.data && !m.error, 'v1 must migrate');
  const d = m.data;
  assert.equal(d.version, 2);
  for (const k of ['player', 'wallet', 'inventory', 'garage', 'factions', 'collectibles', 'achievements', 'missions', 'clock', 'weather']) {
    assert.ok(k in d, `schema section ${k}`);
  }
  assert.equal(d.wallet.money, 550);
  assert.equal(d.missions.progress, 1);
  assert.equal(d.missions.ending, null);
  assert.deepEqual(d.player.checkpoint, v1.checkpoint);
  assert.equal(d.player.wanted, 12.5);
  assert.deepEqual(d.garage.owned, { type: 'sedan', paint: '#c8102e' });
  assert.deepEqual(d.inventory, v1.inventory);
  assert.deepEqual(d.factions, {}, 'factions default');
  assert.deepEqual(d.collectibles, { found: [] }, 'collectibles default');
  assert.deepEqual(d.achievements, { unlocked: [] }, 'achievements default');
  assert.equal(d.clock.minutes, 19 * 60 + 20, 'clock defaults to dusk');
  assert.equal(d.weather.state, 'clear');
  assert.equal(d.weather.wetness, 0);
  // the v1 mirror stays for old readers, derived from the sections
  assert.equal(d.v, 1);
  assert.equal(d.money, 550);
  assert.equal(d.mission, 1);
  assert.deepEqual(d.checkpoint, v1.checkpoint);
  checks.migrates = true;

  // 2. round trip identical: data and bytes
  const w = writeSave(d);
  assert.ok(w.ok, 'write must succeed');
  const r = readSave();
  assert.ok(r.data && !r.error);
  assert.deepEqual(r.data, d, 'read back must equal what was written');
  assert.deepEqual(validate(d).data, d, 'validate must be idempotent');
  // the mirror is output-only: a pure v2 object without it is equally valid
  const pure = { ...d };
  for (const k of ['v', 'money', 'mission', 'ending', 'checkpoint', 'wanted', 'owned']) delete pure[k];
  assert.deepEqual(validate(pure).data, d, 'a mirror-less v2 object validates to the same data');
  const text1 = store.get(SAVE_KEY);
  assert.ok(writeSave(r.data).ok);
  assert.equal(store.get(SAVE_KEY), text1, 'a second write of the same data must be byte-identical');
  // a v1 file planted directly also loads (readSave migrates on the fly)
  store.set(SAVE_KEY, JSON.stringify(v1));
  assert.deepEqual(readSave().data, d, 'v1 in storage must load as the same v2 data');
  checks.roundTrip = true;

  // 3. unknown versions refused, not crashed
  for (const bad of [{ version: 3 }, { version: 99, wallet: { money: 1 } }, { v: 2 }, { v: 0 }, {}]) {
    const res = validate(bad);
    assert.ok(res.error && !res.data, `version refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(migrate({ version: 3 }).error, 'migrate refuses future versions');
  assert.ok(migrate({ ...v1, v: 99 }).error, 'migrate refuses unknown v1 markers');
  store.set(SAVE_KEY, JSON.stringify({ ...d, version: 3 }));
  assert.ok(readSave().error, 'a future-version file is rejected on load');
  checks.futureRefused = true;

  // 4. corrupted saves rejected as a whole
  const slot = (id, count) => ({ id, count });
  const corrupt = {
    'negative money': { ...d, wallet: { money: -5 } },
    'money as string': { ...d, wallet: { money: '1000' } },
    'money null (NaN)': { ...d, wallet: { money: null } },
    'fractional money': { ...d, wallet: { money: 1.5 } },
    'money over cap': { ...d, wallet: { money: 10_000_001 } },
    'mission out of range': { ...d, missions: { progress: 9, ending: null } },
    'ending before finale': { ...d, missions: { progress: 1, ending: 'press' } },
    'checkpoint off the map': { ...d, player: { checkpoint: { x: 1e9, z: 0, yaw: 0 }, wanted: 0 } },
    'checkpoint missing': { ...d, player: { checkpoint: null, wanted: 0 } },
    'wanted out of range': { ...d, player: { checkpoint: d.player.checkpoint, wanted: 101 } },
    'unknown vehicle': { ...d, garage: { owned: { type: 'tank', paint: '#ffffff' } } },
    'bad paint': { ...d, garage: { owned: { type: 'sedan', paint: 'red' } } },
    'inventory not an array': { ...d, inventory: {} },
    'inventory count 0': { ...d, inventory: [slot('spraycan', 0)] },
    'inventory 13 slots': { ...d, inventory: Array.from({ length: 13 }, (_, i) => slot(`item${i}`, 1)) },
    'clock out of range': { ...d, clock: { minutes: 1440 } },
    'weather unknown state': { ...d, weather: { ...d.weather, state: 'storm' } },
    'factions wrong type': { ...d, factions: { docks: 'angry' } },
    'collectibles duplicated': { ...d, collectibles: { found: ['crate', 'crate'] } },
    'mirror money tampered': { ...d, money: -50 },
    'mirror version tampered': { ...d, v: 99 },
    'mirror checkpoint tampered': { ...d, checkpoint: { x: 0, z: 0, yaw: 0 } },
    'mirror incomplete': (() => { const p = { ...d }; delete p.v; return p; })(),
    'null': null,
    'array': [1, 2, 3],
    'string': 'save',
    'number': 7,
  };
  for (const [name, bad] of Object.entries(corrupt)) {
    const res = validate(bad);
    assert.ok(res.error && !res.data, `validate rejects ${name}`);
    store.set(SAVE_KEY, JSON.stringify(bad));
    const load = readSave();
    assert.ok(load.error && !load.data, `readSave rejects ${name}`);
  }
  store.set(SAVE_KEY, '{"version":2,"wallet":');
  assert.ok(readSave().error, 'bad JSON rejected');
  assert.ok(migrate({ ...v1, money: -50 }).error, 'corrupt v1 rejected');
  store.set(SAVE_KEY, JSON.stringify({ ...v1, mission: 9 }));
  assert.ok(readSave().error, 'corrupt v1 rejected on load');
  checks.corruptRejected = true;

  // 5. backup slot: rotated on write, kept on a rejected load, usable to recover
  clearSave();
  assert.ok(readSave().none && readBackup().none);
  const good1 = validate(collectSave()).data;
  assert.ok(writeSave(good1).ok);
  const w2 = writeSave({ ...good1, wallet: { money: 900 } });   // patched section, stale mirror: re-derived on write
  assert.ok(w2.ok);
  const good2 = w2.data;
  assert.equal(good2.money, 900);
  assert.deepEqual(readBackup().data, good1, 'previous good save rotated into the backup');
  const backupText = store.get(BACKUP_KEY);
  store.set(SAVE_KEY, '{"version":2,"wallet":');            // damaged main slot
  const badLoad = readSave();
  assert.ok(badLoad.error && !badLoad.data);
  assert.deepEqual(badLoad.backup, good1, 'rejected load reports the kept backup');
  assert.equal(store.get(BACKUP_KEY), backupText, 'rejected load must not touch the backup');
  assert.deepEqual(readBackup().data, good1);
  store.set(SAVE_KEY, JSON.stringify({ ...good2, wallet: { money: -1 } }));
  assert.ok(readSave().error, 'invalid main rejected');
  assert.deepEqual(readBackup().data, good1, 'backup still kept');
  assert.ok(writeSave(readBackup().data).ok, 'backup can be written back');
  assert.deepEqual(readSave().data, good1, 'recovery restores the previous good save');
  clearSave();
  store.set(SAVE_KEY, 'null');
  const noBackup = readSave();
  assert.ok(noBackup.error && !noBackup.backup, 'corrupt with no backup: plain rejection, no crash');
  checks.backupKept = true;

  // 6. registered systems: serialize / restore / collect / patch
  clearSave();
  const wallet = await import('../game/src/econ/wallet.js');
  const inv = await import('../game/src/econ/inventory.js');
  const Time = await import('../game/src/env/time.js');
  const Weather = await import('../game/src/env/weather.js');
  assert.equal(wallet.balance(), 250, 'fresh wallet');
  assert.equal(wallet.earn(150, 'probe_save2'), true);
  assert.equal(inv.add('spraycan', 2), true);
  Time.advance(3600);                                    // 19:20 -> 22:20
  Weather.init(1337);
  Weather.set('rain');
  for (let i = 0; i < 60; i++) { Time.advance(1); Weather.update(1); }   // -> 22:23, rain dominant
  assert.equal(Weather.current(), 'rain');

  const collected = collectSave();
  assert.equal(collected.wallet.money, wallet.balance(), 'wallet serializes itself');
  assert.deepEqual(collected.inventory, inv.list(), 'inventory serializes itself');
  const clockMinutes = Time.serialize().minutes;
  assert.ok(Math.abs(clockMinutes - (1160 + 180 + 3)) < 1e-6, 'clock advanced 3h + 60s');
  assert.equal(collected.clock.minutes, clockMinutes, 'clock serializes itself');
  const weatherSection = Weather.serialize();
  assert.deepEqual(collected.weather, weatherSection, 'weather serializes itself');
  const wc = writeSave(collected);
  assert.ok(wc.ok);
  assert.deepEqual(readSave().data, wc.data, 'collected save round trips');
  const persisted = JSON.parse(store.get(SAVE_KEY));
  assert.equal(persisted.money, wallet.balance(), 'v1 mirror money stays correct');
  assert.equal(persisted.v, 1);
  assert.deepEqual(persisted.inventory, inv.list());

  // disturb every system, then hand the collected sections back
  wallet.earn(10, 'disturb');
  inv.add('cap', 1);
  Time.advance(1200);
  Weather.set('fog');
  restoreSections(wc.data);
  assert.equal(wallet.balance(), 400, 'wallet restored');
  assert.deepEqual(inv.list(), [{ id: 'spraycan', count: 2 }], 'inventory restored');
  assert.equal(Time.hour(), 22);
  assert.equal(Time.serialize().minutes, clockMinutes, 'clock restored exactly');
  assert.equal(Weather.current(), 'rain', 'weather restored');
  assert.deepEqual(Weather.serialize(), weatherSection, 'weather restore is exact (RNG stream included)');

  // a module reload reads the same state through the registry
  assert.ok(writeSave(wc.data).ok, 'persist the restored state');
  const walletReload = await import('../game/src/econ/wallet.js?reload=1');
  assert.equal(walletReload.balance(), 400, 'wallet identical after module reload');
  const invReload = await import('../game/src/econ/inventory.js?reload=1');
  assert.deepEqual(invReload.list(), inv.list(), 'inventory identical after module reload');

  // a brand-new system plugs in without editing save.js
  let probeN = 7;
  registerSection('probe_sys', {
    defaults: () => ({ n: 0 }),
    validate: (v) => (v && typeof v === 'object' && !Array.isArray(v) && Number.isInteger(v.n) && v.n >= 0 && v.n <= 1000 ? null : 'n'),
    serialize: () => ({ n: probeN }),
    restore: (dd) => { probeN = dd.n; },
  });
  const c2 = collectSave();
  assert.deepEqual(c2.probe_sys, { n: 7 }, 'new section collected');
  assert.ok(writeSave(c2).ok);
  const r2 = readSave();
  assert.deepEqual(r2.data.probe_sys, { n: 7 }, 'new section round trips');
  probeN = 99;
  restoreSections(r2.data);
  assert.equal(probeN, 7, 'new section restored');
  assert.deepEqual(migrate(v1).data.probe_sys, { n: 0 }, 'migration fills new sections with defaults');
  store.set(SAVE_KEY, text1);                            // a file written before the section existed
  assert.deepEqual(readSave().data.probe_sys, { n: 0 }, 'older files gain the default');
  assert.throws(() => registerSection('incomplete_sys', {}), 'new keys need defaults and validate');
  assert.throws(() => registerSection('bad key!', {}), 'invalid keys refused');
  checks.registry = true;

  console.log(JSON.stringify({ checks, sections: Object.keys(collectSave()).length, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message, checks }));
  process.exit(1);
}
