// Cold-start and long-run probe (PASS 8). Fresh Chrome profile (empty cache) each run.
//   node tools/probe_longrun.mjs [--headed] [--minutes 3] [--port 8097]
// 1. Cold load: navigation start -> title menu shown (no ?autostart), and -> playable (?autostart, __game.ready).
// 2. Long run in real time (the game's own rAF loop, not stepped): one third driving the hero car on the
//    autopilot, one third the same drive at wanted 3 (cruisers spawn and pursue), one third the on-foot
//    autopilot with the wanted level cleared. Every 15 s: entity counts (__game.entities) and JS heap after
//    a forced GC (HeapProfiler.collectGarbage + Runtime.getHeapUsage).
// 3. Network and console: every request, failed loads and HTTP >= 400, off-site hosts, console errors.
// Pass: title < 3 s, ready < 3 s, after the run entities equal the baseline (peds, vehicles, police units,
// scene objects, geometries and textures held by the scene graph; GPU uploads stay within what the scene holds), heap within +10 % of baseline, 0 errors, 0 failed, 0 off-site.
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const val = (k, d) => { const eq = argv.find((a) => a.startsWith(`${k}=`)); if (eq) return eq.split('=')[1]; const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const minutes = Number(val('--minutes', 3));
const port = Number(val('--port', 8097));
const headed = argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(port);
const host = new URL(server.url).host;
const out = { mode: headed ? 'headed' : 'headless', minutes };
let page;
try {
  page = await launch({ headless: !headed, port: 9347 });
  const watch = watchPage(page, host);
  const requests = [], failed = [];
  page.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  page.on('Network.loadingFailed', (p) => { if (!p.canceled) failed.push(`${p.errorText} ${p.requestId}`); });
  page.on('Network.responseReceived', (p) => { if (p.response.status >= 400) failed.push(`${p.response.status} ${p.response.url}`); });
  await page.send('HeapProfiler.enable');

  const timeTo = async (query, cond) => {
    await page.goto(`${server.url}${query}`);
    await page.waitFor(() => page.evaluate(cond), 30000, 20);
    return page.evaluate('Math.round(performance.now())');   // ms since this document's navigation start
  };
  // cold: the first load in a fresh profile (nothing cached), to the title menu
  out.coldTitleMs = await timeTo('?seed=1337', '!!(window.__game && window.__game.ready) && !document.getElementById("start").hidden');
  out.coldReadyMs = await timeTo('?autostart&seed=1337', '!!(window.__game && window.__game.ready)');

  const heap = async () => {
    await page.send('HeapProfiler.collectGarbage');
    await sleep(300);
    await page.send('HeapProfiler.collectGarbage');
    const h = await page.send('Runtime.getHeapUsage');
    return +(h.usedSize / 1048576).toFixed(2);
  };
  const sample = async (t, phase) => {
    const e = { ...await page.evaluate('window.__game.entities()'), ...await page.evaluate('window.__game.sceneCensus()') };
    const f = await page.evaluate('(() => { const f = window.__game.frame(); return { calls: f.calls, triangles: f.triangles }; })()');
    return { t, phase, heapMB: await heap(), ...e, ...f };
  };

  await sleep(5000);                                  // settle: shaders compiled, first traffic placed
  await page.evaluate('window.__game.autopilot(true)');
  await sleep(10000);
  const samples = [await sample(0, 'baseline')];
  const total = minutes * 60, third = total / 3;
  const t0 = Date.now();
  let phase = 'drive';
  for (;;) {
    const t = (Date.now() - t0) / 1000;
    if (t >= total) break;
    if (phase === 'drive' && t >= third) { phase = 'chase'; await page.evaluate('window.__game.forceWanted(3)'); }
    if (phase === 'chase' && t >= 2 * third) { phase = 'foot'; await page.evaluate('window.__game.forceWanted(0); window.__game.autopilot("foot")'); }
    await sleep(15000);
    samples.push(await sample(Math.round((Date.now() - t0) / 1000), phase));
  }
  // settle: clear the wanted level and stop the autopilot (its drive bumps into traffic, and every crash is a
  // crime that can raise a new incident), then give the units time to lose, return, patrol and stand down
  await page.evaluate('window.__game.forceWanted(0); window.__game.autopilot(false)');
  await sleep(25000);
  const end = await sample(Math.round((Date.now() - t0) / 1000), 'end');
  samples.push(end);
  const base = samples[0];
  out.samples = samples.map((s) => [s.t, s.phase, s.heapMB, s.sceneObjects, s.vehicles, s.peds, s.policeUnits, s.sceneGeometries, s.sceneTextures, s.geometries, s.textures, s.calls]);
  out.columns = ['t', 'phase', 'heapMB', 'sceneObjects', 'vehicles', 'peds', 'policeUnits', 'sceneGeometries', 'sceneTextures', 'gpuGeometries', 'gpuTextures', 'calls'];
  out.peak = { heapMB: Math.max(...samples.map((s) => s.heapMB)), policeUnits: Math.max(...samples.map((s) => s.policeUnits)), vehicles: Math.max(...samples.map((s) => s.vehicles)) };
  // allocations: scene objects, fleet, crowd, police units, and the geometries / textures the scene graph holds.
  // renderer.info's GPU counts are reported too, but they are not a leak measure: a static geometry is uploaded
  // the first time it enters the view, so they climb while the run reaches parts of the city it has not seen yet.
  // GPU geometries must stay within what the scene holds (plus the post pipeline's own few): no orphaned uploads.
  const keys = ['sceneObjects', 'vehicles', 'peds', 'policeUnits', 'sceneGeometries', 'sceneTextures'];
  out.entityDrift = Object.fromEntries(keys.map((k) => [k, end[k] - base[k]]));
  out.gpuDrift = { geometries: end.geometries - base.geometries, textures: end.textures - base.textures };
  out.gpuWithinScene = end.geometries <= end.sceneGeometries + 8;   // render targets and sign textures are not in the scene graph, so textures are compared by the census only
  out.heapDriftPct = +((end.heapMB / base.heapMB - 1) * 100).toFixed(1);
  out.requests = requests.length;
  out.failedRequests = failed;
  out.consoleErrors = watch.errors.length;
  out.offsiteRequests = watch.offsite.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
  out.pass = out.coldTitleMs < 3000 && out.coldReadyMs < 3000 && keys.every((k) => end[k] === base[k])
    && out.gpuWithinScene && out.heapDriftPct <= 10 && !failed.length && !watch.errors.length && !watch.offsite.length;
} catch (e) {
  out.error = String(e.message || e);
  out.pass = false;
} finally {
  await page?.close();
  server.stop();
}
console.log(JSON.stringify(out));
process.exit(out.pass ? 0 : 1);
