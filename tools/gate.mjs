// Budget gate: opens the game in headless Chrome (1280x720) over CDP, waits for
// window.__game.ready, lets the autopilot drive the hero car around the grid,
// samples for --seconds and prints one JSON line.
//   node tools/gate.mjs [--headed] [--seconds 10 | --seconds=10] [--port 8091] [--wanted 0-5] [--parked=N] [--traffic=N]
// --parked / --traffic (PASS 10a2) resize the fleet so many cars are in view; the
// output then also carries the most cars drawn in one frame and their LOD split.
// --wanted N forces that wanted level once the drive starts, so cruisers, light
// pools and (at 4+) the helicopter are in the sampled frames.
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const eq = argv.find((a) => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const seconds = Number(arg('--seconds', 10));
const port = Number(arg('--port', 8091));
const headed = argv.includes('--headed');
const wanted = Number(arg('--wanted', 0));
const parked = arg('--parked', null), traffic = arg('--traffic', null);
const fleet = (parked != null ? `&parked=${Number(parked)}` : '') + (traffic != null ? `&traffic=${Number(traffic)}` : '');

const server = await startServer(port);
const page = await launch({ headless: !headed });
const host = new URL(server.url).host;
const watch = watchPage(page, host);
let out;
try {
  await page.goto(`${server.url}?autostart&seed=1337${fleet}`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await page.evaluate('window.__game.autopilot(true)');
  if (wanted) await page.evaluate(`window.__game.forceWanted(${wanted})`);
  await new Promise((r) => setTimeout(r, wanted ? 6000 : 1500)); // settle: shader warm-up, first shadow maps (and units arriving)
  const sample = await page.evaluate(`new Promise((resolve) => {
    const g = window.__game;
    let frames = 0, calls = 0, tris = 0, maxCalls = 0, maxTris = 0, maxCars = 0, lods = null, minRes = null;
    const t0 = performance.now();
    function tick() {
      const f = g.frame();
      frames++; calls += f.calls; tris += f.triangles;
      maxCalls = Math.max(maxCalls, f.calls); maxTris = Math.max(maxTris, f.triangles);
      if (f.res && (!minRes || f.res.scale < minRes.scale)) minRes = f.res;
      if (f.carsDrawn > maxCars) { maxCars = f.carsDrawn; lods = f.carLods; }
      if (performance.now() - t0 < ${seconds * 1000}) requestAnimationFrame(tick);
      else {
        const dt = (performance.now() - t0) / 1000;
        resolve({ fps: frames / dt, calls: maxCalls, triangles: maxTris, avgCalls: calls / frames, avgTriangles: tris / frames,
          geometries: f.geometries, textures: f.textures, res: f.res, resMin: minRes, player: g.player(), police: g.status(), maxCars, lods, fleet: g.vehicles().length });
      }
    }
    requestAnimationFrame(tick);
  })`);
  const bench = await page.evaluate('window.__game.bench(3)');
  out = {
    fps: Math.round(sample.fps * 10) / 10,
    calls: sample.calls,
    triangles: sample.triangles,
    geometries: sample.geometries,
    textures: sample.textures,
    consoleErrors: watch.errors.length,
    offsiteRequests: watch.offsite.length,
    frameMs: Math.round(bench.frameMs * 100) / 100,
    fpsCapacity: Math.round(bench.fpsCapacity * 10) / 10,
    seconds,
    mode: headed ? 'headed' : 'headless',
    // PASS 17e: internal render resolution at the end of the sample, and the lowest it went
    render: sample.res ? `${sample.res.width}x${sample.res.height} @${sample.res.scale}` : 'n/a',
    renderLowest: sample.resMin ? `${sample.resMin.width}x${sample.resMin.height} @${sample.resMin.scale}` : 'n/a',
  };
  if (fleet) Object.assign(out, { fleet: sample.fleet, maxCarsDrawn: sample.maxCars, lods: sample.lods });
  if (wanted) Object.assign(out, { wanted: sample.police.wanted, units: sample.police.units.length,
    sirens: sample.police.units.filter(u => u.state !== 'patrol').length, helicopter: sample.police.helicopter.active });
  // PASS 17: judge the budget instead of only printing it. fps >= 55 is a headed
  // requirement (headless Chrome caps rAF on this host, see BUILD-NOTES).
  out.pass = out.calls < 500 && out.triangles < 900000 && !out.consoleErrors && !out.offsiteRequests && (!headed || out.fps >= 55);
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
  if (watch.offsite.length) out.offsite = watch.offsite.slice(0, 5);
} catch (e) {
  out = { error: String(e.message || e), consoleErrors: watch.errors.length, errors: watch.errors.slice(0, 5) };
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
if (!out.pass) process.exitCode = 1;
