// PASS 16 reachability probe: the systems the fallback passes wrote are reachable in play,
// through the real game loop and real CDP key presses (E, F), not only through module calls.
//   1. HUD money shows the balance; walking (controller steps) onto a harbour tag pays $50 into the
//      balance the HUD, the wallet and the save all read; the tag disappears; tag + achievement toasts.
//   2. a story-mission reward paid into the gameplay balance reaches the wallet (shops read it).
//   3. the door prompt shows at the safehouse door.
//   4. at the COURIER DEPOT the side-job prompt shows; a real E press starts the delivery job.
//   5. next to a parked car a real F press puts the player in it and the radio plays a station;
//      out of the car (F) it stops.
//   6. the clock in the HUD runs with play, and the weather label matches env/weather.js.
// Pass: every check true, 0 console errors, 0 off-site requests.
//   node tools/probe_reach.mjs [--headed]
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const server = await startServer(8133);
const page = await launch({ headless: !argv.includes('--headed'), port: 9383 });
const watch = watchPage(page, new URL(server.url).host);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (js, ms = 60000) => Promise.race([page.evaluate(js), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${js.slice(0, 60)}`)), ms))]);
const G = (js) => ev(`window.__game.${js}`);
const VK = { KeyE: 69, KeyF: 70, ShiftLeft: 16 };
const KEY = { KeyE: 'e', KeyF: 'f', ShiftLeft: 'Shift' };
const press = async (code) => {
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, code, key: KEY[code], windowsVirtualKeyCode: VK[code] });
};
// let the real loop run (rAF) until cond() holds
async function until(cond, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = await cond(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); }
}
const checks = {}, out = {};
const ok = (k, c, d) => { checks[k] = !!c; if (!c) out[`fail_${k}`] = d ?? null; };

try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await press('ShiftLeft');                                   // a user gesture: the audio context may start
  await G('step(2)'); await G('drawNow(1)');

  // 1. HUD money + a harbour tag picked up by walking
  const m0 = await G('status()');
  const hud0 = await G('hudMoney()');
  ok('hudMoneyShown', hud0 === `$${m0.money}` && m0.money === 250, { hud0, money: m0.money });
  let col = await G('collectibles()');
  // the tag count is the game's own (12 when this probe was written, 20 since): all of them drawn, none found yet
  ok('tagsDrawn', col.total >= 12 && col.tags.length === col.total && col.drawn === col.total && col.found === 0, col);
  const tag = col.tags[1];
  await G(`teleport(${tag.x + 5}, ${tag.z})`);
  for (let i = 0; i < 60; i++) {
    const p = await G('player()');
    const dx = tag.x - p.x, dz = tag.z - p.z, l = Math.hypot(dx, dz) || 1;
    await G(`walk({ x: ${dx / l}, z: ${dz / l}, walk: true }, 5)`);
    if ((await G('collectibles()')).found) break;
  }
  await G('drawNow(1)');
  col = await G('collectibles()');
  const m1 = await G('status()'), w1 = await G('wallet()'), hud1 = await G('hudMoney()'), toasts = await G('toasts()');
  const save1 = await G('readSave()');
  out.tag = { id: tag.id, found: col.found, drawn: col.drawn, money: m1.money, wallet: w1.balance, hud: hud1, toasts: toasts.map((t) => t.head) };
  ok('tagCollectedByWalking', col.found === 1 && col.tags[1].found && col.drawn === col.total - 1, out.tag);
  ok('tagPaysIntoHud', m1.money === 300 && w1.balance === 300 && hud1 === '$300', out.tag);
  ok('tagToasts', toasts.some((t) => t.head === 'HARBOUR TAG') && toasts.some((t) => t.head.includes('FINDERS KEEPERS')), out.tag);
  ok('tagSaved', save1.data?.collectibles?.found?.includes(tag.id) && (await G('achievements()')).find((a) => a.id === 'finders-keepers').unlocked, save1.data?.collectibles);

  // 2. money paid into the gameplay balance (as a mission reward is) reaches the wallet on the next step
  await G('grant(400)');
  await G('step(1)');
  const m2 = await G('status()'), w2 = await G('wallet()');
  out.grant = { money: m2.money, wallet: w2.balance };
  ok('gameplayMoneyReachesWallet', m2.money === 700 && w2.balance === 700, out.grant);

  // 3. door prompt at the safehouse
  const sites = (await G('interiors()')).sites;
  const safe = sites.find((s) => s.kind === 'safehouse');
  await G(`teleport(${safe.door.x}, ${safe.door.z})`);
  await G('step(2)');
  const doorPrompt = await ev(`({ hidden: document.getElementById('interior-prompt').hidden, text: document.getElementById('interior-prompt').textContent })`);
  ok('doorPrompt', !doorPrompt.hidden && /SAFEHOUSE/i.test(doorPrompt.text), doorPrompt);

  // 4. side job: prompt at the courier depot, real E starts it
  const spot = { x: -120, z: 100 };
  await G(`teleport(${spot.x}, ${spot.z})`);
  await G('resume()');
  const sidePrompt = await until(() => ev(`(() => { const e = document.getElementById('side-prompt'); return e.hidden ? null : e.textContent; })()`));
  await press('KeyE');
  const side = await until(async () => { const s = await G('side()'); return s.activity === 'delivery' && s.phase !== 'idle' ? s : null; });
  out.side = { prompt: sidePrompt, side };
  ok('sidePrompt', sidePrompt && /COURIER DEPOT/.test(sidePrompt), out.side);
  ok('sideStartsWithE', side && side.phase === 'deliver' && side.target && Math.hypot(side.target.x - spot.x, side.target.z - spot.z) > 100, out.side);
  await G('sideCancel()');

  // 5. radio in a car (real F), off on foot
  const p5 = await G('player()');
  const near = (await G(`nearby(${p5.x}, ${p5.z}, 80)`)).cars.filter((c) => !c.police && !c.mission && c.speed < 0.5);
  near.sort((a, b) => Math.hypot(a.x - p5.x, a.z - p5.z) - Math.hypot(b.x - p5.x, b.z - p5.z));
  const car = near[0];
  out.car = car ? { id: car.id, type: car.type } : null;
  let inCar = null, radio = null;
  if (car) {
    const sx = car.x + Math.cos(car.yaw) * (car.w + 0.9), sz = car.z - Math.sin(car.yaw) * (car.w + 0.9);
    await G(`teleport(${sx}, ${sz})`);
    await G('resume()');
    await sleep(300);
    await press('KeyF');
    inCar = await until(async () => ((await G('player()')).driving ? true : null), 8000);
    radio = await until(async () => { const r = await G('radio()'); return r.on && r.buffer ? r : null; }, 25000);
  }
  out.radio = radio ? { station: radio.station, trackId: radio.buffer.trackId, hud: radio.hud } : null;
  ok('enterCarWithF', !!inCar, out.car);
  ok('radioPlaysInCar', !!radio && !radio.hud.hidden && radio.hud.station.length > 0, out.radio);
  await press('KeyF');
  const offFoot = await until(async () => { const p = await G('player()'); const r = await G('radio()'); return !p.driving && !r.on ? r : null; }, 8000);
  ok('radioOffOnFoot', !!offFoot, null);

  // 6. HUD clock runs with play; weather label matches
  const c0 = await G('env()');
  await G('step(60 * 20 * 3)');          // 3 game minutes
  await G('drawNow(1)');
  const c1 = await G('env()');
  const hudClock = await ev(`document.getElementById('hud-status')?.textContent ?? ''`);
  out.clock = { from: c0, to: c1, hud: hudClock.replace(/\s+/g, ' ').trim().slice(0, 60) };
  const hh = String(c1.hour).padStart(2, '0'), mm = String(c1.minutes).padStart(2, '0');
  ok('hudClockRuns', (c1.hour * 60 + c1.minutes) - (c0.hour * 60 + c0.minutes) >= 2 && hudClock.includes(`${hh}:${mm}`) && hudClock.toUpperCase().includes(c1.weather.toUpperCase()), out.clock);

  out.consoleErrors = watch.errors.length;
  out.offsiteRequests = watch.offsite.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 3);
  out.checks = checks;
  out.pass = Object.values(checks).every(Boolean) && !out.consoleErrors && !out.offsiteRequests;
} catch (e) {
  out.error = String(e.message || e);
  out.checks = checks;
  out.pass = false;
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
process.exit(out.pass ? 0 : 1);
