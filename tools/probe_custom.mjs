// PASS 10c probe: Breakwater Customs end to end in Chrome over CDP.
// Drive the hero car onto the turntable bay, press G (a real key tap through the
// fixed step), then for each of the eight categories pick one option and buy it:
// assert the drawn car changed (instance attributes, wheel mesh, bolt-on meshes,
// body height, underglow, spotlight colour) and that the wallet paid the catalogue
// price. Also: a purchase the wallet cannot cover is refused and changes nothing;
// leaving the garage keeps the look on the street; an autosave + page reload +
// Continue restores the same car with the same look and the same balance.
//   node tools/probe_custom.mjs [--headed] [--shots DIR]
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const shotsAt = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const server = await startServer(8095);
const page = await launch({ headless: !headed, port: 9345 });
const watch = watchPage(page, new URL(server.url).host);
const ev = (js) => page.evaluate(js);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 3) => ev(`new Promise((r) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })`);
const shot = async (name) => {
  if (!shotsAt) return;
  await frames(2);
  const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(shotsAt, `${name}.jpg`), Buffer.from(data, 'base64'));
};

// one option per category (rows: paint has colour + finish, lights head + glow, livery design + colour)
const PICKS = [
  { cat: 'paint', key: 'colour', id: '#5b2a86', price: 160 },
  { cat: 'paint', key: 'finish', id: 'pearl', price: 350 },
  { cat: 'wheels', key: 'wheels', id: 'dish6', price: 260 },
  { cat: 'spoiler', key: 'spoiler', id: 'gt', price: 450 },
  { cat: 'aero', key: 'aero', id: 'track', price: 520 },
  { cat: 'ride', key: 'ride', id: 'slammed', price: 180 },
  { cat: 'tint', key: 'tint', id: 'limo', price: 150 },
  { cat: 'lights', key: 'head', id: 'xenon', price: 90 },
  { cat: 'lights', key: 'glow', id: 'magenta', price: 200 },
  { cat: 'livery', key: 'livery', id: 'twin', price: 220 },
  { cat: 'livery', key: 'liveryColour', id: 'gold', price: 60 },
];

// how each pick must show up in what the renderer drew (b: before, a: after)
const CHANGED = {
  colour: (b, a) => a.body.iPaint.join() !== b.body.iPaint.join() && Math.abs(a.body.iPaint[0] - 0.098) < 0.02,   // #5b2a86 in linear
  finish: (b, a) => b.body.iCustom[0] === 0 && a.body.iCustom[0] === 3,
  wheels: (b, a) => a.wheels.dish6 >= b.wheels.dish6 + 4 && a.wheels.twin5 <= b.wheels.twin5 - 4,
  spoiler: (b, a) => !b.parts.spoilerGT && a.parts.spoilerGT >= 1,
  aero: (b, a) => !b.parts.splitterTrack && a.parts.splitterTrack >= 1 && a.parts.skirts >= 1 && a.parts.diffuserFins >= 1,
  ride: (b, a) => Math.abs(b.body.y) < 1e-3 && Math.abs(a.body.y + 0.08) < 1e-3,
  tint: (b, a) => b.body.iCustom[1] === 0 && a.body.iCustom[1] === 4,
  head: (b, a) => b.body.iCustom[2] === 0 && a.body.iCustom[2] === 1,
  glow: (b, a) => !b.glow && a.glow >= 1,
  livery: (b, a) => b.body.iCustom[3] === 0 && a.body.iCustom[3] === 1,
  liveryColour: (b, a) => a.body.iLivery.join() !== b.body.iLivery.join() && a.body.iLivery[0] > 0.5 && a.body.iLivery[2] < 0.1,
};

const out = { steps: {}, checks: {} };
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => ev('!!(window.__game && window.__game.ready)'), 60000);
  await ev('window.__game.newGame()');
  const site = await ev('window.__game.customs.site()');
  // the hero car, stopped on the turntable bay
  await ev(`window.__game.driveTest({ throttle: 0, brake: 0, handbrake: true }, 0.4, { x: ${site.x}, z: ${site.z}, yaw: ${site.bayYaw} })`);
  await frames(4);
  const heroId = await ev('window.__game.vehicleIdOfPlayer()');
  const prompt = await ev(`!document.getElementById('customs-prompt').hidden`);
  assert.ok(prompt, 'the G prompt shows on the bay');
  await ev(`window.__game.tap('KeyG')`);
  await frames(4);
  let st = await ev('window.__game.customs.state()');
  assert.ok(st.open, 'G on the bay opens the garage menu');
  assert.ok(await ev(`!document.getElementById('customs').hidden`), 'menu panel visible');
  out.checks.openedByKey = true;
  await shot('custom-0-stock');

  // a purchase the wallet cannot cover: $250 start, the track kit costs $520
  const poor = await ev('window.__game.wallet().balance');
  assert.equal(poor, 250);
  await ev(`window.__game.customs.select('aero', 'track')`);
  assert.equal(await ev('window.__game.customs.buy()'), null, 'unaffordable purchase refused');
  assert.equal(await ev('window.__game.wallet().balance'), 250, 'refused purchase charges nothing');
  assert.equal((await ev('window.__game.customs.garage()')).list.find((v) => v.id === st.record.id).custom.aero, 'stock', 'refused purchase fits nothing');
  out.checks.refusedWhenShort = true;

  // fund the run (gameplay balance; the menu reconciles it into the wallet)
  await ev('window.__game.customs.leave()');
  await ev('window.__game.grant(20000)');
  await frames(3);
  await ev(`window.__game.customs.enter()`);
  st = await ev('window.__game.customs.state()');
  assert.ok(st.open);
  const funded = await ev('window.__game.wallet().balance');
  assert.equal(funded, 20250, 'wallet synced to the gameplay balance on entry');

  const results = [];
  for (const p of PICKS) {
    // baseline with the current row showing what is fitted
    await ev(`window.__game.customs.select('${p.key}', ${JSON.stringify(st.rows.find((r) => r.key === p.key).installed)})`);
    await frames(2);
    const before = await ev(`window.__game.carDraw(${heroId})`);
    const bal0 = await ev('window.__game.wallet().balance');
    await ev(`window.__game.customs.select('${p.key}', ${JSON.stringify(p.id)})`);
    await frames(2);
    const preview = await ev(`window.__game.carDraw(${heroId})`);
    const rec = await ev('window.__game.customs.buy()');
    await frames(2);
    const after = await ev(`window.__game.carDraw(${heroId})`);
    const bal1 = await ev('window.__game.wallet().balance');
    const money = await ev('window.__game.money()');
    assert.ok(rec, `${p.key}=${p.id} bought`);
    assert.equal(bal0 - bal1, p.price, `${p.key}: wallet charged the catalogue price`);
    assert.equal(money, bal1, `${p.key}: gameplay balance follows the wallet`);
    assert.equal(p.key === 'colour' ? rec.colour : rec.custom[p.key], p.id, `${p.key}: stored on the garage vehicle`);
    assert.ok(CHANGED[p.key](before, preview), `${p.key}: preview changed the drawn car ${JSON.stringify({ before, preview })}`);
    assert.ok(CHANGED[p.key](before, after), `${p.key}: purchase changed the drawn car ${JSON.stringify({ before, after })}`);
    results.push({ cat: p.cat, key: p.key, id: p.id, paid: bal0 - bal1 });
    st = await ev('window.__game.customs.state()');
  }
  out.steps.bought = results;
  out.checks.everyCategoryChangedTheCar = true;
  out.checks.walletCharged = true;
  const cats = new Set(results.map((r) => r.cat));
  assert.equal(cats.size, 8, 'all eight categories exercised');
  const spent = results.reduce((a, r) => a + r.paid, 0);
  assert.equal(await ev('window.__game.wallet().balance'), funded - spent);
  await shot('custom-1-fitted');
  const fm = await ev('window.__game.frame()');
  out.steps.menuFrame = { calls: fm.calls, triangles: fm.triangles };

  // moving off a row drops the preview, keeps the fitted part
  await ev(`window.__game.customs.select('spoiler', 'lip')`);
  await ev(`window.__game.customs.select('tint', 'limo')`);
  await frames(2);
  const kept = await ev(`window.__game.carDraw(${heroId})`);
  assert.ok(kept.parts.spoilerGT >= 1 && !kept.parts.spoilerLip, 'unbought preview reverted');

  // back to the street: same look
  const lookIn = await ev(`window.__game.look(${heroId})`);
  await ev('window.__game.customs.leave()');
  await frames(6);
  const street = await ev(`window.__game.look(${heroId})`);
  assert.deepEqual(street.look, lookIn.look, 'the street car wears what the menu showed');
  assert.equal(street.paint, '#5b2a86');
  assert.ok(street.owned, 'the customised car is the owned car');
  const streetDraw = await ev(`window.__game.carDraw(${heroId})`);
  assert.ok(CHANGED.spoiler({ parts: {} }, streetDraw) && CHANGED.glow({}, streetDraw) && streetDraw.body.iCustom.join() === '3,4,1,1', 'drawn on the street with parts');
  assert.notEqual(streetDraw.spot, streetDraw.spotBase, 'xenon headlights tint the car spotlight on the street');
  out.checks.streetMatchesMenu = true;
  await ev(`window.__game.view([${site.x - 7}, 2.2, ${site.z - 6}], [${site.x - 1.5}, 0.6, ${site.bayZ}], 50)`);
  await shot('custom-2-street');
  const fs = await ev('window.__game.frame()');
  out.steps.streetFrame = { calls: fs.calls, triangles: fs.triangles };
  assert.ok(fm.calls < 500 && fs.calls < 500, 'draw calls in budget with a fully customised car');

  // autosave (leaving the garage saved), then reload the page and Continue
  const saved = await ev('window.__game.readSave()');
  const gv = saved.data.garage_vehicles;
  const savedCar = gv.vehicles.find((v) => v.id === gv.active);
  assert.ok(savedCar, 'save links the street car to its garage record');
  for (const p of PICKS) assert.equal(p.key === 'colour' ? savedCar.colour : savedCar.custom[p.key], p.id, `save holds ${p.key}`);
  assert.equal(saved.data.garage.owned.type, street.type);
  assert.equal(saved.data.garage.owned.paint, '#5b2a86');
  const balBefore = await ev('window.__game.wallet().balance');
  assert.equal(saved.data.wallet.money, balBefore, 'save holds the charged balance');

  await page.goto(`${server.url}?seed=1337`);
  await page.waitFor(() => ev('!!(window.__game && window.__game.ready)'), 60000);
  const cont = await ev('window.__game.continueGame()');
  assert.ok(cont.ok, 'continue loads the save');
  await frames(3);
  const cars = await ev('window.__game.vehicles()');
  const owned = await ev(`window.__game.vehicles().map((v) => window.__game.look(v.id)).find((l) => l && l.owned)`);
  assert.ok(owned, 'owned car restored');
  assert.equal(owned.type, street.type);
  assert.equal(owned.paint, '#5b2a86', 'paint survives reload');
  assert.deepEqual(owned.look, street.look, 'look survives reload');
  const pos = cars.find((c) => c.id === owned.id);
  await ev(`window.__game.view([${pos.x + 6}, 2.4, ${pos.z - 6}], [${pos.x}, 0.6, ${pos.z}], 50)`);
  const reDraw = await ev(`window.__game.carDraw(${owned.id})`);
  assert.ok(reDraw.body, 'restored car drawn');
  assert.equal(reDraw.body.iCustom.join(), streetDraw.body.iCustom.join(), 'same shader look after reload');
  assert.equal(reDraw.body.iLivery.join(), streetDraw.body.iLivery.join());
  assert.equal(reDraw.body.iPaint.join(), streetDraw.body.iPaint.join());
  assert.ok(Math.abs(reDraw.body.y + 0.08) < 1e-3, 'ride height after reload');
  assert.ok(reDraw.parts.spoilerGT >= 1 && reDraw.parts.splitterTrack >= 1 && reDraw.parts.skirts >= 1 && reDraw.parts.diffuserFins >= 1 && reDraw.glow >= 1, 'bolt-ons after reload');
  assert.ok(reDraw.wheels.dish6 >= 4, 'wheels after reload');
  assert.equal(await ev('window.__game.wallet().balance'), balBefore, 'wallet balance after reload');
  assert.equal(await ev('window.__game.money()'), balBefore, 'gameplay balance after reload');
  out.checks.saveReloadKeepsIt = true;
  await shot('custom-3-reloaded');

  out.consoleErrors = watch.errors.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
  assert.equal(watch.errors.length, 0, 'no console errors');
  out.steps.final = { balance: balBefore, spent, look: owned.look };
  out.pass = true;
} catch (e) {
  out.pass = false;
  out.failed = String(e.message || e).slice(0, 1500);
  out.consoleErrors = watch.errors.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
process.exit(out.pass ? 0 : 1);
