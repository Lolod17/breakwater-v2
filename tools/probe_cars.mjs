// PASS 10a2 collection probe.
// Node stage: instantiates all 21 collection cars from the catalogue on the real
// Vehicle dynamics (flat ground, fixed 1/120 s step) and measures 0-100 km/h, top
// speed (flat out until the speed stops rising) and the braking distance from
// 100 km/h; asserts the catalogue has exactly 21 civilian entries with the expected
// tiers, that no two cars share a stat row, and that every body builds at all
// three LOD levels (full > simplified > low triangles).
// Browser stage (skip with --node-only): loads the game, checks window.__game.vehicles()
// (id, model, tier, position, speed), stages the 21-car line-up, confirms every
// collection body is drawn, and saves screenshots of the line-up, a flagship
// cockpit and a simple dashboard to screenshots/.
//   node tools/probe_cars.mjs [--node-only] [--headed]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vehicle } from '../game/src/vehicles/vehicle.js';
import { VEHICLE_TYPES, COLLECTION } from '../game/src/vehicles/vehicleTypes.js';
import { CATALOGUE, FLAGSHIPS, pickType, DISTRICTS } from '../game/src/vehicles/catalogue.js';
import { buildVehicleGeometry } from '../game/src/vehicles/vehicleModels.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const DT = 1 / 120, KMH = 3.6;

function measure(id) {
  const v = new Vehicle(1, id, null);
  v.driver = { update() {} };
  v.place(0, 0, 0);
  const step = () => { v.dynamics(DT); v.x += v.vx * DT; v.z += v.vz * DT; v.yaw += v.r * DT; };
  let t = 0, t100 = null, best = 0, bestT = 0;
  v.ctrl.throttle = 1;
  while (t < 240) {
    step(); t += DT;
    if (t100 === null && v.speed * KMH >= 100) t100 = t;
    if (v.speed > best + 0.01) { best = v.speed; bestT = t; }
    if (t - bestT > 8) break;      // no gain for 8 s: at top speed
  }
  // braking: a fresh car from rest to 100 km/h, then full brakes until it stops (held
  // brake at a standstill selects reverse, so the run ends at the first stop)
  const w = new Vehicle(2, id, null);
  w.driver = v.driver;
  w.place(0, 0, 0);
  const stepW = () => { w.dynamics(DT); w.x += w.vx * DT; w.z += w.vz * DT; w.yaw += w.r * DT; };
  w.ctrl.throttle = 1;
  while (w.fwd * KMH < 100) stepW();
  w.ctrl.throttle = 0; w.ctrl.brake = 1;
  const v0 = w.fwd * KMH;
  let dist = 0, bt = 0;
  while (w.fwd > 0.6 && bt < 30) { const s = w.fwd; stepW(); dist += (s + Math.max(0, w.fwd)) / 2 * DT; bt += DT; }
  dist += Math.max(0, w.fwd) ** 2 / (2 * 9.81);   // the last crawl under 0.6 m/s (< 2 cm)
  return { zeroTo100: +t100.toFixed(2), topKmh: +(best * KMH).toFixed(1), brake100m: +dist.toFixed(2), brakeFromKmh: +v0.toFixed(1) };
}

const out = { cars: [], node: {} };
// ---- catalogue
const ids = CATALOGUE.map((e) => e.id);
const civilian = CATALOGUE.filter((e) => VEHICLE_TYPES[e.id].category !== 'police');
out.node.catalogueEntries = CATALOGUE.length;
out.node.civilianEntries = civilian.length;
check(civilian.length === 21, `catalogue has ${civilian.length} civilian entries, expected 21`);
check(new Set(ids).size === ids.length, 'duplicate catalogue ids');
check(ids.slice().sort().join() === COLLECTION.slice().sort().join(), 'catalogue ids differ from vehicleTypes COLLECTION');
const tiers = {};
for (const e of CATALOGUE) (tiers[e.tier] ||= []).push(e.id);
out.node.tiers = Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length]));
const wantTiers = { hyper: 4, super: 5, sports: 6, muscle: 3, luxury: 3 };
for (const [k, n] of Object.entries(wantTiers)) check(tiers[k]?.length === n, `tier ${k}: ${tiers[k]?.length} cars, expected ${n}`);
check(FLAGSHIPS.length === 5 && FLAGSHIPS.every((f) => VEHICLE_TYPES[f].cabin === 'full'), 'flagships must be 5 cars with cabin full');
for (const e of CATALOGUE) {
  check(typeof e.price === 'number' && e.price > 0, `${e.id}: price`);
  check(e.model && e.stats && e.body && e.audio && e.spawn, `${e.id}: catalogue fields`);
}
// ---- dynamics
for (const e of CATALOGUE) {
  const m = measure(e.id);
  out.cars.push({ id: e.id, model: e.model, tier: e.tier, price: e.price, drive: e.stats.drive, cabin: e.body.cabin, ...m });
  check(m.zeroTo100 > 1.5 && m.zeroTo100 < 12, `${e.id}: 0-100 ${m.zeroTo100}s out of range`);
  check(m.topKmh > 200, `${e.id}: top ${m.topKmh} km/h`);
}
const rows = out.cars.map((c) => `${c.zeroTo100}|${c.topKmh}|${c.brake100m}`);
const dupes = rows.filter((r, i) => rows.indexOf(r) !== i);
check(!dupes.length, `cars share a stat row: ${dupes.join(', ')}`);
out.node.uniqueStatRows = new Set(rows).size;
// stat ordering sanity: hypercars on average quicker than the luxury tier
const avg = (tier, k) => { const c = out.cars.filter((x) => x.tier === tier); return c.reduce((s, x) => s + x[k], 0) / c.length; };
out.node.tierAvg = Object.fromEntries(Object.keys(wantTiers).map((k) => [k, { zeroTo100: +avg(k, 'zeroTo100').toFixed(2), topKmh: +avg(k, 'topKmh').toFixed(1), brake100m: +avg(k, 'brake100m').toFixed(1) }]));
check(out.node.tierAvg.hyper.zeroTo100 < out.node.tierAvg.luxury.zeroTo100, 'hyper tier not quicker than luxury');
// ---- bodies at three LODs
const tri = (g) => g.attributes.position.count / 3;
for (const c of out.cars) {
  const [a, b, l] = [0, 1, 2].map((lod) => tri(buildVehicleGeometry(c.id, { lod })));
  c.tris = [a, b, l];
  check(a > b && b > l && l > 100, `${c.id}: LOD triangles not decreasing ${a}/${b}/${l}`);
}
// ---- district spawn tables
out.node.spawn = {};
const AT = { core: [0, -40], midtown: [-160, 60], waterfront: [-100, 200], industrial: [160, 120], oldmarket: [-120, -160] };
for (const d of DISTRICTS) {
  const counts = {};
  for (let i = 0; i < 4000; i++) { const id = pickType('parked', ...AT[d], (i + 0.5) / 4000); counts[id] = (counts[id] || 0) + 1; }
  const coll = Object.entries(counts).filter(([id]) => COLLECTION.includes(id)).sort((p, q) => q[1] - p[1]);
  out.node.spawn[d] = { collectionShare: +(coll.reduce((s, [, n]) => s + n, 0) / 4000).toFixed(2), top: coll.slice(0, 3).map(([id]) => id) };
}
check(out.node.spawn.core.top.some((id) => ['vortex', 'tempesta', 'nemesis', 'monarch', 'executive', 'spectre'].includes(id)), 'core district should favour exotics / saloons');
check(out.node.spawn.oldmarket.top.some((id) => ['ironclad', 'bullet', 'thunder', 'driftline'].includes(id)), 'old market should favour muscle / hatch');

// ---- browser
if (!argv.includes('--node-only')) {
  const { launch, startServer, watchPage } = await import('./cdp.mjs');
  const server = await startServer(8097);
  const page = await launch({ headless: !argv.includes('--headed'), port: 9347 });
  const watch = watchPage(page, new URL(server.url).host);
  mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
  const shot = async (file) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(join(ROOT, 'screenshots', file), Buffer.from(data, 'base64'));
    return `screenshots/${file}`;
  };
  try {
    await page.goto(`${server.url}?autostart&seed=1337`);
    await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
    const list = await page.evaluate('window.__game.vehicles()');
    const b = (out.browser = {});
    b.fleet = list.length;
    b.fleetCollection = list.filter((v) => v.tier).length;
    b.sample = list.slice(0, 3);
    check(list.every((v) => Number.isFinite(v.id) && typeof v.model === 'string' && 'tier' in v && v.position && Number.isFinite(v.position.x)
      && Number.isFinite(v.position.y) && Number.isFinite(v.position.z) && Number.isFinite(v.speed)), 'vehicles(): id/model/tier/position/speed fields');
    const st = await page.evaluate('window.__game.stage("collection")');
    const drawn = await page.evaluate(`(() => { const o = {}; for (const m of window.__scene.getObjectByName('vehicles').children)
      if (m.isInstancedMesh && m.name.startsWith('vehicle-') && m.visible && m.count) o[m.name.slice(8)] = m.count; return o; })()`);
    const bodies = new Set(Object.keys(drawn).map((k) => k.replace(/-(lod|low)$/, '')));
    b.collectionView = { calls: st.calls, triangles: st.triangles, carsDrawn: st.carsDrawn, lods: (await page.evaluate('window.__game.frame()')).carLods };
    const missing = COLLECTION.filter((id) => !bodies.has(id));
    check(!missing.length, `collection bodies not drawn: ${missing.join(', ')}`);
    b.shots = [await shot('10a2-collection.jpg')];
    await page.evaluate('window.__game.stage("collectionRear")');
    b.shots.push(await shot('10a2-collection-rear.jpg'));
    // close-ups through the driver window of a flagship and of a simple-dash car
    const cars = await page.evaluate('window.__game.vehicles()');
    for (const id of ['spectre', 'dominator', 'inferno', 'venom']) {
      const v = cars.find((c) => c.type === id);
      if (!v) { check(false, `${id} missing from staged line-up`); continue; }
      const t = VEHICLE_TYPES[id], side = t.width / 2 + 1.5;    // driver side (+x car space; fronts face -z, so world -x)
      await page.evaluate(`window.__game.view([${v.position.x - side}, ${1.55 + (id === 'inferno' ? 0.4 : 0)}, ${v.position.z - 0.9}], [${v.position.x}, ${t.height * 0.68}, ${v.position.z + 0.2}], 50)`);
      b.shots.push(await shot(`10a2-cabin-${id}.jpg`));
    }
    b.consoleErrors = watch.errors.length;
    if (watch.errors.length) b.errors = watch.errors.slice(0, 5);
    check(!watch.errors.length, 'console errors');
  } finally {
    await page.close();
    server.stop();
  }
}

out.ids = ids;
out.pass = fails.length === 0;
if (fails.length) out.fails = fails;
console.log(JSON.stringify(out, null, 1));
if (!out.pass) process.exitCode = 1;
