// PASS 11 probe: the five enterable interiors. Every room is entered through its
// street door with a real E press at the door (door:inRange radius), must load its
// own scene and put the player inside it; the exit door (walked to, then E) must put
// the player back on the street door's spot and heading with the room unloaded.
// Shops buy through shop.buy, the garage terminal lists garage.list() and opens the
// customs menu, the wardrobe equips an owned outfit, and the safehouse bed advances
// env/time, saves, and clears wanted stars only when no police saw the player enter.
//   node tools/probe_interiors.mjs [--headed] [--shots /tmp/bw-interiors]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const si = argv.indexOf('--shots');
const shotDir = si >= 0 ? argv[si + 1] : '/tmp/bw-interiors';
mkdirSync(shotDir, { recursive: true });

const server = await startServer(8097);
const page = await launch({ headless: !headed, port: 9347 });
const watch = watchPage(page, new URL(server.url).host);
const ev = (js) => page.evaluate(js);
const G = (js) => ev(`window.__game.${js}`);
const report = { rooms: {}, shop: {}, garage: {}, wardrobe: {}, sleep: [] };
const ROOM = { safehouse: [9, 8], clothing: [11, 9], hardware: [11, 9], garage: [14, 11], bar: [12, 9] };

async function shot(name) {
  await G('drawNow(1)');
  const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(shotDir, `${name}.jpg`), Buffer.from(data, 'base64'));
}
const tap = async (code, steps = 1) => { await G(`tap(${JSON.stringify(code)})`); await G(`step(${steps})`); };
const st = () => G('interiors()');

// Walk to the street door, press E, assert we are inside that room.
async function enter(site) {
  await G(`teleport(${site.door.x}, ${site.door.z})`);
  await G('step(2)');
  const prompt = await ev(`({ hidden: document.getElementById('interior-prompt').hidden, text: document.getElementById('interior-prompt').textContent })`);
  assert.equal(prompt.hidden, false, `${site.kind}: door prompt shown at the door`);
  assert.ok(prompt.text.includes(site.label), `${site.kind}: prompt names the place (${prompt.text})`);
  const before = await G('frame()');
  await tap('KeyE');
  const s = await st();
  assert.equal(s.inside, site.kind, `${site.kind}: E at the door puts the player inside`);
  assert.equal(s.door, site.door.id, `${site.kind}: entered through its own door`);
  assert.ok(s.loaded && s.loaded.objects >= 3, `${site.kind}: room scene loaded (${s.loaded?.objects} objects)`);
  const p = await G('player()');
  const [w, d] = ROOM[site.kind];
  assert.ok(Math.abs(p.x) < w / 2 && Math.abs(p.z) < d / 2 && Math.abs(p.y) < 0.05, `${site.kind}: player stands inside the room (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  return { before, s };
}

// Walk (real controller steps) to the exit door and press E there.
async function leave(site) {
  // steer (real controller steps) toward the exit door, side-stepping when furniture blocks
  let s = await st();
  const ex = s.loaded.use.find((u) => u.id === 'exit');
  let side = 1;
  for (let i = 0; i < 80 && s.near !== 'exit'; i++) {
    const p0 = await G('player()');
    let dx = ex.x - p0.x, dz = ex.z + 0.3 - p0.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    await G(`walk({ x: ${dx}, z: ${dz}, walk: true }, 6)`);
    const p1 = await G('player()');
    if (Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05) { await G(`walk({ x: ${-dz * side}, z: ${dx * side} }, 12)`); side = -side; }
    s = await st();
  }
  assert.equal(s.near, 'exit', `${site.kind}: walking back reaches the exit door`);
  await tap('KeyE');
  s = await st();
  assert.equal(s.inside, null, `${site.kind}: E at the exit leaves the room`);
  assert.equal(s.loaded, null, `${site.kind}: room unloaded on exit`);
  const p = await G('player()');
  assert.ok(Math.hypot(p.x - site.door.x, p.z - site.door.z) < 1e-6, `${site.kind}: back on the street door (${p.x}, ${p.z})`);
  assert.ok(Math.abs(Math.atan2(Math.sin(p.yaw - site.door.yaw), Math.cos(p.yaw - site.door.yaw))) < 1e-6, `${site.kind}: street door heading restored`);
  const scene = await ev(`window.__scene.children.some((o) => o.name === 'interior-shell')`);
  assert.equal(scene, false, `${site.kind}: no room geometry in the street scene`);
  return p;
}

async function openAt(id, panel) {
  assert.equal(await G(`interiorGoto(${JSON.stringify(id)})`), true, `goto ${id}`);
  await G('step(1)');
  await tap('KeyE');
  const s = await st();
  assert.equal(s.panel, panel, `${id} opens the ${panel} panel`);
  return s;
}
async function pick(index) {
  const s = await st();
  for (let i = s.sel; i < index; i++) await tap('ArrowDown');
  await tap('Enter');
  return st();
}

let out;
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await G('newGame()');
  await G('step(2)');
  const sites = (await st()).sites;
  assert.deepEqual(sites.map((s) => s.kind).sort(), ['bar', 'clothing', 'garage', 'hardware', 'safehouse'], 'five interiors on the street');
  assert.equal(new Set(sites.map((s) => s.door.id)).size, 5, 'five distinct registry doors');
  const doorIds = new Set((await G('doors()')).map((d) => d.id));
  for (const s of sites) assert.ok(doorIds.has(s.door.id), `${s.kind} uses a doors.js door`);
  const garageSite = sites.find((s) => s.kind === 'garage');
  assert.equal(garageSite.door.id, 'door-3-4-0-0', 'the garage interior is behind the BREAKWATER CUSTOMS roller door');
  const by = Object.fromEntries(sites.map((s) => [s.kind, s]));

  // ---- every room: enter through the door, look, leave through the exit ---------------
  for (const s of sites) {
    await G(`teleport(${s.door.x}, ${s.door.z})`); await G('drawNow(2)');
    const geo0 = (await G('frame()')).geometries;           // street at this door, before the room exists
    const { s: inside } = await enter(s);
    await G('drawNow(2)');
    const f = await G('frame()');
    await shot(`interior-${s.kind}`);
    const back = await leave(s);
    await G('drawNow(2)');
    const geo1 = (await G('frame()')).geometries;
    // a second visit from the same street pose must not add GPU geometries: the room was released
    await enter(s); await G('drawNow(2)'); await leave(s); await G('drawNow(2)');
    const geo2 = (await G('frame()')).geometries;
    assert.equal(geo2, geo1, `${s.kind}: room geometry released on exit (${geo1} -> ${geo2} after a second visit)`);
    report.rooms[s.kind] = { door: s.door.id, at: [+s.door.x.toFixed(2), +s.door.z.toFixed(2)], objects: inside.loaded.objects, solids: inside.loaded.solids,
      calls: f.calls, triangles: f.triangles, geometries: { street: geo0, inside: f.geometries, afterExit: geo1, afterSecondVisit: geo2 }, exitedTo: [+back.x.toFixed(2), +back.z.toFixed(2), +back.yaw.toFixed(3)] };
    assert.ok(f.calls < 120, `${s.kind}: interior draw calls (${f.calls})`);
  }

  // ---- shops: buy through shop.buy ---------------------------------------------------
  await G('grant(1000)');
  for (const [kind, index, itemId] of [['clothing', 3, 'jacket'], ['hardware', 1, 'crowbar']]) {
    await enter(by[kind]);
    const s = await openAt('counter', 'shop');
    assert.equal(s.rows.length, 4, `${kind}: catalogue rows`);
    const money0 = await G('money()');
    const price = Number(s.rows[index].price.replace(/[$,]/g, ''));
    const after = await pick(index);
    const money1 = await G('money()'), wallet1 = (await G('wallet()')).balance;
    const inv = await G('inventory()');
    assert.ok(inv.some((x) => x.id === itemId), `${kind}: ${itemId} in the inventory after buying`);
    assert.equal(money1, money0 - price, `${kind}: paid ${price}`);
    assert.equal(wallet1, money1, `${kind}: wallet and HUD money agree`);
    await tap('Escape');
    assert.equal((await st()).panel, null, `${kind}: Esc closes the panel`);
    report.shop[kind] = { item: itemId, price, money: [money0, money1], row: after.rows[index] };
    await leave(by[kind]);
  }

  // ---- garage: garage.list() and the customs menu ---------------------------------------
  await G('autopilot(true)'); await G('step(1)');        // drive the hero car for a moment: it becomes the player's last car
  await G('autopilot(false)');
  await enter(garageSite);
  let g = await openAt('terminal', 'garage');
  const list0 = await G('customs.garage()');
  assert.equal(g.rows[0].label, 'Customise your car');
  assert.equal(g.rows.length, 1 + Math.max(1, list0.list.length), 'garage.list() rows shown');
  g = await pick(0);
  const cs = await G('customs.state()');
  assert.equal(g.inside, null, 'customise leaves the workshop for the turntable');
  assert.equal(cs.open, true, 'the customisation menu (GarageMenu) is open on the player car');
  await G('customs.leave()');
  await G('step(2)');
  await enter(garageSite);
  g = await openAt('terminal', 'garage');
  const list1 = await G('customs.garage()');
  assert.ok(list1.list.length >= 1, 'the customised car is now on the garage books');
  assert.equal(g.rows.length, 1 + list1.list.length, 'every garage.list() car is a row');
  report.garage = { rows: g.rows.map((r) => r.label), books: list1.list.map((c) => `${c.id}:${c.typeId}`), customsOpened: cs.open };
  await tap('Escape');
  await leave(garageSite);

  // ---- safehouse: wardrobe, then sleep seen and unseen -----------------------------------
  const safe = by.safehouse;
  await enter(safe);
  let w = await openAt('wardrobe', 'wardrobe');
  assert.equal(w.rows.find((r) => r.label === 'Windbreaker').disabled, true, 'unowned outfit cannot be worn');
  assert.equal(w.rows.find((r) => r.label === 'Denim Jacket').disabled, false, 'the bought jacket is wearable');
  w = await pick(w.rows.findIndex((r) => r.label === 'Denim Jacket'));
  assert.equal(w.outfit.top, 'jacket', 'wardrobe equips the jacket');
  report.wardrobe = { outfit: w.outfit, rows: w.rows.map((r) => `${r.label}:${r.price}`) };
  await tap('Escape');
  await leave(safe);

  // (a) walk in right after the police clocked us: sleeping must not clear the stars
  await G(`teleport(${safe.door.x}, ${safe.door.z})`);
  await G('forceWanted(2)'); await G('step(1)');
  await tap('KeyE');
  assert.equal((await st()).seenEntering, true, 'entering with fresh police contact counts as seen');
  for (const seen of [true, false]) {
    if (!seen) {
      // (b) lose them first: wanted stays, nobody sees us walk in
      await leave(safe);
      for (let i = 0; i < 12; i++) { await G('step(30)'); const p = await G('status()'); if (!p.seen && p.unseen > 2.2) break; }
      const pol = await G('status()');
      assert.ok(pol.wanted >= 2 && !pol.seen && pol.unseen > 2, `unseen before entering (wanted ${pol.wanted}, seen ${pol.seen}, unseen ${pol.unseen})`);
      await G('step(1)');
      await tap('KeyE');
      assert.equal((await st()).seenEntering, false, 'entering unseen');
    }
    const clock0 = await G('clock()'), wanted0 = (await G('status()')).wanted;
    await G('hurt(30)');
    assert.equal(await G('interiorGoto("bed")'), true);
    await G('step(1)');
    await tap('KeyE');
    const s = await st(), clock1 = await G('clock()'), pol = await G('status()'), save = await G('readSave()'), last = await G('lastSave()');
    const dm = ((clock1.day - clock0.day) * 1440 + clock1.minutes - clock0.minutes);
    assert.ok(dm >= 360 - 0.01 && dm <= 720 + 0.01, `sleep advances the clock 6-12 h (${dm.toFixed(1)} min)`);
    assert.ok(Math.abs(clock1.minutes % 1440 - 7 * 60) < 0.05 || Math.abs(dm - 480) < 0.05, 'wakes at 07:00 or after 8 h');
    assert.equal(last.reason, 'sleep'); assert.equal(last.ok, true, 'sleeping saved the game');
    assert.ok(save.data && Math.abs(save.data.clock.minutes - clock1.minutes) < 1e-6 && save.data.clock.day === clock1.day, 'the save holds the new clock');
    assert.equal(save.data.wardrobe.top, 'jacket', 'the save holds the outfit');
    assert.equal(pol.hp, 100, 'sleep heals');
    if (seen) {
      assert.equal(pol.wanted, wanted0, 'seen entering: wanted unchanged');
      assert.equal(s.lastSleep.cleared, 0);
    } else {
      assert.equal(pol.wanted, Math.max(0, wanted0 - 2), `unseen: two stars cleared (${wanted0} -> ${pol.wanted})`);
      assert.equal(s.lastSleep.cleared, Math.min(2, wanted0));
      if (pol.wanted === 0) assert.equal(save.data.player.wanted, 0, 'the save holds the cleared heat');
    }
    report.sleep.push({ seenEntering: s.seenEntering, from: clock0, to: clock1, hours: s.lastSleep.hours, wanted: [wanted0, pol.wanted], cleared: s.lastSleep.cleared, saved: last.ok });
  }
  await shot('interior-safehouse-after-sleep');
  await leave(safe);

  // ---- the bar: atmosphere (bartender, jukebox) -------------------------------------------
  await enter(by.bar);
  await G('interiorGoto("bartender")'); await G('step(1)'); await tap('KeyE');
  const note = await ev(`document.getElementById('interior-note').textContent`);
  assert.ok(note.startsWith('"'), 'the bartender talks');
  report.bar = { line: note };
  await leave(by.bar);

  // street wears the jacket after leaving
  await G('drawNow(1)');
  out = { ...report, consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length, pass: watch.errors.length === 0 && watch.offsite.length === 0 };
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
} catch (e) {
  out = { pass: false, failed: String(e.message || e), consoleErrors: watch.errors.length, errors: watch.errors.slice(0, 5), partial: report };
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
process.exit(out.pass ? 0 : 1);
