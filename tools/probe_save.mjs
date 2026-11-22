// Save / load probe, through the real start card (no ?autostart):
//   node tools/probe_save.mjs [--port 8094]
// 1. fresh profile: no save, Continue hidden; click "New game" (a real CDP mouse click);
// 2. play THE PICKUP with the scripted courier (tools/mission_driver.mjs), which autosaves
//    on success; raise the wanted level and save again; snapshot money, mission index,
//    owned car, wanted heat and the entity census (scene objects, vehicles, owned / mission
//    cars, pedestrians, police units, markers, geometries, textures);
// 3. reload the page, check the start card offers Continue, click it, snapshot again;
// 4. load the same save a second time in the same session (Continue twice): census and GPU resources unchanged;
// 5. keep playing from the loaded state (HOT CARGO), reload, Continue: progress and money carried;
// 6. corrupt saves (bad JSON, wrong version, wrong types, out-of-range values, null, array):
//    each reload must boot with 0 errors, hide Continue, explain the rejection, and New game must run.
// Pass: every assertion below holds, 0 console errors, 0 off-site requests.
import { launch, startServer, watchPage } from './cdp.mjs';
import { DRIVER, PLAY } from './mission_driver.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8094);
const server = await startServer(port);
const page = await launch({ port: 9337 });
const watch = watchPage(page, new URL(server.url).host);
const url = `${server.url}?seed=1337`;
const KEY = 'breakwater.save';

const ev = (js) => page.evaluate(js);
async function load() {
  await page.goto(url);
  await page.waitFor(() => ev('!!(window.__game && window.__game.ready) && !document.getElementById("start").hidden'), 60000);
  return ev(`({ continueShown: !document.getElementById('continue').hidden, info: document.getElementById('save-info').hidden ? '' : document.getElementById('save-info').textContent, save: window.__game.readSave() })`);
}
// A real mouse click in the middle of an element (CDP input events, like a person's click).
async function click(sel) {
  const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  // the probe owns the clock from here (fixed steps only)
  return ev(`window.__game.step(0), ({ started: window.__game.started(), cardHidden: document.getElementById('start').hidden })`);
}
const snapshot = () => ev(`(() => { const g = window.__game, m = g.missions(), p = g.player(), s = g.status();
  return { money: g.money(), mission: m.progress, ending: m.ending, owned: m.owned, heat: +s.heat.toFixed(2), wanted: s.wanted, phase: m.phase,
    player: { x: +p.x.toFixed(2), z: +p.z.toFixed(2), driving: p.driving }, entities: g.entities() }; })()`);
const installBot = () => ev(`${DRIVER};${PLAY};true`);
// World entities. GPU resource counts (renderer.info geometries / textures) are compared only within
// one page session: across a reload they depend on what the camera has already drawn (geometry is
// uploaded on first draw, and the start card shows a different view), not on what exists.
const CENSUS = ['sceneObjects', 'vehicles', 'ownedCars', 'missionCars', 'peds', 'markers', 'missionEntities'];
const GPU = ['geometries', 'textures'];
const sameCensus = (a, b, keys = CENSUS) => keys.every((k) => a.entities[k] === b.entities[k]);
const diff = (a, b, keys = CENSUS) => keys.filter((k) => a.entities[k] !== b.entities[k]).map((k) => `${k}: ${a.entities[k]} -> ${b.entities[k]}`);

const out = { steps: {} };
const checks = {};
try {
  // 1. fresh
  await page.goto(url);
  await ev(`localStorage.clear()`);
  const fresh = await load();
  checks.freshNoSave = !!fresh.save.none && !fresh.continueShown;
  const started = await click('#play');
  checks.newGameStarted = started.started && started.cardHidden;
  out.steps.fresh = { ...fresh, started };

  // 2. play, save
  await installBot();
  const pickup = await ev(`window.__probe.runMission(0)`);
  const autosaved = await ev(`window.__game.lastSave()`);
  await ev(`window.__game.forceWanted(2); window.__game.step(30); window.__game.save()`);
  const before = await snapshot();
  const saved = await ev(`window.__game.readSave()`);
  checks.pickupPassed = pickup.ok && pickup.gained === 300;
  checks.autosavedOnSuccess = autosaved?.reason === 'mission' && autosaved.ok;
  checks.saveHoldsState = saved.data?.money === before.money && saved.data?.mission === before.mission && saved.data?.mission === 1
    && Math.abs(saved.data?.wanted - before.heat) < 0.01 && saved.data?.owned?.type === before.owned?.type && saved.data?.v === 1;
  out.steps.played = { pickup: { ok: pickup.ok, transitions: pickup.transitions, moneyBefore: pickup.moneyBefore, moneyAfter: pickup.moneyAfter }, autosaved, saved: saved.data, before };

  // 3. reload, Continue
  const card = await load();
  checks.continueOffered = card.continueShown && /mission 2 of 5/.test(card.info);
  const resumed = await click('#continue');
  const after = await snapshot();
  checks.continueStarted = resumed.started && resumed.cardHidden;
  checks.moneyMatches = after.money === before.money;
  checks.missionMatches = after.mission === before.mission;
  checks.ownedMatches = JSON.stringify(after.owned) === JSON.stringify(before.owned) && after.entities.ownedCars === 1;
  checks.wantedMatches = Math.abs(after.heat - before.heat) < 0.01 && after.wanted === before.wanted;
  checks.atCheckpoint = Math.hypot(after.player.x - saved.data.checkpoint.x, after.player.z - saved.data.checkpoint.z) < 0.5 && after.phase === 'idle';
  // entity census: the reloaded world against the session that saved it
  checks.censusMatches = sameCensus(before, after);
  out.steps.reloaded = { card, after, censusDiff: diff(before, after) };

  // 4. load the same save again in this session: nothing doubles
  await ev(`window.__game.continueGame(); window.__game.step(0)`);
  const again = await snapshot();
  checks.secondLoadNoDuplicates = sameCensus(after, again, [...CENSUS, ...GPU]) && again.money === after.money && again.mission === after.mission;
  out.steps.loadedTwice = { again, censusDiff: diff(after, again, [...CENSUS, ...GPU]) };

  // 5. keep playing from the loaded game, reload, Continue
  await installBot();
  const cargo = await ev(`window.__probe.runMission(1)`);
  const beforeTwo = await snapshot();
  const card2 = await load();
  await click('#continue');
  const afterTwo = await snapshot();
  checks.playAfterLoad = cargo.ok && cargo.gained === 450 && cargo.moneyBefore === before.money;
  checks.secondReloadCarries = afterTwo.mission === 2 && afterTwo.money === beforeTwo.money && afterTwo.money === before.money + 450 && sameCensus(beforeTwo, afterTwo);
  out.steps.continued = { cargo: { ok: cargo.ok, failures: cargo.failures, transitions: cargo.transitions, moneyBefore: cargo.moneyBefore, moneyAfter: cargo.moneyAfter }, card: card2, beforeTwo, afterTwo, censusDiff: diff(beforeTwo, afterTwo) };

  // 6. corrupt saves
  const good = saved.data;
  const bad = {
    'bad JSON': '{"v":1,"money":',
    'wrong version': JSON.stringify({ ...good, v: 99 }),
    'no version': JSON.stringify({ ...good, v: undefined }),
    'money as string': JSON.stringify({ ...good, money: '1000' }),
    'negative money': JSON.stringify({ ...good, money: -50 }),
    'mission out of range': JSON.stringify({ ...good, mission: 9 }),
    'checkpoint off the map': JSON.stringify({ ...good, checkpoint: { x: 1e9, z: 0, yaw: 0 } }),
    'checkpoint missing': JSON.stringify({ ...good, checkpoint: null }),
    'unknown vehicle': JSON.stringify({ ...good, owned: { type: 'tank', paint: '#ffffff' } }),
    'wanted NaN (null)': JSON.stringify({ ...good, wanted: NaN }),
    'ending before finale': JSON.stringify({ ...good, ending: 'press' }),
    'null': 'null',
    'array': '[1,2,3]',
  };
  const corrupt = {};
  for (const [name, text] of Object.entries(bad)) {
    const errorsBefore = watch.errors.length;
    // plant it from the start card (no autosave there; a running game's pagehide autosave would overwrite it)
    await load();
    await ev(`localStorage.setItem('${KEY}', ${JSON.stringify(text)})`);
    const c = await load();
    const r = await click('#play');
    await ev(`window.__game.step(60)`);
    const s = await snapshot();
    corrupt[name] = { rejected: c.save.error ?? null, continueShown: c.continueShown, info: c.info, newGame: r.started && s.money === 250 && s.mission === 0,
      saveCleared: !!(await ev('window.__game.readSave()')).none, errors: watch.errors.length - errorsBefore };
  }
  checks.corruptSavesHandled = Object.values(corrupt).every((c) => c.rejected && !c.continueShown && /damaged/.test(c.info) && c.newGame && c.saveCleared && c.errors === 0);
  out.steps.corrupt = corrupt;
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await page.close();
  server.stop();
}
out.checks = checks;
out.consoleErrors = watch.errors.length;
out.offsiteRequests = watch.offsite.length;
if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
out.pass = !out.error && Object.keys(checks).length === 17 && Object.values(checks).every(Boolean) && !out.consoleErrors && !out.offsiteRequests;
console.log(JSON.stringify(out));
if (!out.pass) process.exitCode = 1;
